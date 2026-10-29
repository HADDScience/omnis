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
import { agentToolSpecs, buildPreview, callerFor, executeWrite, isWriteTool, runReadTool, type AgentToolSpec } from "./tools"
import { checkExecution, planHash, type StepStatus } from "./approval"
import { redactSecrets, secretBlockReason } from "./secrets"
import { limitMessage, limitReason, type Spent, type StepUsage } from "./limits"
import { approvalResponses, pendingApprovals } from "./messages"

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
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { userId: true, sources: true } })
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
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { userId: true } })
  const step = await prisma.agentStep.findUnique({ where: { runId_toolCallId: { runId, toolCallId } } })
  const check = checkExecution(step ? { ...step, status: step.status as StepStatus } : null, { toolName: name, input })
  if (!check.ok) return `실행하지 않았습니다: ${check.error}`
  if (!isWriteTool(name)) return `실행하지 않았습니다: 열려 있지 않은 쓰기 도구입니다 (${name})`

  const claimed = await prisma.agentStep.updateMany({
    where: { id: step!.id, status: "APPROVED" },
    data: { status: "EXECUTED", executedAt: new Date() },
  })
  if (claimed.count !== 1) return "실행하지 않았습니다: 이미 실행한 제안입니다 — 같은 승인은 한 번만 씁니다"

  try {
    const r = await executeWrite(name, input, await callerFor(run.userId))
    await prisma.agentStep.update({ where: { id: step!.id }, data: { status: r.ok ? "EXECUTED" : "FAILED", result: r.text.slice(0, 4000) } })
    return r.ok ? r.text : `실행이 실패했습니다: ${r.text}`
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
  await prisma.$transaction([
    prisma.chatMessage.create({ data: { roomId, authorId: systemId, content, createdAt: now, ...(omnisQueryId ? { omnisQueryId } : {}) } }),
    prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: now } }),
  ])
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

  if (pass.steps.length > 0) {
    await prisma.aiUsage.createMany({
      data: pass.steps.map((s) => {
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

  if (pass.error) {
    await prisma.agentRun.update({ where: { id: runId }, data: { ...base, status: "FAILED", error: pass.error.slice(0, 2000) } })
    return { autoContinue: false, status: "FAILED" }
  }

  const approvals = pendingApprovals(messages)
  const known = new Set((await prisma.agentStep.findMany({ where: { runId }, select: { toolCallId: true } })).map((s) => s.toolCallId))
  const fresh = approvals.filter((a) => !known.has(a.toolCallId))

  if (fresh.length > 0) {
    const created = []
    for (const a of fresh) {
      const preview = await buildPreview(a.toolName, a.input).catch((e) => ({
        title: a.toolName, target: "", changes: [], risk: "", problem: `카드를 만들지 못했습니다: ${e instanceof Error ? e.message : e}`,
      }))
      const secret = secretBlockReason(a.input)
      const blockedReason = secret ?? (preview.problem ? `${preview.problem} — 실행해도 실패합니다` : null)
      // 막힌 카드에는 값을 가려 남긴다 — 비밀을 카드 표에 옮겨 적지 않는다
      if (secret) {
        preview.target = redactSecrets(preview.target)
        preview.changes = preview.changes.map((c) => ({ ...c, before: c.before === null ? null : redactSecrets(c.before), after: redactSecrets(c.after) }))
      }
      created.push(
        await prisma.agentStep.create({
          data: {
            runId, toolCallId: a.toolCallId, approvalId: a.approvalId, toolName: a.toolName,
            input: a.input as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue,
            planHash: planHash({ runId, toolCallId: a.toolCallId, toolName: a.toolName, input: a.input, preview }),
            status: blockedReason ? "BLOCKED" : "PENDING", blockedReason,
          },
        })
      )
    }
    if (lastText) await postOmnisMessage(run.roomId, lastText)
    if (created.every((s) => s.status === "BLOCKED")) {
      const nextMessages = [...messages, approvalResponses(created)]
      // 막힌 것만 있으면 바로 이어 간다 — 다만 상한에 닿았으면 멈춘다
      const reason = limitReason(spent, agentLimits())
      if (reason) {
        await prisma.agentRun.update({ where: { id: runId }, data: { ...base, messages: nextMessages as unknown as Prisma.InputJsonValue, status: "LIMIT" } })
        await postOmnisMessage(run.roomId, limitMessage(reason, spent))
        return { autoContinue: false, status: "LIMIT" }
      }
      await prisma.agentRun.update({ where: { id: runId }, data: { ...base, messages: nextMessages as unknown as Prisma.InputJsonValue, status: "RUNNING" } })
      return { autoContinue: true, status: "RUNNING" }
    }
    await prisma.agentRun.update({ where: { id: runId }, data: { ...base, status: "AWAITING_APPROVAL" } })
    return { autoContinue: false, status: "AWAITING_APPROVAL" }
  }

  // 모델이 도구를 더 부르려던 참에 stopWhen(상한)에 걸려 멈췄다
  const last = pass.steps.at(-1)
  const reason = limitReason(spent, agentLimits())
  if (last?.finishReason === "tool-calls" && reason) {
    await prisma.agentRun.update({ where: { id: runId }, data: { ...base, status: "LIMIT" } })
    await postOmnisMessage(run.roomId, [lastText, limitMessage(reason, spent)].filter(Boolean).join("\n\n"))
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
  return { autoContinue: false, status: "DONE" }
}

