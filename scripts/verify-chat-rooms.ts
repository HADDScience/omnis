/**
 * 채팅방 모델(1단계) 검증 — 남의 옴니스 1:1 방이 목록 · 피드 · 색인 · 권한 어디로도 새지 않는가.
 *
 *   pnpm exec tsx --env-file=.env scripts/verify-chat-rooms.ts
 *
 * 로컬 DB 에만 돌린다. 시험용 방 하나와 글 하나를 만들고 끝에 지운다.
 * HTTP 경로(403)는 dev 서버를 띄운 뒤 scripts/verify-omnis-room-http.ts 가 본다.
 */
import { prisma } from "../lib/db"
import { COMPANY_ROOM_ID, listRooms, previewText, roomAccess } from "../lib/chat-rooms"
import { readChatFeed } from "../lib/chat-feed"
import { getSystemUserId } from "../lib/system-user"

let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  console.log(`대상 DB: ${host}`)
  if (!host.startsWith("localhost")) throw new Error("로컬 DB 가 아니다 — 중단")

  const [a, b] = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true } })
  if (!a || !b) throw new Error("활성 사용자 둘이 필요하다")
  console.log(`A=${a.name} · B=${b.name}`)

  const marker = `시험: 1:1 방 누출 확인 ${Date.now()}`
  const room = await prisma.chatRoom.create({
    data: { name: "시험 방", kind: "OMNIS_DM", createdById: a.id, lastMessageAt: new Date(), members: { create: { userId: a.id } } },
  })
  try {
    await prisma.chatMessage.create({ data: { roomId: room.id, authorId: a.id, content: marker } })
    await prisma.chatMessage.create({ data: { roomId: room.id, authorId: await getSystemUserId(), content: `${marker} 답` } })

    console.log("\n[1] 기존 방은 COMPANY")
    const company = await prisma.chatRoom.findUnique({ where: { id: COMPANY_ROOM_ID }, select: { kind: true } })
    check("default-room 의 kind 가 COMPANY", company?.kind === "COMPANY", company)
    check("COMPANY 아닌 방은 모두 만든 사람이 있다", (await prisma.chatRoom.count({ where: { kind: { not: "COMPANY" }, createdById: null } })) === 0)

    console.log("\n[2] 읽기 권한")
    check("A 는 자기 1:1 방을 읽는다", (await roomAccess(room.id, a.id)) === "ok")
    check("B 는 A 의 1:1 방을 못 읽는다 (거부되어야 하는 경우)", (await roomAccess(room.id, b.id)) === "forbidden")
    check("B 는 전사방을 읽는다", (await roomAccess(COMPANY_ROOM_ID, b.id)) === "ok")
    check("없는 방은 missing", (await roomAccess("no-such-room", b.id)) === "missing")

    console.log("\n[3] 목록")
    const listA = await listRooms(a.id)
    const listB = await listRooms(b.id)
    check("A 의 목록에 그 방이 옴니스 칸으로", listA.omnis.some((r) => r.id === room.id))
    check("A 의 목록 미리보기는 옴니스 글", listA.omnis.find((r) => r.id === room.id)?.preview?.startsWith("옴니스: ") ?? false)
    check("B 의 목록에는 없다 (거부되어야 하는 경우)", ![...listB.omnis, ...listB.groups].some((r) => r.id === room.id))
    check("전사방이 목록 맨 위", listB.company[0]?.id === COMPANY_ROOM_ID, listB.company.map((r) => r.id))
    check("업무방은 최근 글 순", listB.tasks.every((t, i, all) => i === 0 || all[i - 1].lastAt >= t.lastAt))
    check("업무방 id 는 업무 id", listB.tasks.length === 0 || (await prisma.task.count({ where: { id: { in: listB.tasks.map((t) => t.id) } } })) === listB.tasks.length)
    console.log(`    옴니스 ${listA.omnis.length} · 전사 ${listB.company.length} · 업무 ${listB.tasks.length} · 단톡 ${listB.groups.length}`)

    console.log("\n[4] 방을 가리지 않는 읽기에 새지 않는다")
    for (const view of ["all", "ai"] as const) {
      const feed = await readChatFeed({ currentUserId: b.id, view, take: 200 })
      check(`피드 view=${view} 에 1:1 글이 없다`, "messages" in feed && !feed.messages.some((m) => m.content.startsWith(marker)))
    }
    const feedA = await readChatFeed({ currentUserId: a.id, view: "all", take: 200 })
    check("만든 사람의 피드에도 없다 — 피드는 전사방 보기다", "messages" in feedA && !feedA.messages.some((m) => m.content.startsWith(marker)))

    console.log("\n[5] 미리보기 문구")
    check("업무 카드 표식", previewText("__TASK_CREATED__:abc", "TASK_CREATED") === "업무가 생성되었습니다")
    check("🤖 접두사를 뗀다", previewText("🤖 업무를 갱신했습니다", "NORMAL") === "업무를 갱신했습니다")
    check("60자에서 자른다", previewText("가".repeat(80), "NORMAL") === `${"가".repeat(60)}…`)
  } finally {
    await prisma.chatMessage.deleteMany({ where: { roomId: room.id } })
    await prisma.chatRoom.delete({ where: { id: room.id } })
  }

  console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}건`)
  await prisma.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
