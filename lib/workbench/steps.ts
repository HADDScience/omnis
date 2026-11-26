// Workflow 단계 — 본문은 runner.ts. "use step" 함수의 인자와 반환값은 Workflow 이벤트 기록에 남는다 — 작업 ID 만 넘긴다(토큰 · 키를 넘기지 않는다).
import type { PumpState } from "./runner"
import type { IdleOutcome } from "./progress"

export async function openStep(jobId: string): Promise<{ ok: boolean }> {
  "use step"
  const { openJob } = await import("./runner")
  const { runnerDeps } = await import("./service")
  return openJob(jobId, runnerDeps())
}

export async function pumpStep(jobId: string): Promise<PumpState> {
  "use step"
  const { pumpJob } = await import("./runner")
  const { runnerDeps } = await import("./service")
  return pumpJob(jobId, runnerDeps())
}

export async function finishStep(jobId: string, how: IdleOutcome | "timeout"): Promise<string> {
  "use step"
  const { finishJob } = await import("./runner")
  const { runnerDeps } = await import("./service")
  return finishJob(jobId, how, runnerDeps())
}
