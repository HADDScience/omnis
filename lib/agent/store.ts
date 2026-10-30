// 에이전트 실행의 DB 쪽 — Workflow 단계(lib/agent/steps.ts)와 API(lib/agent/service.ts)가 부른다.
//
// 실행 상태(대화 · 쓰기 제안 · 사용량)는 전부 DB 에 남긴다. Workflow 는 한 번 돌고 끝나는 「한 구간」 이고,
// 확인을 기다리는 동안에는 아무것도 돌지 않는다 — 사람이 [확인] 을 누르면 DB 의 대화에 승인 응답을 붙여 새 구간을 연다.
import type { ModelMessage } from "ai"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { writeActivity } from "@/lib/api"
import { getSystemUserId } from "@/lib/system-user"
import { agentLimits, modelFor, modelKey, type ModelChoice } from "@/lib/ai-models"
import { costOf } from "@/lib/ai-pricing"
import type { AskSource } from "@/lib/omnis-ask"
import { agentInstructions } from "./prompt"
import { agentToolSpecs, buildPreview, callerFor, executeWrite, isWriteTool, runReadTool, type AgentToolSpec, type AgentWriteTool, type WritePreview } from "./tools"
import { executeOutput, isOutputTool } from "./outputs"
import { checkExecution, planHash, type StepStatus } from "./approval"
import { redactSecrets, secretBlockReason } from "./secrets"
import { limitMessage, limitReason, type Spent, type StepUsage } from "./limits"
import { approvalResponses, pendingApprovals } from "./messages"
import { RUN_STOPPED_RESULT } from "./stop-stream"
import { dispatchAgentPushSafe } from "@/lib/chat-push"

export interface AgentContext {
  ok: true
  messages: ModelMessage[]
  instructions: string
  model: ModelChoice
  modelKey: string
  providerOptions: Record<string, Record<string, string | boolean | string[]>>
  tools: AgentToolSpec[]
  limits: { maxTurns: number; maxKrw: number }
  spent: Spent
}

export function providerOptionsFor(m: ModelChoice): AgentContext["providerOptions"] {
  if (m.vendor === "openai") {
    // store=false — 대화를 OpenAI 쪽에 남기지 않는다. 그 대신 추론 항목을 다음 요청에 되돌리려면 암호화된 추론 내용을 받아 둔다
    return { openai: { store: false, include: ["reasoning.encrypted_content"], ...(m.reasoning ? { reasoningEffort: m.reasoning } : {}) } }
  }
  if (m.vendor === "anthropic" && m.reasoning) return { anthropic: { effort: m.reasoning } }
  return {}
}

const kstToday = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

export async function loadContext(runId: string): Promise<AgentContext | { ok: false; reason: string }> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } })
  if (!run) return { ok: false, reason: "실행이 없습니다" }
  if (run.status !== "RUNNING") return { ok: false, reason: `실행 상태가 ${run.status} 입니다` }
  const user = await prisma.user.findUnique({ where: { id: run.userId }, select: { name: true } })
  const [vendor, ...rest] = run.model.split(":")
  const base = modelFor("agent")
  const model: ModelChoice = { vendor: vendor as ModelChoice["vendor"], model: rest.join(":"), reasoning: base.reasoning }
  const limits = agentLimits()
  return {
    ok: true,
    messages: run.messages as unknown as ModelMessage[],
    instructions: agentInstructions({ today: kstToday(), userName: user?.name ?? "직원", maxTurns: limits.maxTurns }),
    model,
    modelKey: modelKey(model),
    providerOptions: providerOptionsFor(model),
    tools: await agentToolSpecs(),
    limits,
    spent: { turns: run.turns, krw: Number(run.costKrw) },
  }
}

// ─── 도구 실행 ───────────────────────────────────────────────────────

export async function readTool(runId: string, name: string, input: Record<string, unknown>): Promise<string> {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { userId: true, sources: true, status: true } })
  // 사용자가 멈췄다 — 도구를 돌리지 않고, Workflow 의 stopWhen 이 이 값을 보고 모델을 더 부르지 않는다
  if (run.status === "STOPPED") return RUN_STOPPED_RESULT
  const caller = await callerFor(run.userId)
  const before = (run.sources as unknown as AskSource[]) ?? []
  const r = await runReadTool(name, input, caller, before)
  if (r.sources.length !== before.length) {
    await prisma.agentRun.update({ where: { id: runId }, data: { sources: r.sources as unknown as Prisma.InputJsonValue } })
  }
  return r.text
}

/**
 * 확인된 쓰기 하나. 카드가 APPROVED 이고 도구 · 입력이 같아야 돈다(checkExecution).
 * APPROVED → EXECUTED 를 조건부로 한 번에 바꿔 같은 승인이 두 번 쓰이지 않게 한다.
 */
export async function writeTool(runId: string, name: string, input: Record<string, unknown>, toolCallId: string): Promise<string> {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { userId: true, roomId: true, status: true } })
  if (run.status === "STOPPED") return RUN_STOPPED_RESULT
  const step = await prisma.agentStep.findUnique({ where: { runId_toolCallId: { runId, toolCallId } } })
  const check = checkExecution(step ? { ...step, status: step.status as StepStatus } : null, { toolName: name, input })
  if (!check.ok) return `실행하지 않았습니다: ${check.error}`
  if (!isWriteTool(name) && !isOutputTool(name)) return `실행하지 않았습니다: 열려 있지 않은 쓰기 도구입니다 (${name})`

  const claimed = await prisma.agentStep.updateMany({
    where: { id: step!.id, status: "APPROVED" },
    data: { status: "EXECUTED", executedAt: new Date() },
  })
  if (claimed.count !== 1) return "실행하지 않았습니다: 이미 실행한 제안입니다 — 같은 승인은 한 번만 씁니다"

  try {
    // 결과물(문서 초안 · 파일 · 기록 제안)은 이 방에 붙는다 — 방 · 사람을 넘긴다
    const r = isOutputTool(name)
      ? await executeOutput(name, input, { runId, roomId: run.roomId, userId: run.userId })
      : await executeWrite(name as AgentWriteTool, input, await callerFor(run.userId))
    await prisma.agentStep.update({ where: { id: step!.id }, data: { status: r.ok ? "EXECUTED" : "FAILED", result: r.text.slice(0, 4000) } })
    // 결과물은 결과 글이 초안 본문 그대로라 모델이 「확인을 기다린다」 고 다시 쓰는 일이 있었다(2026-10-30 주간보고 실측) — 실행됐다는 것을 앞에 박는다
    const done = isOutputTool(name) || name === "write_weekly_report" ? `사용자가 확인해 실행을 마쳤습니다. 다시 확인을 요청하지 마세요.\n${r.text}` : r.text
    return r.ok ? done : `실행이 실패했습니다: ${r.text}`
  } catch (err) {
    // 던지지 않는다 — 던지면 Workflow 가 단계를 다시 돌리고, 두 번째는 위의 조건부 갱신에서 막혀 사람이 보기에 이유가 흐려진다
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.agentStep.update({ where: { id: step!.id }, data: { status: "FAILED", result: msg.slice(0, 4000) } })
    return `실행이 실패했습니다: ${msg}`
  }
}

// ─── 구간 끝 ─────────────────────────────────────────────────────────

export interface PassStep extends StepUsage {
  finishReason: string
  text: string
}

export interface PassResult {
  messages: ModelMessage[]
  steps: PassStep[]
  error?: string
}

async function postOmnisMessage(roomId: string, content: string, omnisQueryId?: string) {
  const systemId = await getSystemUserId()
  const now = new Date()
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({ data: { roomId, authorId: systemId, content, createdAt: now, ...(omnisQueryId ? { omnisQueryId } : {}) }, select: { id: true } }),
    prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: now } }),
  ])
  return message.id
}

/**
 * 사용자가 멈춘 실행의 구간 끝. 사용량은 이미 남겼다(savePass 앞부분). 확인 카드는 만들지 않고, 기다리던 카드도 버린다.
 * 그때까지 흘러나온 답이 있으면 옴니스 글로 남기고 그 글을 실행에 적는다 — 화면이 「중지됨」 을 붙인다.
 * 상태는 STOPPED 그대로 둔다. 기기 알림은 보내지 않는다 — 멈춘 사람이 화면을 보고 있다
 */
async function saveStopped(
  run: { id: string; roomId: string; userId: string; questionMessageId: string; sources: unknown },
  base: { messages: Prisma.InputJsonValue; turns: number; costKrw: number },
  lastText: string,
): Promise<{ autoContinue: false; status: "STOPPED" }> {
  await prisma.agentStep.updateMany({ where: { runId: run.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "EXPIRED" } })
  let stoppedMessageId: string | null = null
  if (lastText) {
    const question = await prisma.chatMessage.findUnique({ where: { id: run.questionMessageId }, select: { content: true } })
    const sources = (run.sources as AskSource[]) ?? []
    const saved = await prisma.omnisQuery.create({
      data: { userId: run.userId, question: question?.content ?? "", answer: lastText, sources: sources as unknown as Prisma.InputJsonValue },
    })
    stoppedMessageId = await postOmnisMessage(run.roomId, lastText, saved.id)
  }
  await prisma.agentRun.update({ where: { id: run.id }, data: { ...base, stoppedMessageId } })
  return { autoContinue: false, status: "STOPPED" }
}

/** 상태를 RUNNING 에서만 바꾼다. 그사이 사용자가 멈췄으면(STOPPED) false */
async function moveFromRunning(runId: string, data: Prisma.AgentRunUpdateManyMutationInput): Promise<boolean> {
  const moved = await prisma.agentRun.updateMany({ where: { id: runId, status: "RUNNING" }, data })
  return moved.count === 1
}

/**
 * 한 구간이 끝났다 — 사용량을 남기고, 승인 요청이 있으면 카드를 만들고, 아니면 답을 방에 남긴다.
 * 돌려주는 autoContinue=true 면 이번 제안이 전부 막혀(비밀 · 대상 없음) 사람이 누를 것이 없다 —
 * Workflow 가 거절 응답을 붙인 대화로 곧바로 한 구간 더 돈다(모델이 이유를 사람에게 설명한다).
 */
export async function savePass(runId: string, pass: PassResult): Promise<{ autoContinue: boolean; status: string }> {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })
  const [vendor, ...rest] = run.model.split(":")
  const mKey = run.model
  const now = new Date()

  // 멈춘 실행에서 벤더를 부르지 않고 끝낸 호출(토큰 0)은 남기지 않는다
  const used = pass.steps.filter((s) => s.inputTokens + s.outputTokens > 0)
  if (used.length > 0) {
    await prisma.aiUsage.createMany({
      data: used.map((s) => {
        const c = costOf(mKey, s)
        return {
          vendor, model: rest.join(":"), feature: "agent",
          inputTokens: s.inputTokens, cachedInputTokens: s.cachedInputTokens, outputTokens: s.outputTokens, reasoningTokens: s.reasoningTokens,
          costUsd: c.usd, costKrw: c.krw, userId: run.userId, roomId: run.roomId, runId, createdAt: now,
        }
      }),
    })
  }
  const spent: Spent = {
    turns: run.turns + pass.steps.length,
    krw: Number(run.costKrw) + pass.steps.reduce((a, s) => a + costOf(mKey, s).krw, 0),
  }
  // instructions 는 매 구간 새로 넣는다 — 대화에 남은 system 은 빼고 저장한다
  const messages = pass.messages.filter((m) => m.role !== "system")
  const lastText = pass.steps.at(-1)?.text.trim() ?? ""

  const base = { messages: messages as unknown as Prisma.InputJsonValue, turns: spent.turns, costKrw: spent.krw }

  // 사용자가 멈췄다(중지 API 가 RUNNING → STOPPED). 오류로 끝났어도 같다 — 멈춘 것이 먼저다
  if (run.status === "STOPPED") return saveStopped(run, base, lastText)

  if (pass.error) {
    await prisma.agentRun.update({ where: { id: runId }, data: { ...base, status: "FAILED", error: pass.error.slice(0, 2000) } })
    return { autoContinue: false, status: "FAILED" }
  }

  const approvals = pendingApprovals(messages)
  const known = new Set((await prisma.agentStep.findMany({ where: { runId }, select: { toolCallId: true } })).map((s) => s.toolCallId))
  const fresh = approvals.filter((a) => !known.has(a.toolCallId))

  if (fresh.length > 0) {
    const drafts = []
    for (const a of fresh) {
      const preview = await buildPreview(a.toolName, a.input, { userId: run.userId, roomId: run.roomId }).catch((e): WritePreview => ({
        title: a.toolName, target: "", changes: [], risk: "", problem: `카드를 만들지 못했습니다: ${e instanceof Error ? e.message : e}`,
      }))
      const secret = secretBlockReason(a.input)
      const blockedReason = secret ?? (preview.problem ? `${preview.problem} — 실행해도 실패합니다` : null)
      // 막힌 카드에는 값을 가려 남긴다 — 비밀을 카드 표에 옮겨 적지 않는다
      if (secret) {
        preview.target = redactSecrets(preview.target)
        preview.changes = preview.changes.map((c) => ({ ...c, before: c.before === null ? null : redactSecrets(c.before), after: redactSecrets(c.after) }))
      }
      drafts.push({
        runId, toolCallId: a.toolCallId, approvalId: a.approvalId, toolName: a.toolName,
        input: a.input as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue,
        planHash: planHash({ runId, toolCallId: a.toolCallId, toolName: a.toolName, input: a.input, preview }),
        status: blockedReason ? ("BLOCKED" as const) : ("PENDING" as const), blockedReason,
      })
    }
    // 상태를 먼저 잡고 카드를 만든다 — 그사이 사용자가 멈췄으면(STOPPED) 카드를 만들지 않는다
    const allBlocked = drafts.every((d) => d.status === "BLOCKED")
    const nextMessages = [...messages, approvalResponses(drafts)]
    // 막힌 것만 있으면 바로 이어 간다 — 다만 상한에 닿았으면 멈춘다
    const reason = allBlocked ? limitReason(spent, agentLimits()) : null
    const target = !allBlocked ? "AWAITING_APPROVAL" : reason ? "LIMIT" : "RUNNING"
    const claimed = await moveFromRunning(
      runId,
      allBlocked ? { ...base, messages: nextMessages as unknown as Prisma.InputJsonValue, status: target } : { ...base, status: target },
    )
    if (!claimed) return saveStopped(run, base, lastText)
    for (const d of drafts) await prisma.agentStep.create({ data: d })
    if (lastText) await postOmnisMessage(run.roomId, lastText)
    if (target === "LIMIT") {
      await postOmnisMessage(run.roomId, limitMessage(reason!, spent))
      await dispatchAgentPushSafe({ roomId: run.roomId, userId: run.userId, kind: "limit", text: limitMessage(reason!, spent) })
      return { autoContinue: false, status: "LIMIT" }
    }
    if (target === "RUNNING") return { autoContinue: true, status: "RUNNING" }
    // 확인 카드가 떴다 — 사람이 눌러야 이어 간다. 그 방을 보고 있지 않으면 기기로 알린다(보고 있으면 service worker 가 거른다)
    await dispatchAgentPushSafe({ roomId: run.roomId, userId: run.userId, kind: "approval" })
    return { autoContinue: false, status: "AWAITING_APPROVAL" }
  }

  // 모델이 도구를 더 부르려던 참에 stopWhen(상한)에 걸려 멈췄다
  const last = pass.steps.at(-1)
  const reason = limitReason(spent, agentLimits())
  if (last?.finishReason === "tool-calls" && reason) {
    await prisma.agentRun.update({ where: { id: runId }, data: { ...base, status: "LIMIT" } })
    await postOmnisMessage(run.roomId, [lastText, limitMessage(reason, spent)].filter(Boolean).join("\n\n"))
    await dispatchAgentPushSafe({ roomId: run.roomId, userId: run.userId, kind: "limit", text: lastText || limitMessage(reason, spent) })
    return { autoContinue: false, status: "LIMIT" }
  }

  const question = await prisma.chatMessage.findUnique({ where: { id: run.questionMessageId }, select: { content: true } })
  const answer = lastText || "관련 내용을 찾지 못했습니다."
  const sources = (run.sources as unknown as AskSource[]) ?? []
  const saved = await prisma.omnisQuery.create({
    data: { userId: run.userId, question: question?.content ?? "", answer, sources: sources as unknown as Prisma.InputJsonValue },
  })
  await writeActivity({ userId: run.userId, action: "omnis.asked", entity: "OMNIS_QUERY", entityId: saved.id, title: `질문: ${question?.content ?? ""}` })
  await postOmnisMessage(run.roomId, answer, saved.id)
  await prisma.agentRun.update({ where: { id: runId }, data: { ...base, status: "DONE" } })
  await dispatchAgentPushSafe({ roomId: run.roomId, userId: run.userId, kind: "answer", text: answer })
  return { autoContinue: false, status: "DONE" }
}

