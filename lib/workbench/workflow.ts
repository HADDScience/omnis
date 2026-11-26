// 작업용 컴퓨터 작업 1건 — 세션을 열고, 몇 초마다 진행을 가져오고, 멈추면 끝낸다.
// 이 파일은 Workflow 문맥(결정적 · Node 없음)에서 돈다. API · DB 는 전부 steps.ts 의 "use step" 함수다.
// 이벤트를 한 함수 안에서 오래 스트리밍하지 않는다 — 함수 시간 상한(기본 300초)에 걸리지 않게 짧게 끊어 가져오고 Workflow 가 잠든다.
import { sleep } from "workflow"
import { finishStep, openStep, pumpStep } from "./steps"

/** 5초 간격으로 최대 이만큼(약 70분) — 시간 상한은 pumpJob 이 maxMinutes 로 따로 본다 */
const MAX_PUMPS = 840
const WAIT_MS = 5_000

export async function workbenchJobWorkflow(jobId: string, resume: boolean) {
  "use workflow"
  if (!resume) {
    const opened = await openStep(jobId)
    if (!opened.ok) return { status: "FAILED" }
  }
  for (let i = 0; i < MAX_PUMPS; i++) {
    const r = await pumpStep(jobId)
    if (r.state === "running") {
      await sleep(WAIT_MS)
      continue
    }
    const status = await finishStep(jobId, r.state === "timeout" ? "timeout" : r.outcome)
    return { status }
  }
  return { status: await finishStep(jobId, "timeout") }
}
