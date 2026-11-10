// 「답변 중지」 — 중지 API(POST /api/agent/runs/[runId]/stop)의 규칙. DB · Workflow 는 받아서 쓴다 — 시험: lib/agent/stop.test.ts
//
//   1. 내 실행만 — 남의 실행은 없는 실행과 같다(404)
//   2. RUNNING 일 때만 STOPPED 로 — 조건부 갱신. 이미 끝났거나(DONE · LIMIT · FAILED) 확인을 기다리면 409, 화면은 다시 읽기만 한다
//   3. 바꾼 뒤 그 Workflow 에 멈춤 신호를 보내고 끝나기를 잠깐 기다린다 — 화면이 다시 읽을 때 그때까지의 답이 방에 있게

export type StopFail = { ok: false; status: number; error: string }

export interface StopDeps {
  findRun(runId: string, userId: string): Promise<{ status: string; workflowRunId: string | null } | null>
  /** status=RUNNING 인 행만 STOPPED 로 바꾸고 바뀐 행 수를 돌려준다 */
  stopIfRunning(runId: string, userId: string): Promise<number>
  /** 멈춤 신호를 보내고 Workflow 가 끝나기를 기다린다(상한 있음). 실패해도 던지지 않는다 */
  signal(workflowRunId: string): Promise<void>
}

export async function stopRun(runId: string, userId: string, deps: StopDeps): Promise<{ ok: true; status: "STOPPED" } | StopFail> {
  const run = await deps.findRun(runId, userId)
  if (!run) return { ok: false, status: 404, error: "실행을 찾을 수 없습니다" }
  if ((await deps.stopIfRunning(runId, userId)) !== 1) {
    return { ok: false, status: 409, error: "이미 끝난 답입니다" }
  }
  if (run.workflowRunId) await deps.signal(run.workflowRunId)
  return { ok: true, status: "STOPPED" }
}
