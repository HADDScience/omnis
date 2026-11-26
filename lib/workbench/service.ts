// 작업용 컴퓨터 — 시작 · 계속 · 멈춤(옴니스 에이전트의 확인 카드가 부른다)과 한도 판정.
// 서버 전용.
import { prisma } from "@/lib/db"
import { kstMonthStart } from "@/lib/ai-budget-rules"
import { workbenchConfig, workbenchEnabledFor, type WorkbenchConfig } from "./config"
import { anthropicWorkbenchApi, workbenchClient } from "./api"
import { prismaJobStore } from "./store"
import { continueJob, finishJob, type RunnerDeps } from "./runner"

/** 한 사람 · 회사가 이번 달 쓴 것 + 지금 도는 작업이 잡아 둔 예산 */
export interface MonthSpend {
  userKrw: number
  companyKrw: number
}

/** 한도 판정 — 데이터만(시험이 그대로 부른다). 쓸 수 있는 예산(원)을 돌려준다. 모자라면 이유 */
export function grantBudget(c: Pick<WorkbenchConfig, "taskLimitKrw" | "userMonthlyKrw" | "companyMonthlyKrw">, spend: MonthSpend):
  { ok: true; budgetKrw: number } | { ok: false; reason: string } {
  const userLeft = c.userMonthlyKrw - spend.userKrw
  const companyLeft = c.companyMonthlyKrw - spend.companyKrw
  const budget = Math.floor(Math.min(c.taskLimitKrw, userLeft, companyLeft))
  // 한 건을 해 볼 만큼(가벼운 일 약 380원)도 안 남았으면 시작하지 않는다
  if (budget < 400) {
    const who = userLeft <= companyLeft ? `이번 달 개인 한도(${c.userMonthlyKrw.toLocaleString("ko-KR")}원)` : `이번 달 회사 한도(${c.companyMonthlyKrw.toLocaleString("ko-KR")}원)`
    return { ok: false, reason: `${who}가 거의 다 찼습니다(남은 ${Math.max(0, Math.min(userLeft, companyLeft)).toLocaleString("ko-KR")}원).` }
  }
  return { ok: true, budgetKrw: budget }
}

const LIVE = ["QUEUED", "RUNNING", "NEEDS_BUDGET"]

export async function monthSpend(userId: string, now = new Date()): Promise<MonthSpend> {
  const since = kstMonthStart(now)
  const rows = await prisma.workbenchJob.findMany({
    where: { createdAt: { gte: since } },
    select: { userId: true, status: true, costKrw: true, budgetKrw: true },
  })
  // 끝난 작업은 실제 비용, 도는 작업은 잡아 둔 예산(넘을 수 없다 — 세션 예산이 막는다)
  const amount = (r: (typeof rows)[number]) => (LIVE.includes(r.status) ? Math.max(Number(r.costKrw), r.budgetKrw) : Number(r.costKrw))
  return {
    userKrw: rows.filter((r) => r.userId === userId).reduce((s, r) => s + amount(r), 0),
    companyKrw: rows.reduce((s, r) => s + amount(r), 0),
  }
}

export function runnerDeps(c: WorkbenchConfig = workbenchConfig()): RunnerDeps {
  if (!c.apiKey || !c.agentId || !c.environmentId) throw new Error("작업용 컴퓨터 설정이 없습니다(WORKBENCH_ANTHROPIC_API_KEY · WORKBENCH_AGENT_ID · WORKBENCH_ENVIRONMENT_ID)")
  return {
    api: anthropicWorkbenchApi(workbenchClient(c.apiKey)),
    store: prismaJobStore({ tokenTtlMinutes: c.maxMinutes + 15 }),
    agentId: c.agentId,
    environmentId: c.environmentId,
    mcpUrl: c.mcpUrl,
    krwPerUsd: c.krwPerUsd,
    maxMinutes: c.maxMinutes,
  }
}

async function launch(jobId: string, resume: boolean) {
  const { start } = await import("workflow/api")
  const { workbenchJobWorkflow } = await import("./workflow")
  const run = await start(workbenchJobWorkflow, [jobId, resume])
  await prisma.workbenchJob.update({ where: { id: jobId }, data: { workflowRunId: run.runId } })
}

export async function startWorkbench(
  input: { request: string },
  ctx: { userId: string; roomId: string; runId: string }
): Promise<{ ok: boolean; text: string }> {
  const c = workbenchConfig()
  if (!workbenchEnabledFor(ctx.userId, c)) return { ok: false, text: "작업용 컴퓨터가 이 계정에 켜져 있지 않습니다" }
  const busy = await prisma.workbenchJob.count({ where: { userId: ctx.userId, status: { in: LIVE } } })
  if (busy > 0) return { ok: false, text: "이미 도는 작업이 있습니다. 끝나거나 멈춘 뒤에 새로 맡겨 주세요." }
  const g = grantBudget(c, await monthSpend(ctx.userId))
  if (!g.ok) return { ok: false, text: g.reason }
  const job = await prisma.workbenchJob.create({
    data: { userId: ctx.userId, roomId: ctx.roomId, runId: ctx.runId, request: input.request, model: c.model, budgetKrw: g.budgetKrw },
  })
  await launch(job.id, false)
  return { ok: true, text: `작업용 컴퓨터에 맡겼습니다(작업 ${job.id.slice(0, 8)}, 상한 ${g.budgetKrw.toLocaleString("ko-KR")}원). 진행은 이 방에 한 줄씩 올라옵니다.` }
}

/** 지금 이 사람의 멈춘(상한) · 도는 작업 */
export async function liveJobOf(userId: string) {
  return prisma.workbenchJob.findFirst({ where: { userId, status: { in: LIVE } }, orderBy: { createdAt: "desc" } })
}

export async function continueWorkbench(ctx: { userId: string }): Promise<{ ok: boolean; text: string }> {
  const c = workbenchConfig()
  const job = await liveJobOf(ctx.userId)
  if (!job || job.status !== "NEEDS_BUDGET") return { ok: false, text: "상한에 닿아 멈춘 작업이 없습니다" }
  const spend = await monthSpend(ctx.userId)
  // 이 작업이 잡아 둔 몫은 빼고 본다 — 새로 더할 몫만 한도와 비교한다
  const g = grantBudget(c, { userKrw: spend.userKrw - job.budgetKrw + Number(job.costKrw), companyKrw: spend.companyKrw - job.budgetKrw + Number(job.costKrw) })
  if (!g.ok) return { ok: false, text: g.reason }
  const r = await continueJob(job.id, g.budgetKrw, runnerDeps(c))
  if (r.ok) await launch(job.id, true)
  return r
}

export async function stopWorkbench(ctx: { userId: string }): Promise<{ ok: boolean; text: string }> {
  const job = await liveJobOf(ctx.userId)
  if (!job) return { ok: false, text: "도는 작업이 없습니다" }
  if (!job.sessionId) {
    await prisma.workbenchJob.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date() } })
    return { ok: true, text: "시작 전 작업을 취소했습니다" }
  }
  // 도는 Workflow 는 다음 단계에서 상태가 RUNNING 이 아님을 보고 끝난다(pumpJob). 끝내기를 두 번 해도 두 번째는 sessionId 가 없어 그냥 돌아간다
  const status = await finishJob(job.id, "cancelled", runnerDeps())
  return { ok: true, text: `작업을 멈췄습니다(${status}). 그때까지 만든 파일은 이 방에 붙였습니다.` }
}
