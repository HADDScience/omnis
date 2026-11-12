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
import { budgetGate } from "@/lib/ai-budget"
import type { BudgetBlock } from "@/lib/ai-budget-rules"
import { omnisAgentWorkflow } from "./workflow"
import { approvalResponses } from "./messages"
import { checkDecision, type StepStatus } from "./approval"
import type { WritePreview } from "./tools"
import { toolTrail, type ToolUse } from "./tool-trail"
import { stopRun } from "./stop"
import { AGENT_STOP_NAMESPACE } from "./stop-stream"
import { checkAttachable } from "@/lib/file-access"
import { IS_DEMO } from "@/lib/demo"
import { historyWithAttachmentNames, questionWithAttachments } from "./attachments"
import { readAttachment } from "./attachments-server"
import { peopleRoomTitle } from "@/lib/chat-people-rules"

export type Fail = { ok: false; status: number; error: string; budget?: BudgetBlock }

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
  /** 이 카드를 연 실행의 요청자 — 공유 세션에서는 요청자만 [확인] · [취소] 를 누른다(서버는 checkDecision 이 막는다) */
  requester?: { id: string; name: string }
  /** 보는 사람이 누를 수 있는가 */
  canDecide?: boolean
}

/** 사람 방(@옴니스)에서 연 공유 세션이면 그 방 — 보는 사람 기준 이름(1:1 은 상대 이름) */
export interface SessionOrigin {
  id: string
  title: string
}

export interface AgentRoomState {
  room: {
    id: string
    name: string
    origin: SessionOrigin | null
    /** 세션 주인(연 사람 · 인계받은 사람). 공유 · 해제 · 인계는 주인만(lib/omnis-session-share.ts) */
    owner?: { id: string; name: string } | null
    isOwner?: boolean
    /** 볼 수 있는 사람 수(주인 포함). 2 이상이면 공유 중 */
    memberCount?: number
  }
  messages: OmnisRoomMessage[]
  cards: AgentCard[]
  /** 돌고 있는 실행 — 새로고침 뒤 스트림을 다시 붙는다 */
  activeRun: { id: string; status: string } | null
  /** 질문 글 id → 그 질문에 답하며 옴니스가 쓴 도구(부른 순서). 답이 끝나도 · 새로고침해도 남는다 */
  tools: Record<string, ToolUse[]>
  /** 이 앞에 글이 더 있는가 — 위로 올리면 OMNIS_PAGE_SIZE 개씩 더 받는다 */
  hasMore: boolean
  /** 사용자가 멈춘 질문 글 id → 그때까지의 답 글 id(「중지됨」 을 붙인다). 글 없이 멈췄으면 null(「답을 멈췄어요」) */
  stopped: Record<string, string | null>
  /** 공유 세션에서 남이 연 실행이 돌고 있으면 그 사람 이름. 남의 스트림에는 붙지 않는다(reattach 는 본인만) */
  busyBy: string | null
}

/** 돌고 있다고 보는 시간. 이보다 오래 RUNNING 이면 죽은 실행으로 보고 새 글을 받는다 */
const RUNNING_STALE_MS = 5 * 60 * 1000

/**
 * 내가 참여한 옴니스 방 — 내 세션, 또는 내가 든 사람 방에서 연 공유 세션(참여자를 그 방과 같게 둔다, lib/omnis-mention.ts).
 * 목록에서 지운 대화(ChatRoomPref.hiddenAt)는 없는 방과 같다 — 화면 · 묻기 · 상태 모두 404
 */
async function ownRoom(roomId: string, userId: string) {
  const [room, pref] = await Promise.all([
    prisma.chatRoom.findFirst({
      where: { id: roomId, kind: "OMNIS_DM", members: { some: { userId } } },
      select: { id: true, name: true, originRoomId: true, createdById: true, createdBy: { select: { id: true, name: true } }, _count: { select: { members: true } } },
    }),
    prisma.chatRoomPref.findUnique({ where: { userId_roomKey: { userId, roomKey: `room:${roomId}` } }, select: { hiddenAt: true } }),
  ])
  return pref?.hiddenAt ? null : room
}

type FileShape = NonNullable<OmnisRoomMessage["files"]>[number]

function shapeMessage(m: { id: string; content: string; createdAt: Date; authorId: string; author?: { id: string; name: string }; omnisQuery: { sources: unknown } | null; files?: FileShape[] }): OmnisRoomMessage {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    fromOmnis: m.authorId === SYSTEM_USER_ID,
    // 사람 글은 누가 썼는지 — 공유 세션에서 남의 글을 왼쪽에 이름과 함께 그린다
    ...(m.authorId !== SYSTEM_USER_ID && m.author ? { author: { id: m.author.id, name: m.author.name } } : {}),
    sources: Array.isArray(m.omnisQuery?.sources) ? (m.omnisQuery.sources as unknown as AskSource[]) : [],
    ...(m.files?.length ? { files: m.files } : {}),
  }
}

function shapeCard(s: {
  id: string; runId: string; toolName: string; status: string; preview: unknown; planHash: string
  blockedReason: string | null; result: string | null; createdAt: Date; decidedAt: Date | null
}, requester?: { id: string; name: string }, viewerId?: string): AgentCard {
  return {
    id: s.id, runId: s.runId, toolName: s.toolName, status: s.status as StepStatus, preview: s.preview as WritePreview,
    planHash: s.planHash, blockedReason: s.blockedReason, result: s.result,
    createdAt: s.createdAt.toISOString(), decidedAt: s.decidedAt?.toISOString() ?? null,
    ...(requester ? { requester, canDecide: requester.id === viewerId } : {}),
  }
}

/** 방을 열 때 · 위로 올릴 때 한 번에 받는 글 수(2026-10-29 「매번 전부 불러오지 말고」) */
export const OMNIS_PAGE_SIZE = 30

const FILE_SELECT = { id: true, name: true, path: true, size: true, mimeType: true } as const
const MESSAGE_SELECT = {
  id: true, content: true, createdAt: true, authorId: true, author: { select: { id: true, name: true } }, omnisQuery: { select: { sources: true } },
  files: { select: FILE_SELECT, orderBy: { createdAt: "asc" } },
} as const

/**
 * 글 한 페이지(최근부터 거꾸로 PAGE+1 개를 읽어 더 있는지 안다) + 그 글들의 질문에 붙은 도구 기록.
 * 실행은 누가 열었든 다 읽는다 — 공유 세션에서 남의 질문에 붙은 도구 · 멈춤도 같은 자리에 보인다
 */
async function messagePage(roomId: string, before?: Date) {
  const rows = await prisma.chatMessage.findMany({
    where: { roomId, deletedAt: null, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: OMNIS_PAGE_SIZE + 1,
    select: MESSAGE_SELECT,
  })
  const hasMore = rows.length > OMNIS_PAGE_SIZE
  const page = rows.slice(0, OMNIS_PAGE_SIZE).reverse()
  // 같은 질문을 다시 물으면(retryOf) 실행이 둘 — 이어 붙인다. 이 페이지의 질문만 읽는다(실행 대화는 길다)
  const runs = await prisma.agentRun.findMany({
    where: { roomId, questionMessageId: { in: page.map((m) => m.id) } },
    orderBy: { createdAt: "asc" },
    select: { questionMessageId: true, messages: true, status: true, stoppedMessageId: true },
  })
  const tools: Record<string, ToolUse[]> = {}
  const stopped: Record<string, string | null> = {}
  for (const r of runs) {
    const t = toolTrail(r.messages as unknown as { role: string; content: unknown }[])
    if (t.length) tools[r.questionMessageId] = [...(tools[r.questionMessageId] ?? []), ...t]
    // 같은 질문의 마지막 실행만 본다(다시 물어 답을 받았으면 멈춤 표시는 없다)
    if (r.status === "STOPPED") stopped[r.questionMessageId] = r.stoppedMessageId
    else delete stopped[r.questionMessageId]
  }
  return { messages: page.map(shapeMessage), tools, hasMore, stopped }
}

/** 공유 세션의 원래 방 — 보는 사람 기준 이름. 개인 세션이면 null */
async function sessionOrigin(originRoomId: string | null, userId: string): Promise<SessionOrigin | null> {
  if (!originRoomId) return null
  const r = await prisma.chatRoom.findUnique({
    where: { id: originRoomId },
    select: { id: true, kind: true, name: true, dmKey: true, members: { select: { user: { select: { id: true, name: true } } } } },
  })
  return r ? { id: r.id, title: peopleRoomTitle(r, r.members.map((m) => m.user), userId) } : null
}

export async function loadAgentRoom(roomId: string, userId: string): Promise<AgentRoomState | null> {
  const room = await ownRoom(roomId, userId)
  if (!room) return null
  const [page, steps, active, origin, others] = await Promise.all([
    messagePage(roomId),
    // 카드는 누가 연 실행이든 다 보인다 — 누를 수 있는 사람은 그 실행의 요청자뿐(canDecide)
    prisma.agentStep.findMany({ where: { run: { roomId } }, orderBy: { createdAt: "asc" }, include: { run: { select: { userId: true } } } }),
    prisma.agentRun.findFirst({
      where: { roomId, userId, status: { in: ["RUNNING", "AWAITING_APPROVAL"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, updatedAt: true },
    }),
    sessionOrigin(room.originRoomId, userId),
    room.originRoomId
      ? prisma.agentRun.findFirst({
          where: { roomId, userId: { not: userId }, status: "RUNNING", updatedAt: { gt: new Date(Date.now() - RUNNING_STALE_MS) } },
          select: { userId: true },
        })
      : null,
    prisma.chatRoomMember.update({ where: { roomId_userId: { roomId, userId } }, data: { lastReadAt: new Date() } }),
  ])
  const live = active && (active.status !== "RUNNING" || Date.now() - active.updatedAt.getTime() < RUNNING_STALE_MS) ? active : null
  const requesterIds = [...new Set(steps.map((s) => s.run.userId))]
  const names = requesterIds.length
    ? new Map((await prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    : new Map<string, string>()
  return {
    room: { id: room.id, name: room.name, origin, owner: room.createdBy, isOwner: room.createdById === userId, memberCount: room._count.members },
    messages: page.messages,
    cards: steps.map(({ run, ...s }) => shapeCard(s, { id: run.userId, name: names.get(run.userId) ?? "" }, userId)),
    activeRun: live ? { id: live.id, status: live.status } : null,
    tools: page.tools,
    hasMore: page.hasMore,
    stopped: page.stopped,
    busyBy: others ? ((await prisma.user.findUnique({ where: { id: others.userId }, select: { name: true } }))?.name ?? "다른 분") : null,
  }
}

/** 위로 올릴 때 — before 보다 앞의 글 한 페이지 */
export async function loadAgentRoomOlder(roomId: string, userId: string, before: Date) {
  if (!(await ownRoom(roomId, userId))) return null
  return messagePage(roomId, before)
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

/** 트랜잭션 안에서 첨부를 잡지 못했다 — 그사이 다른 글에 붙었다. 질문 글까지 되돌린다 */
class AttachRace extends Error {}

/**
 * 붙일 파일을 고른다 — 새 글이면 고른 id 가 내 것 · 아직 안 붙은 것인지(lib/file-access.ts), 다시 묻기면 그 글에 이미 붙은 것.
 * 그리고 모델이 읽을 모양으로 연다(시놀로지를 읽으니 트랜잭션 밖에서)
 */
async function attachmentsFor(input: { roomId: string; userId: string; retryOf?: string; fileIds?: string[] }) {
  const select = { id: true, name: true, path: true, size: true, mimeType: true, privateToUserId: true, messageId: true, taskId: true } as const
  let rows: { id: string; name: string; path: string; size: number; mimeType: string }[]
  if (input.retryOf) {
    rows = await prisma.file.findMany({
      where: { messageId: input.retryOf, message: { roomId: input.roomId, authorId: input.userId } },
      select, orderBy: { createdAt: "asc" },
    })
  } else {
    const ids = input.fileIds ?? []
    if (ids.length === 0) return { ok: true as const, ids, read: [] }
    // 데모는 파일 저장을 쓰지 않는다(lib/demo.ts) — 올릴 수 없으니 붙일 것도 없다
    if (IS_DEMO) return { ok: false as const, status: 400, error: "시연용 데모에서는 파일을 붙일 수 없습니다" }
    const found = await prisma.file.findMany({ where: { id: { in: ids } }, select })
    const check = checkAttachable(ids, found, input.userId)
    if (!check.ok) return check
    rows = ids.map((id) => found.find((f) => f.id === id)!)
  }
  return { ok: true as const, ids: rows.map((r) => r.id), read: await Promise.all(rows.map(readAttachment)) }
}

/**
 * 옴니스 방에 묻는다 — 질문 글을 남기고 실행을 연다. content 는 새 글, retryOf 는 답을 못 받은 내 글.
 * fileIds 는 질문에 붙일 파일(POST /api/files scope=private 로 올린 것) — 질문 글에 붙이고, 모델은 이미지 · 본문을 읽는다.
 * 확인을 기다리던 앞 실행이 있으면 버린다(카드는 EXPIRED) — 새 글이 오면 앞의 제안은 낡은 것이다.
 */
export async function startAgentTurn(input: {
  roomId: string; userId: string; content?: string; retryOf?: string; fileIds?: string[]
  /** 사람 방의 @옴니스 로 연 첫 실행 — 끝나면 그 방에 안내 한 줄(lib/omnis-mention-notice.ts) */
  notifyOrigin?: boolean
}): Promise<Started | Fail> {
  const { roomId, userId } = input
  if (!(await ownRoom(roomId, userId))) return { ok: false, status: 404, error: "대화를 찾을 수 없습니다" }
  if (!input.retryOf && !input.content) return { ok: false, status: 400, error: "보낼 내용이 없습니다" }
  const attach = await attachmentsFor(input)
  if (!attach.ok) return { ok: false, status: attach.status, error: attach.error }

  // 받을지 정하고(돌고 있는 실행 · 하루 상한) 질문 글 · 실행을 만드는 것까지 한 트랜잭션 — 사람마다 잠근다.
  // 잠그지 않으면 같은 사람이 연달아 보낸 두 요청이 둘 다 「돌고 있는 실행 없음」 을 보고 동시에 실행을 연다
  const gate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-run:${userId}`}))`
    const refused = await admissionRefusal(tx, userId, roomId)
    if (refused) return refused
    // 공유 세션은 여러 사람이 묻는다 — 방마다도 잠그고, 남이 연 실행이 돌고 있으면 받지 않는다(한 방에 실행은 하나).
    // 잠금 순서는 늘 사람 → 방이라 서로 기다리며 멈추지 않는다
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-room:${roomId}`}))`
    const busy = await tx.agentRun.findFirst({
      where: { roomId, userId: { not: userId }, status: "RUNNING", updatedAt: { gt: new Date(Date.now() - RUNNING_STALE_MS) } },
      select: { id: true },
    })
    if (busy) return { ok: false as const, status: 409, error: "옴니스가 아직 다른 분의 글에 답하는 중입니다. 끝난 뒤 보내 주세요" }

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
      if (attach.ids.length) {
        // 위에서 본 뒤 그사이 다른 글에 붙었으면 잡지 못한다 — 질문 글까지 되돌린다
        const claimed = await tx.file.updateMany({
          where: { id: { in: attach.ids }, privateToUserId: userId, messageId: null, taskId: null },
          data: { messageId: question.id },
        })
        if (claimed.count !== attach.ids.length) throw new AttachRace()
      }
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
      select: { content: true, authorId: true, files: { select: { name: true } } },
    })
    // 앞 질문의 첨부는 이름만 문맥에 남긴다 — 이미지 · 본문을 질문마다 다시 보내면 입력 토큰이 쌓인다
    const history = buildOmnisHistory(
      before.reverse().map((m) => ({ fromOmnis: m.authorId === SYSTEM_USER_ID, content: historyWithAttachmentNames(m.content, m.files.map((f) => f.name)) })),
    )
    // 이번 질문 — 첨부가 있으면 본문(비밀은 가리고 길이는 잘라) · 이미지를 함께(lib/agent/attachments.ts)
    const asked = questionWithAttachments(question.content, attach.read)
    const messages: ModelMessage[] = [
      ...history.map((t) => ({ role: t.role === "model" ? ("assistant" as const) : ("user" as const), content: t.text })),
      asked.images.length ? { role: "user", content: [{ type: "text", text: asked.text }, ...asked.images] } : { role: "user", content: asked.text },
    ]
    const run = await tx.agentRun.create({
      data: {
        roomId, userId, questionMessageId: question.id, model: modelKey(modelFor("agent")),
        messages: messages as unknown as Prisma.InputJsonValue,
        notifyOrigin: input.notifyOrigin === true,
      },
    })
    return { ok: true as const, run, question }
  }).catch((err) => {
    if (err instanceof AttachRace) return { ok: false as const, status: 409, error: "이미 다른 글에 붙은 파일입니다 — 다시 올려 주세요" }
    throw err
  })
  if (!gate.ok) return gate
  const { run, question } = gate

  const wf = await start(omnisAgentWorkflow, [run.id])
  await prisma.agentRun.update({ where: { id: run.id }, data: { workflowRunId: wf.runId } })
  const r = streamResponse(wf.runId, wf.readable, { "x-agent-run-id": run.id, "x-question-id": question.id })
  return {
    ok: true, runId: run.id,
    question: shapeMessage({ ...question, omnisQuery: null, author: { id: userId, name: "" } }),
    stream: r.stream, headers: r.headers,
  }
}

/**
 * 새 실행을 받지 않을 이유. 없으면 null.
 * - 같은 사람이 돌고 있는 실행이 있으면 409 — 방이 달라도. 연달아 보낸 요청이 모델을 겹쳐 부르지 않게(앞 실행은 그대로 끝까지 간다)
 * - 사람별 하루 · 회사 월 비용 상한(lib/ai-budget)에 닿았으면 429 + budget(관리자면 올리기 단추)
 * - 데모 하루 상한(lib/agent/quota.ts)에 닿았으면 429. 환경변수가 없으면 DB 를 읽지 않는다
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
  // 사람별 하루 · 회사 월 상한(lib/ai-budget) — 갑자기 끊지 않는다: 이미 시작한 실행 · 확인 카드는 그대로, 새 실행만 받지 않는다
  const budget = await budgetGate(userId)
  if (budget) return { ok: false, status: budget.status, error: budget.error, budget: budget.budget }
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

/** 사람 방의 @옴니스 로 여는 세션 — 그 방 참여자 모두가 참여자다(lib/omnis-mention.ts) */
export interface SessionFrom {
  roomId: string
  memberIds: string[]
  name: string
  /** 방을 만든 뒤 · 실행을 열기 전에 — 사람 방에 시작 안내를 남긴다 */
  beforeStart?: (sessionId: string) => Promise<void>
}

/** 새 대화 — 첫 글과 함께 방을 만들고 바로 연다. 빈 방은 만들지 않는다. origin 이 있으면 그 방에서 연 공유 세션이다 */
export async function startAgentRoom(userId: string, content: string, fileIds: string[] = [], opts: { origin?: SessionFrom } = {}): Promise<(Started & { roomId: string }) | Fail> {
  const origin = opts.origin
  // 받지 않을 요청이면 방부터 만들지 않는다(잠금 없이 먼저 본다 — 경합은 startAgentTurn 이 다시 막는다)
  const early = await admissionRefusal(prisma, userId, null)
  if (early) return early
  if (fileIds.length) {
    // 붙일 수 없는 파일이면 방부터 만들지 않는다(같은 판정을 startAgentTurn 이 트랜잭션 안에서 다시 한다)
    if (IS_DEMO) return { ok: false, status: 400, error: "시연용 데모에서는 파일을 붙일 수 없습니다" }
    const found = await prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, privateToUserId: true, messageId: true, taskId: true } })
    const check = checkAttachable(fileIds, found, userId)
    if (!check.ok) return check
  }
  const now = new Date()
  const memberIds = origin ? [...new Set([userId, ...origin.memberIds])] : [userId]
  const room = await prisma.chatRoom.create({
    data: {
      name: origin?.name ?? roomNameFrom(content), kind: "OMNIS_DM", createdById: userId, originRoomId: origin?.roomId ?? null,
      // 요청자만 읽은 것으로 — 다른 참여자에게는 새 세션이 안 읽은 대화로 보인다
      // 방에서 연 세션의 다른 참여자는 방 공유(ROOM)로 들어온다 — 방을 나가면 함께 빠진다(lib/omnis-mention-notice.ts)
      members: { create: memberIds.map((id) => ({ userId: id, lastReadAt: id === userId ? now : null, shareKind: id === userId ? null : ("ROOM" as const) })) },
    },
    select: { id: true },
  })
  if (origin?.beforeStart) await origin.beforeStart(room.id)
  const r = await startAgentTurn({ roomId: room.id, userId, content, fileIds, notifyOrigin: !!origin })
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

/** 멈춘 실행의 Workflow 가 끝나기를 기다리는 상한 — 모델 단계는 신호를 받는 즉시 끊지만, 도는 도구는 끝까지 간다 */
const STOP_WAIT_MS = 10_000

/**
 * 「답변 중지」 — 규칙은 lib/agent/stop.ts. 멈춤 신호는 그 Workflow 실행의 멈춤 스트림에 한 줄 쓰는 것이다
 * (모델 단계가 듣고 벤더 연결을 끊는다, lib/agent/model.ts). 끝나기를 기다린 뒤 돌려준다 — 화면이 곧바로 방을 다시 읽으면
 * 그때까지의 답(「중지됨」)이 이미 방에 있다. 기다림이 상한을 넘어도 STOPPED 는 이미 DB 에 있어 도구 · 다음 구간이 멈춘다.
 * run.cancel() 은 쓰지 않는다 — 구간 끝(saveAgentPass)을 건너뛰어 사용량 · 그때까지의 답이 남지 않는다(stop-stream.ts 머리말)
 */
export async function stopAgentRun(runId: string, userId: string) {
  return stopRun(runId, userId, {
    findRun: (id, uid) => prisma.agentRun.findFirst({ where: { id, userId: uid }, select: { status: true, workflowRunId: true } }),
    stopIfRunning: async (id, uid) =>
      (await prisma.agentRun.updateMany({ where: { id, userId: uid, status: "RUNNING" }, data: { status: "STOPPED" } })).count,
    signal: async (workflowRunId) => {
      const wf = getRun(workflowRunId)
      try {
        const writer = wf.getWritable<{ stoppedAt: string }>({ namespace: AGENT_STOP_NAMESPACE }).getWriter()
        await writer.write({ stoppedAt: new Date().toISOString() })
        writer.releaseLock()
      } catch {
        // 이미 끝난 Workflow — 쓸 곳이 없다. 다음 구간은 DB 의 STOPPED 를 보고 열리지 않는다
      }
      await Promise.race([wf.returnValue.catch(() => null), new Promise((r) => setTimeout(r, STOP_WAIT_MS))])
    },
  })
}
