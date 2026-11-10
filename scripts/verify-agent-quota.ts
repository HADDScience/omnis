/**
 * 데모 비용 방어 HTTP 검증 — 하루 상한 · 사람당 실행 수 · 연달아 보내기. dev 서버를 환경변수를 바꿔 띄운 뒤 단계마다 돌린다.
 *
 *   MODE=daily  — dev 를 NEXT_PUBLIC_IS_DEMO=true OMNIS_AGENT_DAILY_KRW=<오늘 쓴 원보다 작게> 로 띄운다.
 *                 새 대화 · 기존 방 글 모두 429 + 데모 문구, 방 · 글을 남기지 않는다. 기다리던 카드 [취소] 는 처리된다(모델 1회)
 *   MODE=runs   — dev 를 OMNIS_AGENT_USER_DAILY_RUNS=1 로 띄운다. 오늘 실행이 있는 사람은 429(모델 호출 없음)
 *   MODE=busy   — dev 를 상한 없이(운영 기본) 띄운다. 같은 사람이 다른 방에서 돌고 있으면 409(모델 호출 없음)
 *
 *   MODE=daily BASE=http://localhost:3103 pnpm exec tsx --env-file=.env scripts/verify-agent-quota.ts
 * 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { kstDayStart } from "../lib/agent/quota"

const BASE = process.env.BASE ?? "http://localhost:3103"
const MODE = process.env.MODE ?? ""
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

async function cookieFor(user: { id: string; name: string; role: string }) {
  const token = await encode({
    token: { sub: user.id, id: user.id, role: user.role, name: user.name },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 600,
  })
  return `authjs.session-token=${token}`
}

async function post(cookie: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const type = res.headers.get("content-type") ?? ""
  const text = await res.text() // 스트림이면 끝까지 읽는다
  return { status: res.status, type, json: type.includes("json") ? JSON.parse(text) : null, text }
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  if (!host.startsWith("localhost")) throw new Error(`로컬 DB 가 아니다 (${host}) — 중단`)
  const since = kstDayStart()
  const spent = Number((await prisma.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { costKrw: true } }))._sum.costKrw ?? 0)
  console.log(`대상 DB: ${host} · 서버: ${BASE} · MODE=${MODE} · 오늘(${since.toISOString()} 부터) 쓴 원 ${spent.toFixed(1)}`)

  const me = await prisma.user.findFirstOrThrow({ where: { name: "정우창", isActive: true }, select: { id: true, name: true, role: true } })
  const A = await cookieFor(me)
  const room = await prisma.chatRoom.findFirstOrThrow({ where: { kind: "OMNIS_DM", members: { some: { userId: me.id } } }, orderBy: { lastMessageAt: "desc" }, select: { id: true } })
  const roomsBefore = await prisma.chatRoom.count({ where: { kind: "OMNIS_DM", createdById: me.id } })
  const msgsBefore = await prisma.chatMessage.count({ where: { roomId: room.id } })
  const usageBefore = await prisma.aiUsage.count()

  if (MODE === "daily") {
    console.log("[1] 하루 전체 상한에 닿은 뒤")
    const fresh = await post(A, "/api/agent/rooms", { content: "상한 시험 — 이번 주 마감 업무 알려 줘" })
    check("새 대화는 429 (거부되어야 하는 경우)", fresh.status === 429, fresh.status)
    check("문구 「오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요」", fresh.json?.error === "오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요", fresh.json)
    check("빈 방을 만들지 않았다", (await prisma.chatRoom.count({ where: { kind: "OMNIS_DM", createdById: me.id } })) === roomsBefore)
    const more = await post(A, `/api/agent/rooms/${room.id}`, { content: "상한 시험 — 그중 지연된 것만" })
    check("기존 방에 새 글도 429", more.status === 429, more.status)
    check("질문 글을 남기지 않았다", (await prisma.chatMessage.count({ where: { roomId: room.id } })) === msgsBefore)
    check("모델을 부르지 않았다(AiUsage 줄 그대로)", (await prisma.aiUsage.count()) === usageBefore)

    console.log("[2] 확인을 기다리던 카드는 처리된다")
    const card = await prisma.agentStep.findFirst({
      where: { status: "PENDING", run: { status: "AWAITING_APPROVAL", userId: me.id, model: "openai:gpt-6-luna" } },
      select: { id: true, planHash: true, runId: true },
    })
    if (!card) {
      console.log("  (기다리는 카드가 없어 건너뜀)")
    } else {
      const r = await post(A, `/api/agent/steps/${card.id}`, { decision: "reject", planHash: card.planHash })
      check("[취소] 는 상한과 상관없이 받는다(스트림)", r.status === 200 && r.type.includes("text/event-stream"), { status: r.status, body: r.text.slice(0, 200) })
      const after = await prisma.agentStep.findUnique({ where: { id: card.id }, select: { status: true } })
      check("카드는 REJECTED", after?.status === "REJECTED", after)
      const run = await prisma.agentRun.findUnique({ where: { id: card.runId }, select: { status: true } })
      console.log(`    이어 간 실행: ${run?.status} · 모델 호출 ${(await prisma.aiUsage.count()) - usageBefore}회`)
    }
  } else if (MODE === "runs") {
    console.log("[3] 사람당 하루 실행 수 = 1")
    const todayRuns = await prisma.agentRun.count({ where: { userId: me.id, createdAt: { gte: since } } })
    console.log(`    정우창 오늘 실행 ${todayRuns}개`)
    const r = await post(A, `/api/agent/rooms/${room.id}`, { content: "상한 시험 — 실행 수" })
    check("오늘 실행이 있으면 429 (거부되어야 하는 경우)", r.status === 429, r.status)
    check("문구에 「1회」", typeof r.json?.error === "string" && r.json.error.includes("1회"), r.json)
    check("질문 글을 남기지 않았다", (await prisma.chatMessage.count({ where: { roomId: room.id } })) === msgsBefore)
  } else if (MODE === "busy") {
    console.log("[4] 연달아 보내기 — 같은 사람이 다른 방에서 돌고 있을 때")
    const other = await prisma.chatRoom.create({ data: { name: "상한 시험 다른 방", kind: "OMNIS_DM", createdById: me.id, members: { create: { userId: me.id } } } })
    const q = await prisma.chatMessage.create({ data: { roomId: other.id, authorId: me.id, content: "상한 시험 — 돌고 있는 척" } })
    await prisma.agentRun.create({ data: { roomId: other.id, userId: me.id, questionMessageId: q.id, model: "openai:gpt-6-luna", messages: [], status: "RUNNING" } })
    try {
      const r = await post(A, `/api/agent/rooms/${room.id}`, { content: "상한 시험 — 연달아" })
      check("다른 방에서 돌고 있으면 409 (거부되어야 하는 경우)", r.status === 409, r.status)
      check("문구 「다른 대화에서 옴니스가 아직 답하는 중이에요」", typeof r.json?.error === "string" && r.json.error.startsWith("다른 대화에서"), r.json)
      const same = await post(A, `/api/agent/rooms/${other.id}`, { content: "상한 시험 — 같은 방" })
      check("같은 방이면 예전 문구로 409", same.status === 409 && same.json?.error === "옴니스가 아직 앞의 글에 답하는 중입니다", same.json)
      const fresh = await post(A, "/api/agent/rooms", { content: "상한 시험 — 새 대화" })
      check("새 대화도 409 · 빈 방을 남기지 않는다", fresh.status === 409 && (await prisma.chatRoom.count({ where: { kind: "OMNIS_DM", createdById: me.id } })) === roomsBefore + 1, fresh.status)
      check("질문 글을 남기지 않았다", (await prisma.chatMessage.count({ where: { roomId: room.id } })) === msgsBefore)
      check("모델을 부르지 않았다(AiUsage 줄 그대로)", (await prisma.aiUsage.count()) === usageBefore)
    } finally {
      await prisma.agentRun.deleteMany({ where: { roomId: other.id } })
      await prisma.chatMessage.deleteMany({ where: { roomId: other.id } })
      await prisma.chatRoom.delete({ where: { id: other.id } })
    }
  } else {
    throw new Error("MODE=daily | runs | busy")
  }

  console.log(failed === 0 ? "전부 통과" : `실패 ${failed}건`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
