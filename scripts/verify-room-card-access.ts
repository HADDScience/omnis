/**
 * 참여자 전용 방의 글이 카드 AI 입력 · 검색 근거로 새지 않는가 — HTTP 로 볼 수 없는 경로.
 * 화면 · API · MCP · 첨부는 tests/feature/room-card-access.spec.ts 가 본다.
 *
 *   pnpm exec tsx --env-file=.env scripts/verify-room-card-access.ts
 *
 * 로컬 DB 에만 돌린다. Gemini 는 부르지 않는다 — fetch 를 가로채 보낸 프롬프트를 본다. 만든 것은 끝에 지운다.
 */
process.env.GEMINI_API_KEY = "verify-stub"

const prompts: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init)
  prompts.push(String(init?.body ?? ""))
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } })
}) as typeof fetch

let failed = 0
function check(label: string, ok: boolean) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) failed++
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  console.log(`대상 DB: ${host}`)
  if (!host.startsWith("localhost")) throw new Error("로컬 DB 가 아니다 — 중단")

  const { prisma } = await import("../lib/db")
  const { COMPANY_ROOM_ID, roomAccess, visibleMessageWhere } = await import("../lib/chat-rooms")
  const { runTaskRebuild } = await import("../lib/chat-post")
  const { proposeFromTask } = await import("../lib/card-proposals")
  const { proposeRecordsFromTask } = await import("../lib/record-proposals")
  const { withFollowUps } = await import("../lib/embeddings")

  const [a, b] = await prisma.user.findMany({ where: { isActive: true, id: { not: "system" } }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true } })
  if (!a || !b) throw new Error("활성 사용자 둘이 필요하다")

  const stamp = Date.now()
  const PUBLIC_LINE = `전사방 예시 문장입니다 ${stamp}`
  const ROOM_LINE = `단톡방 예시 문장입니다 ${stamp}`
  const task = await prisma.task.create({ data: { name: `방 권한 검증 ${stamp}`, slug: `room-verify-${stamp}`, instructorId: a.id, status: "DONE" } })
  const room = await prisma.chatRoom.create({ data: { name: `검증 단톡 ${stamp}`, kind: "GROUP", members: { create: { userId: a.id } } } })
  const at = (n: number) => new Date(Date.now() - 60_000 + n * 1000)
  const head = await prisma.chatMessage.create({ data: { roomId: COMPANY_ROOM_ID, authorId: a.id, content: PUBLIC_LINE, taskId: task.id, createdAt: at(0) } })
  const later = await prisma.chatMessage.create({ data: { roomId: COMPANY_ROOM_ID, authorId: a.id, content: `${PUBLIC_LINE} 이어서`, taskId: task.id, createdAt: at(1) } })
  await prisma.chatMessage.create({ data: { roomId: room.id, authorId: a.id, content: ROOM_LINE, taskId: task.id, createdAt: at(2) } })

  try {
    console.log("\n[1] 권한 조건이 roomAccess 와 같다")
    for (const [who, id] of [["참여자", a.id], ["비참여자", b.id]] as const) {
      for (const [where, roomId] of [["단톡", room.id], ["전사방", COMPANY_ROOM_ID]] as const) {
        const byWhere = (await prisma.chatMessage.count({ where: { taskId: task.id, roomId, ...visibleMessageWhere(id) } })) > 0
        check(`${who} · ${where}`, byWhere === ((await roomAccess(roomId, id)) === "ok"))
      }
    }

    const inputs = async (label: string, run: () => Promise<unknown>) => {
      prompts.length = 0
      await run().catch(() => {})
      const sent = prompts.join("\n")
      check(`${label}: 전사방 글은 입력에 있다`, sent.includes(PUBLIC_LINE))
      check(`${label}: 단톡 글은 입력에 없다 (거부되어야 하는 경우)`, !sent.includes(ROOM_LINE))
    }

    console.log("\n[2] AI 입력")
    await inputs("카드 재구성", () =>
      runTaskRebuild({ user: { id: a.id, name: a.name }, roomId: COMPANY_ROOM_ID, taskId: task.id, messageId: later.id, messageCreatedAt: at(5) } as Parameters<typeof runTaskRebuild>[0]),
    )
    await inputs("지식 카드 제안", () => proposeFromTask(task.id, { userId: a.id }))
    await inputs("기록 제안", () => proposeRecordsFromTask(task.id, { userId: a.id }))

    console.log("\n[3] 검색 근거의 「이후 대화」")
    const [chunk] = await withFollowUps([{ source: "CHAT_MESSAGE", sourceId: head.id, title: "t", content: "c", similarity: 1 } as never])
    const followed = (chunk as unknown as { content: string }).content
    check("전사방 이후 대화는 붙는다", followed.includes(`${PUBLIC_LINE} 이어서`))
    check("단톡 글은 붙지 않는다 (거부되어야 하는 경우)", !followed.includes(ROOM_LINE))
  } finally {
    await prisma.cardProposal.deleteMany({ where: { triggerTaskId: task.id } })
    await prisma.recordProposal.deleteMany({ where: { triggerTaskId: task.id } })
    await prisma.activityLog.deleteMany({ where: { entityId: task.id } })
    await prisma.chatMessage.deleteMany({ where: { taskId: task.id } })
    await prisma.chatRoom.delete({ where: { id: room.id } })
    await prisma.task.delete({ where: { id: task.id } })
    await prisma.$disconnect()
  }
  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과")
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
