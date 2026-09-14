/**
 * 🤖 시스템 메시지의 작성자를 시스템 계정(Omnis)으로 옮긴다.
 *
 *   npx tsx --env-file=.env scripts/backfill-system-author.ts            # 미리보기 (아무것도 안 바꾼다)
 *   npx tsx --env-file=.env scripts/backfill-system-author.ts --apply    # 실제로 바꾼다
 *
 * 예전 lib/chat-post.ts 는 정렬 없는 첫 ADMIN 을 작성자로 썼다. 그래서 이미 쌓인 재구성·완료 확인 대기
 * 메시지에 업무와 무관한 관리자 이름이 찍혀 있다. 대상은 내용이 🤖 로 시작하는 메시지뿐이다 —
 * 그 접두사는 chat-post 만 붙이고, 사람이 채팅에 🤖 로 시작하는 글을 쓴 경우는 목록에 이름이 드러나니 미리보기에서 확인한다.
 *
 * 되돌리기: --apply 가 바꾼 (메시지 id, 원래 작성자 id) 를 JSON 으로 남긴다.
 */
import { writeFileSync } from "fs"
import { prisma } from "../lib/db"
import { getSystemUserId, SYSTEM_USER_ID } from "../lib/system-user"

async function main() {
  const apply = process.argv.includes("--apply")
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  console.log(`대상 DB: ${host || "(DATABASE_URL 없음)"} · ${apply ? "적용" : "미리보기"}`)

  const rows = await prisma.chatMessage.findMany({
    where: { content: { startsWith: "🤖" }, authorId: { not: SYSTEM_USER_ID } },
    select: { id: true, authorId: true, kind: true, createdAt: true, content: true, author: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  })

  const byAuthor = new Map<string, number>()
  for (const r of rows) byAuthor.set(r.author.name, (byAuthor.get(r.author.name) ?? 0) + 1)
  console.log(`옮길 메시지 ${rows.length}건 — ${[...byAuthor].map(([n, c]) => `${n} ${c}`).join(", ") || "없음"}`)
  const kinds = new Map<string, number>()
  for (const r of rows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1)
  console.log(`종류: ${[...kinds].map(([k, c]) => `${k} ${c}`).join(", ") || "-"}`)
  for (const r of rows.slice(0, 5)) console.log(`  ${r.createdAt.toISOString().slice(0, 16)} ${r.author.name}: ${r.content.slice(0, 60)}`)

  if (!apply || rows.length === 0) {
    await prisma.$disconnect()
    return
  }

  const systemId = await getSystemUserId()
  const backup = `backfill-system-author-${new Date().toISOString().replace(/[:.]/g, "")}.json`
  writeFileSync(backup, JSON.stringify(rows.map((r) => ({ id: r.id, authorId: r.authorId })), null, 2))
  const updated = await prisma.chatMessage.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { authorId: systemId },
  })
  console.log(`바꿈 ${updated.count}건 · 원래 작성자 기록 ${backup}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
