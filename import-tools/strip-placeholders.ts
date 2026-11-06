// 이미 옴니스에 들어간 카톡 글에서 첨부 자리표시(`Photo` · `3 photos` · `Video` · `File: 이름`)를 뺀다.
// 이식 5단계(steps/media.ts)가 새로 붙이는 글에 하는 일과 같은 규칙이다 — 사진·파일이 실제로 붙은 글만,
// 자리표시 줄만 빼고 사람이 쓴 줄은 남긴다. 첨부가 없는 글은 손대지 않는다.
//
//   npx tsx import-tools/strip-placeholders.ts                                  로컬 · 무엇을 고칠지만 본다
//   npx tsx import-tools/strip-placeholders.ts --target prod --examples <파일>   운영 · 보기만 한다. 예시는 <파일>에만 쓴다
//   npx tsx import-tools/strip-placeholders.ts --target prod --apply            운영에 적용 (백업을 먼저 쓴다)
//   npx tsx import-tools/strip-placeholders.ts --target prod --restore <백업>   백업대로 되돌린다
//
// --apply 는 바꿀 글의 원래 본문을 KAKAO_DATA_DIR/placeholder-backup-<시각>.json(노트북, 600)에 먼저 쓰고, 쓰기에 실패하면 멈춘다.
// 고칠 때는 본문이 백업과 같은 글만 고친다 — 그 사이 사람이 고친 글은 덮지 않는다. 되돌릴 때도 같다.
// 알림·재구성·검색 색인은 부르지 않는다. 고친 표시(editedAt)도 달지 않는다. 예시에는 이름·글이 들어가므로 저장소 밖에 쓴다.
import { writeFileSync, readFileSync, chmodSync } from "fs"
import { resolve } from "path"
import { pointAtProd } from "./prod-env"
import { stripAttachmentPlaceholder } from "./steps/media-match"

const args = process.argv.slice(2)
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
const prod = opt("--target") === "prod"
const apply = args.includes("--apply")
const restore = opt("--restore")
const examplesPath = opt("--examples")

// 먼저 넓게 고르고 실제 판단은 stripAttachmentPlaceholder 가 한다 — 이식과 같은 규칙
const PLACEHOLDER_SQL = "(Photo|photos|Video|File: )"

async function main() {
  const where = prod ? pointAtProd() : (process.env.DATABASE_URL ?? "(.env)").replace(/:\/\/[^@]+@/, "://***@")
  const mode = restore ? "되돌리기" : apply ? "적용" : "보기만 (--apply 없음)"
  console.log(`대상 DB: ${prod ? "🔴 프로덕션" : "로컬"} ${where} · ${mode}`)
  const { prisma, DATA_DIR } = await import("./kakao-common")

  if (restore) {
    const backup = JSON.parse(readFileSync(restore, "utf8")) as { target: string; rows: { id: string; before: string; after: string }[] }
    if (backup.target !== (prod ? "prod" : "local")) throw new Error(`백업 대상(${backup.target})과 지금 대상이 다르다`)
    let n = 0, skipped = 0
    for (const r of backup.rows) {
      const { count } = await prisma.chatMessage.updateMany({ where: { id: r.id, content: r.after }, data: { content: r.before } })
      if (count) n++; else skipped++
    }
    console.log(`되돌림 ${n}건 · 그 사이 바뀌어 건너뜀 ${skipped}건`)
    return
  }

  // 자리표시 줄이 든 카톡 글 전부(지운 글 제외). 첨부 유무로 고칠 것과 둘 것을 가른다
  const rows = await prisma.$queryRawUnsafe<{ id: string; sourceId: string; roomId: string; room: string; author: string; createdAt: Date; content: string; files: string[] }[]>(
    `select m.id, m."sourceId", m."roomId", r.name room, u.name author, m."createdAt", m.content,
       coalesce(array_agg(f.name order by f.name) filter (where f.id is not null), '{}') files
     from "ChatMessage" m join "ChatRoom" r on r.id = m."roomId" join "User" u on u.id = m."authorId"
     left join "File" f on f."messageId" = m.id
     where m."sourceId" like 'kakao:%' and m."deletedAt" is null and m.content ~ $1
     group by m.id, r.name, u.name order by m."createdAt"`,
    PLACEHOLDER_SQL,
  )
  const hits = rows.map((r) => ({ ...r, after: stripAttachmentPlaceholder(r.content) })).filter((r) => r.after !== r.content)
  const todo = hits.filter((r) => r.files.length > 0)
  const keep = hits.filter((r) => r.files.length === 0)
  const byRoom = new Map<string, { fix: number; keep: number; empty: number }>()
  const room = (id: string) => byRoom.get(id) ?? (byRoom.set(id, { fix: 0, keep: 0, empty: 0 }), byRoom.get(id)!)
  for (const r of todo) { room(r.roomId).fix++; if (r.after === "") room(r.roomId).empty++ }
  for (const r of keep) room(r.roomId).keep++
  console.log(`자리표시가 든 글 ${hits.length}건 · 고칠 것(첨부 있음) ${todo.length}건 (본문이 비는 것 ${todo.filter((r) => r.after === "").length}) · 그대로 둘 것(첨부 없음) ${keep.length}건`)
  // 방 이름은 화면에 내지 않는다(로그가 남는다). 방 id 와 건수만
  for (const [id, c] of [...byRoom].sort((a, b) => b[1].fix - a[1].fix)) console.log(`  ${id}  고칠 ${c.fix} (빈 본문 ${c.empty}) · 둘 ${c.keep}`)

  if (examplesPath) {
    // 방마다 돌아가며 골라 열 건. 사람이 쓴 줄이 남는 글이 있으면 먼저 넣는다
    const mixed = todo.filter((r) => r.after !== "")
    const pool = [...mixed.slice(0, 3), ...todo.filter((r) => r.after === "")]
    const rooms = [...new Set(pool.map((r) => r.roomId))]
    const picked: typeof todo = []
    for (let i = 0; picked.length < 10 && i < pool.length; i++) for (const id of rooms) {
      const c = pool.filter((r) => r.roomId === id && !picked.includes(r))[0]
      if (c && picked.length < 10) picked.push(c)
    }
    const out = {
      at: new Date().toISOString(), target: prod ? "prod" : "local",
      rooms: Object.fromEntries([...byRoom].map(([id, c]) => [rows.find((r) => r.roomId === id)!.room, c])),
      keepSamples: [...new Set(keep.map((r) => r.content.split("\n")[0].replace(/^File: .*/, "File: …")))].slice(0, 10),
      examples: picked.map((r) => ({ room: r.room, author: r.author, at: r.createdAt, before: r.content, after: r.after, files: r.files })),
    }
    writeFileSync(examplesPath, JSON.stringify(out, null, 1), { mode: 0o600 })
    console.log(`예시 ${picked.length}건 → ${resolve(examplesPath)}`)
  }
  if (!apply) return

  const stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(2, 16).replace(/[-:T]/g, "")
  const BACKUP = `${DATA_DIR}/placeholder-backup-${stamp}.json`
  writeFileSync(BACKUP, JSON.stringify({ target: prod ? "prod" : "local", at: new Date().toISOString(), rows: todo.map((r) => ({ id: r.id, sourceId: r.sourceId, before: r.content, after: r.after })) }, null, 1), { mode: 0o600 })
  chmodSync(BACKUP, 0o600)
  const check = JSON.parse(readFileSync(BACKUP, "utf8")) as { rows: unknown[] }
  if (check.rows.length !== todo.length) throw new Error("백업 건수가 맞지 않는다. 중단")
  console.log(`원래 본문 백업 ${todo.length}건 → ${BACKUP}`)

  let n = 0, skipped = 0
  for (const r of todo) {
    const { count } = await prisma.chatMessage.updateMany({ where: { id: r.id, content: r.content }, data: { content: r.after } })
    if (count) n++; else skipped++
  }
  console.log(`고침 ${n}건 · 그 사이 바뀌어 건너뜀 ${skipped}건 · 되돌리기: --restore ${BACKUP}`)
}

main()
  .catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(async () => { const { prisma } = await import("./kakao-common"); await prisma.$disconnect() })
