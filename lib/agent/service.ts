// 에이전트 — 라우트가 부르는 쪽. 묻기(실행 열기) · 확인/취소 · 방 화면 상태 · 스트림 다시 붙기.
// 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md 3단계
import type { ModelMessage } from "ai"
import { start, getRun } from "workflow/api"
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { buildOmnisHistory, HISTORY_MAX_MESSAGES } from "@/lib/omnis-history"
import { roomNameFrom, type OmnisRoomMessage } from "@/lib/omnis-room"
import type { AskSource } from "@/lib/omnis-ask"
import { modelFor, modelKey } from "@/lib/ai-models"
import { agentQuota, kstDayStart, quotaEnabled, quotaRefusal } from "./quota"
import { omnisAgentWorkflow } from "./workflow"
import { approvalResponses } from "./messages"
import { checkDecision, type StepStatus } from "./approval"
import type { WritePreview } from "./tools"

export type Fail = { ok: false; status: number; error: string }

/** 확인 카드 — 화면이 그리는 모양 */
export interface AgentCard {
  id: string
  runId: string
  toolName: string
  status: StepStatus
  preview: WritePreview
  planHash: string
  blockedReason: string | null
  result: string | null
  createdAt: string
  decidedAt: string | null
}

export interface AgentRoomState {
  room: { id: string; name: string }
  messages: OmnisRoomMessage[]
  cards: AgentCard[]
  /** 돌고 있는 실행 — 새로고침 뒤 스트림을 다시 붙는다 */
  activeRun: { id: string; status: string } | null
}

/** 돌고 있다고 보는 시간. 이보다 오래 RUNNING 이면 죽은 실행으로 보고 새 글을 받는다 */
const RUNNING_STALE_MS = 5 * 60 * 1000

async function ownRoom(roomId: string, userId: string) {
  return prisma.chatRoom.findFirst({ where: { id: roomId, kind: "OMNIS_DM", members: { some: { userId } } }, select: { id: true, name: true } })
}

function shapeMessage(m: { id: string; content: string; createdAt: Date; authorId: string; omnisQuery: { sources: unknown } | null }): OmnisRoomMessage {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    fromOmnis: m.authorId === SYSTEM_USER_ID,
    sources: Array.isArray(m.omnisQuery?.sources) ? (m.omnisQuery.sources as unknown as AskSource[]) : [],
  }
}

function shapeCard(s: {
  id: string; runId: string; toolName: string; status: string; preview: unknown; planHash: string
  blockedReason: string | null; result: string | null; createdAt: Date; decidedAt: Date | null
}): AgentCard {
  return {
    id: s.id, runId: s.runId, toolName: s.toolName, status: s.status as StepStatus, preview: s.preview as WritePreview,
    planHash: s.planHash, blockedReason: s.blockedReason, result: s.result,
    createdAt: s.createdAt.toISOString(), decidedAt: s.decidedAt?.toISOString() ?? null,
  }
}

export async function loadAgentRoom(roomId: string, userId: string): Promise<AgentRoomState | null> {
  const room = await ownRoom(roomId, userId)
  if (!room) return null
  const [rows, steps, active] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true, createdAt: true, authorId: true, omnisQuery: { select: { sources: true } } },
    }),
    prisma.agentStep.findMany({ where: { run: { roomId, userId } }, orderBy: { createdAt: "asc" } }),
    prisma.agentRun.findFirst({
      where: { roomId, userId, status: { in: ["RUNNING", "AWAITING_APPROVAL"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.chatRoomMember.update({ where: { roomId_userId: { roomId, userId } }, data: { lastReadAt: new Date() } }),
  ])
  const live = active && (active.status !== "RUNNING" || Date.now() - active.updatedAt.getTime() < RUNNING_STALE_MS) ? active : null
  return {
    room,
    messages: rows.map(shapeMessage),
    cards: steps.map(shapeCard),
    activeRun: live ? { id: live.id, status: live.status } : null,
  }
}

function streamResponse(workflowRunId: string, readable: ReadableStream, headers: Record<string, string>) {
  return { workflowRunId, stream: readable.pipeThrough(createModelCallToUIChunkTransform()), headers }
}

export interface Started {
  ok: true
  runId: string
  question: OmnisRoomMessage
  stream: ReadableStream
  headers: Record<string, string>
}

/**
 * 옴니스 방에 묻는다 — 질문 글을 남기고 실행을 연다. content 는 새 글, retryOf 는 답을 못 받은 내 글.
 * 확인을 기다리던 앞 실행이 있으면 버린다(카드는 EXPIRED) — 새 글이 오면 앞의 제안은 낡은 것이다.
 */
export async function startAgentTurn(input: { roomId: string; userId: string; content?: string; retryOf?: string }): Promise<Started | Fail> {
  const { roomId, userId } = input
  if (!(await ownRoom(roomId, userId))) return { ok: false, status: 404, error: "대화를 찾을 수 없습니다" }
  if (!input.retryOf && !input.content) return { ok: false, status: 400, error: "보낼 내용이 없습니다" }

  // 받을지 정하고(돌고 있는 실행 · 하루 상한) 질문 글 · 실행을 만드는 것까지 한 트랜잭션 — 사람마다 잠근다.
  // 잠그지 않으면 같은 사람이 연달아 보낸 두 요청이 둘 다 「돌고 있는 실행 없음」 을 보고 동시에 실행을 연다
  const gate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-run:${userId}`}))`
    const refused = await admissionRefusal(tx, userId, roomId)
    if (refused) return refused

    let question: { id: string; content: string; createdAt: Date; authorId: string }
    if (input.retryOf) {
      const target = await tx.chatMessage.findFirst({ where: { id: input.retryOf, roomId, authorId: userId, deletedAt: null } })
      if (!target) return { ok: false as const, status: 404, error: "다시 물을 글을 찾을 수 없습니다" }
      const answered = await tx.chatMessage.count({ where: { roomId, authorId: SYSTEM_USER_ID, createdAt: { gt: target.createdAt } } })
      if (answered > 0) return { ok: false as const, status: 409, error: "이미 답을 받은 글입니다" }
      question = target
    } else {
      const now = new Date()
      question = await tx.chatMessage.create({ data: { roomId, authorId: userId, content: input.content!, createdAt: now } })
      await tx.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: now } })
    }

    // 확인을 기다리던 앞 실행은 버린다
    const stale = await tx.agentRun.findMany({ where: { roomId, status: "AWAITING_APPROVAL" }, select: { id: true } })
    if (stale.length) {
      await tx.agentStep.updateMany({ where: { runId: { in: stale.map((r) => r.id) }, status: "PENDING" }, data: { status: "EXPIRED" } })
      await tx.agentRun.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { status: "CANCELLED" } })
    }

    const before = await tx.chatMessage.findMany({
      where: { roomId, deletedAt: null, createdAt: { lt: question.createdAt } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MAX_MESSAGES * 2,
      select: { content: true, authorId: true },
    })
    const history = buildOmnisHistory(before.reverse().map((m) => ({ fromOmnis: m.authorId === SYSTEM_USER_ID, content: m.content })))
    const messages: ModelMessage[] = [
      ...history.map((t) => ({ role: t.role === "model" ? ("assistant" as const) : ("user" as const), content: t.text })),
      { role: "user", content: question.content },
    ]
    const run = await tx.agentRun.create({
      data: {
        roomId, userId, questionMessageId: question.id, model: modelKey(modelFor("agent")),
        messages: messages as unknown as Prisma.InputJsonValue,
      },
    })
    return { ok: true as const, run, question }
  })
  if (!gate.ok) return gate
  const { run, question } = gate

  const wf = await start(omnisAgentWorkflow, [run.id])
  await prisma.agentRun.update({ where: { id: run.id }, data: { workflowRunId: wf.runId } })
  const r = streamResponse(wf.runId, wf.readable, { "x-agent-run-id": run.id, "x-question-id": question.id })
  return {
    ok: true, runId: run.id,
    question: shapeMessage({ ...question, omnisQuery: null }),
    stream: r.stream, headers: r.headers,
  }
}

/**
 * 새 실행을 받지 않을 이유. 없으면 null.
 * - 같은 사람이 돌고 있는 실행이 있으면 409 — 방이 달라도. 연달아 보낸 요청이 모델을 겹쳐 부르지 않게(앞 실행은 그대로 끝까지 간다)
 * - 하루 상한(lib/agent/quota.ts)에 닿았으면 429. 환경변수가 없으면 DB 를 읽지 않는다
 */
async function admissionRefusal(db: Prisma.TransactionClient | typeof prisma, userId: string, roomId: string | null): Promise<Fail | null> {
  const running = await db.agentRun.findFirst({
    where: { userId, status: "RUNNING", updatedAt: { gt: new Date(Date.now() - RUNNING_STALE_MS) } },
    select: { roomId: true },
  })
  if (running) {
    return {
      ok: false, status: 409,
      error: running.roomId === roomId ? "옴니스가 아직 앞의 글에 답하는 중입니다" : "다른 대화에서 옴니스가 아직 답하는 중이에요. 끝난 뒤 보내 주세요",
    }
  }
  const quota = agentQuota()
  if (!quotaEnabled(quota)) return null
  const since = kstDayStart()
  const [spent, runs] = await Promise.all([
    quota.dailyKrw === null ? null : db.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { costKrw: true } }),
    quota.userDailyRuns === null ? 0 : db.agentRun.count({ where: { userId, createdAt: { gte: since } } }),
  ])
  const refusal = quotaRefusal({ usedKrw: Number(spent?._sum.costKrw ?? 0), userRuns: runs }, quota)
  return refusal ? { ok: false, status: refusal.status, error: refusal.error } : null
}

/** 새 대화 — 첫 글과 함께 방을 만들고 바로 연다. 빈 방은 만들지 않는다 */
export async function startAgentRoom(userId: string, content: string): Promise<(Started & { roomId: string }) | Fail> {
  // 받지 않을 요청이면 방부터 만들지 않는다(잠금 없이 먼저 본다 — 경합은 startAgentTurn 이 다시 막는다)
  const early = await admissionRefusal(prisma, userId, null)
  if (early) return early
  const room = await prisma.chatRoom.create({
    data: {
      name: roomNameFrom(content), kind: "OMNIS_DM", createdById: userId,
      members: { create: { userId, lastReadAt: new Date() } },
    },
    select: { id: true },
  })
  const r = await startAgentTurn({ roomId: room.id, userId, content })
  if (!r.ok) {
    // 경합으로 막혔으면 빈 방을 남기지 않는다(글이 없을 때만 — 참여자 행은 cascade)
    if ((await prisma.chatMessage.count({ where: { roomId: room.id } })) === 0) await prisma.chatRoom.delete({ where: { id: room.id } })
    return r
  }
  return { ...r, roomId: room.id, headers: { ...r.headers, "x-room-id": room.id } }
}

/**
 * 확인 카드에 [확인] · [취소]. 승인은 화면이 받은 planHash 에 묶이고(바뀌었으면 거절), PENDING 일 때 한 번만 된다.
 * 그 구간의 카드가 모두 정해지면 승인 응답을 대화에 붙여 같은 실행을 이어 간다(스트림을 돌려준다).
 */
export async function decideAgentStep(input: { stepId: string; userId: string; decision: "approve" | "reject"; planHash: string }):
  Promise<{ ok: true; card: AgentCard; continued: { stream: ReadableStream; headers: Record<string, string> } | null } | Fail> {
  const step = await prisma.agentStep.findUnique({ where: { id: input.stepId }, include: { run: { select: { id: true, userId: true, status: true, messages: true } } } })
  const check = checkDecision(
    step ? { ...step, status: step.status as StepStatus } : null,
    { userId: input.userId, ownerId: step?.run.userId ?? "", decision: input.decision, planHash: input.planHash }
  )
  if (!check.ok) return check
  if (step!.run.status !== "AWAITING_APPROVAL") return { ok: false, status: 409, error: "이 제안을 기다리던 실행이 끝났습니다" }

  // 한 번만 — PENDING 이고 해시가 같을 때만 바뀐다. 동시에 두 번 눌러도 하나만 통과한다
  const done = await prisma.agentStep.updateMany({
    where: { id: step!.id, status: "PENDING", planHash: input.planHash },
    data: { status: input.decision === "approve" ? "APPROVED" : "REJECTED", decidedById: input.userId, decidedAt: new Date() },
  })
  if (done.count !== 1) return { ok: false, status: 409, error: "이미 처리된 제안입니다" }

  const runId = step!.runId
  const all = await prisma.agentStep.findMany({ where: { runId }, orderBy: { createdAt: "asc" } })
  const card = shapeCard(all.find((s) => s.id === step!.id)!)
  if (all.some((s) => s.status === "PENDING")) return { ok: true, card, continued: null }

  // 이 실행의 대화에 아직 응답이 없는 승인 요청에만 응답을 붙인다
  const messages = step!.run.messages as unknown as ModelMessage[]
  const answered = new Set<string>()
  for (const m of messages) {
    if (m.role === "tool" && Array.isArray(m.content)) {
      for (const p of m.content as { type: string; approvalId?: string }[]) if (p.type === "tool-approval-response" && p.approvalId) answered.add(p.approvalId)
    }
  }
  const toAnswer = all.filter((s) => !answered.has(s.approvalId) && ["APPROVED", "REJECTED", "BLOCKED"].includes(s.status))
  const next = [...messages, approvalResponses(toAnswer)]

  // AWAITING → RUNNING 도 조건부로 — 두 카드의 마지막 결정이 동시에 와도 이어 가기는 한 번
  const moved = await prisma.agentRun.updateMany({
    where: { id: runId, status: "AWAITING_APPROVAL" },
    data: { status: "RUNNING", messages: next as unknown as Prisma.InputJsonValue },
  })
  if (moved.count !== 1) return { ok: true, card, continued: null }

  const wf = await start(omnisAgentWorkflow, [runId])
  await prisma.agentRun.update({ where: { id: runId }, data: { workflowRunId: wf.runId } })
  const r = streamResponse(wf.runId, wf.readable, { "x-agent-run-id": runId })
  return { ok: true, card, continued: { stream: r.stream, headers: r.headers } }
}

/** 새로고침 뒤 돌고 있는 실행의 스트림에 다시 붙는다(처음부터 다시 보낸다) */
export async function reattachAgentRun(runId: string, userId: string): Promise<{ ok: true; stream: ReadableStream; headers: Record<string, string> } | Fail> {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, userId }, select: { status: true, workflowRunId: true } })
  if (!run) return { ok: false, status: 404, error: "실행을 찾을 수 없습니다" }
  if (run.status !== "RUNNING" || !run.workflowRunId) return { ok: false, status: 409, error: "돌고 있는 실행이 아닙니다" }
  const wf = getRun(run.workflowRunId)
  const r = streamResponse(run.workflowRunId, wf.getReadable({ startIndex: 0 }), { "x-agent-run-id": runId })
  return { ok: true, stream: r.stream, headers: r.headers }
}
