// 이미 전사방에 들어간 카톡 인턴방 글을 인턴방(단톡방)으로 옮긴다 — 한 번 돌리는 정리(사용자 결정 2026-10-30).
//
//   npx tsx import-tools/split-intern-room.ts                     로컬 DB 에서 무엇을 옮길지만 (기본 dry)
//   npx tsx import-tools/split-intern-room.ts --apply             로컬 DB 에 적용
//   npx tsx import-tools/split-intern-room.ts --target prod       운영 — 무엇을 옮길지만
//   npx tsx import-tools/split-intern-room.ts --target prod --apply   운영에 적용 — 작업지시자 승인 뒤
//
// 어느 글이 인턴방 것인지는 메시지 마스터(카톡 원본)에서 sourceId 를 다시 계산해 안다 — DB 에는 카톡 방 이름이 없다.
// 업무 카드 연결(taskId)은 그대로 둔다(사용자 결정). 옮긴 글 · 그 첨부의 검색 색인은 지운다 —
// 단톡방 글은 사내 검색에 넣지 않는다(lib/embeddings.ts 가 COMPANY 방만 색인). 멱등: 다시 돌리면 0건.
import { pointAtProd } from "./prod-env"

const args = process.argv.slice(2)
const prod = args.includes("--target") && args[args.indexOf("--target") + 1] === "prod"
const apply = args.includes("--apply")
const where = prod ? pointAtProd() : (process.env.DATABASE_URL ?? "(.env)").replace(/:\/\/[^@]+@/, "://***@")

async function main() {
  const { prisma, ROOMS, ensureRooms, touchRooms, loadSessions, messageSourceId } = await import("./kakao-common")
  if (!prod && !process.env.DATABASE_URL?.includes("localhost")) throw new Error("로컬 대상인데 DATABASE_URL 이 localhost 가 아니다. 중단.")
  const KAKAO_ROOM = "하드사이언스 인턴방"
  const room = ROOMS[KAKAO_ROOM]
  if (room.kind !== "GROUP") throw new Error("인턴방이 단톡방으로 설정돼 있지 않다. 중단.")

  const sourceIds = loadSessions().filter((s) => s.room === KAKAO_ROOM).flatMap((s) => s.msgs.map((m) => messageSourceId(s.room, m)))
  const messages: { id: string; taskId: string | null }[] = []
  for (let i = 0; i < sourceIds.length; i += 1000) {
    messages.push(...await prisma.chatMessage.findMany({
      where: { sourceId: { in: sourceIds.slice(i, i + 1000) }, roomId: { not: room.id } },
      select: { id: true, taskId: true },
    }))
  }
  const ids = messages.map((m) => m.id)
  const files = ids.length === 0 ? [] : await prisma.file.findMany({ where: { messageId: { in: ids } }, select: { id: true } })
  const chunks = await prisma.embeddingChunk.count({
    where: { OR: [{ source: "CHAT_MESSAGE", sourceId: { in: ids } }, { source: "PHOTO", sourceId: { in: files.map((f) => f.id) } }] },
  })
  console.log(`대상 ${where}`)
  console.log(`  카톡 인턴방 원본 ${sourceIds.length}줄 · 옮길 글 ${ids.length}건 (업무 카드에 붙은 것 ${messages.filter((m) => m.taskId).length}건 — 연결은 그대로)`)
  console.log(`  함께 옮겨지는 첨부 ${files.length}개 · 지울 색인 조각 ${chunks}개 · 참여자 ${room.members?.join(" · ")}`)
  if (!apply) { console.log("  (보기만 — 적용하려면 --apply)"); return }

  await ensureRooms()
  let moved = 0
  for (let i = 0; i < ids.length; i += 1000) {
    const { count } = await prisma.chatMessage.updateMany({ where: { id: { in: ids.slice(i, i + 1000) } }, data: { roomId: room.id } })
    moved += count
  }
  const fileIds = files.map((f) => f.id)
  let dropped = 0
  for (let i = 0; i < Math.max(ids.length, fileIds.length); i += 1000) {
    const { count } = await prisma.embeddingChunk.deleteMany({
      where: { OR: [{ source: "CHAT_MESSAGE", sourceId: { in: ids.slice(i, i + 1000) } }, { source: "PHOTO", sourceId: { in: fileIds.slice(i, i + 1000) } }] },
    })
    dropped += count
  }
  await touchRooms()
  const left = await prisma.chatMessage.count({ where: { roomId: room.id } })
  console.log(`  옮김 ${moved}건 · 지운 색인 ${dropped}개 · 인턴방 글 ${left}건`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
