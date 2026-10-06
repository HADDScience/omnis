// 이미 옴니스에 들어간 글 가리기 — 제외 목록(KAKAO_DATA_DIR/exclude.json)의 줄.
//
//   npx tsx import-tools/redact.ts --dry               로컬 · 무엇을 가릴지만 본다
//   npx tsx import-tools/redact.ts                     로컬에 적용
//   npx tsx import-tools/redact.ts --target prod       프로덕션에 적용
//
// 화면의 「삭제」와 같은 표시(deletedAt)를 다는 데서 그치지 않고 본문을 지운다. 채팅 피드·MCP 처럼
// deletedAt 을 거르지 않고 본문을 읽는 경로가 있어서, 표시만 하면 말이 그대로 새어 나간다.
// 원문은 KAKAO_DATA_DIR/redacted-backup.json 에 남긴다(노트북에만). 카톡 원본과 CSV 에도 그대로 있다.
//
// 함께 지우는 것: 그 글의 검색 색인(EmbeddingChunk), 카톡에서 만든 카드에 저장된 원문 기록(Task.sourceMessages.messages),
// 그 글에 붙은 첨부(NAS 실물과 File 행). 첨부 원본은 휴대폰 내보내기 zip 을 푼 폴더(노트북)에 남아 있다.
// 알림·재구성은 부르지 않는다 — 지난 대화를 가리는 일로 오늘 카드가 바뀌면 안 된다.
import { existsSync, readFileSync, writeFileSync } from "fs"
import { pointAtProd } from "./prod-env"

const args = process.argv.slice(2)
const dry = args.includes("--dry")
const prod = args.includes("--target") && args[args.indexOf("--target") + 1] === "prod"

async function main() {
  const where = prod ? pointAtProd() : (process.env.DATABASE_URL ?? "(.env)").replace(/:\/\/[^@]+@/, "://***@")
  console.log(`대상 DB: ${prod ? "🔴 프로덕션" : "로컬"} ${where}${dry ? "  (--dry: 쓰지 않음)" : ""}`)

  const { prisma, DATA_DIR } = await import("./kakao-common")
  const { loadExclude, EXCLUDE_FILE } = await import("./redaction")
  const { CHAT_DELETED_TEXT } = await import("../lib/constants")
  const { deleteObject, objectKeyFor } = await import("../lib/storage")

  const exclude = loadExclude()
  if (exclude.length === 0) { console.log(`${EXCLUDE_FILE} 가 비어 있다`); return }
  const sourceIds = exclude.filter((e) => e.key.startsWith("kakao:")).map((e) => e.key)
  const ids = exclude.filter((e) => e.key.startsWith("msg:")).map((e) => e.key.slice(4))

  const found = await prisma.chatMessage.findMany({
    where: { OR: [{ sourceId: { in: sourceIds } }, { id: { in: ids } }] },
    select: { id: true, sourceId: true, content: true, deletedAt: true, createdAt: true, taskId: true, files: { select: { id: true, name: true } } },
  })
  // 이미 가린 글이라도 그 뒤에 첨부가 붙었을 수 있으니 전부 본다.
  const attached = found.flatMap((m) => m.files)
  const todo = found.filter((m) => m.content !== CHAT_DELETED_TEXT)
  console.log(`제외 목록 ${exclude.length}줄 · DB 에 있는 것 ${found.length}건 · 이미 가린 것 ${found.length - todo.length}건 · 이번에 가릴 것 ${todo.length}건`)

  // 카드에 저장된 원문 기록. 이식 카드는 { messages: [{ t, u, m }] } 꼴이다. t·m 으로 짝짓는다(u 는 계정 이름으로 바뀌어 있다).
  const lineKeys = new Set(exclude.filter((e) => e.t && e.m != null).map((e) => `${e.t}|${e.m}`))
  const tasks = await prisma.task.findMany({ where: { sourceId: { startsWith: "kakao-task:" } }, select: { id: true, name: true, sourceMessages: true } })
  type Stored = { messages?: { t: string; u: string; m: string }[] }
  const scrub = tasks.flatMap((t) => {
    const sm = t.sourceMessages as Stored | null
    if (!sm?.messages) return []
    const kept = sm.messages.filter((x) => !lineKeys.has(`${x.t}|${x.m}`))
    return kept.length === sm.messages.length ? [] : [{ id: t.id, name: t.name, removed: sm.messages.length - kept.length, value: { ...sm, messages: kept } }]
  })
  console.log(`카드 원문 기록에서 지울 줄: 카드 ${scrub.length}장 · ${scrub.reduce((a, b) => a + b.removed, 0)}줄`)

  console.log(`가린 글에 붙은 첨부: ${attached.length}개`)
  const missing = exclude.filter((e) => !found.some((m) => m.sourceId === e.key || `msg:${m.id}` === e.key))
  if (missing.length > 0) console.log(`DB 에 없는 줄 ${missing.length}건 — 아직 이식 전이면 이식할 때 빠진다`)
  if (dry) { await prisma.$disconnect(); return }

  // 원문 백업(노트북). 같은 글을 두 번 덮지 않도록 id 로 합친다.
  const BACKUP = `${DATA_DIR}/redacted-backup.json`
  const backup: Record<string, { sourceId: string | null; content: string; createdAt: string; target: string }> =
    existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, "utf8")) : {}
  for (const m of todo) backup[`${prod ? "prod" : "local"}:${m.id}`] = { sourceId: m.sourceId, content: m.content, createdAt: m.createdAt.toISOString(), target: prod ? "prod" : "local" }
  writeFileSync(BACKUP, JSON.stringify(backup, null, 1))

  const now = new Date()
  for (const m of todo) {
    await prisma.chatMessage.update({ where: { id: m.id }, data: { content: CHAT_DELETED_TEXT, deletedAt: m.deletedAt ?? now } })
  }
  const emb = await prisma.embeddingChunk.deleteMany({ where: { source: "CHAT_MESSAGE", sourceId: { in: found.map((m) => m.id) } } })
  for (const s of scrub) await prisma.task.update({ where: { id: s.id }, data: { sourceMessages: s.value } })
  // NAS 를 먼저 지우고 성공한 것만 DB 에서 뺀다 — 반대로 하면 실물만 남은 고아가 생긴다.
  for (const f of attached) {
    await deleteObject(objectKeyFor(f.id, f.name))
    await prisma.file.delete({ where: { id: f.id } })
  }
  console.log(`가림 ${todo.length}건 · 색인 삭제 ${emb.count}건 · 카드 원문 기록 정리 ${scrub.length}장 · 첨부 삭제 ${attached.length}개 · 원문 백업 ${BACKUP}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1) })
