// Workflow 단계 — DB · 도구 · 벤더 호출처럼 Node 가 필요한 일. 본문은 lib/agent/store.ts 에 있다.
// "use step" 함수의 인자와 반환값은 Workflow 이벤트 기록에 남는다 — 비밀(API 키)을 넘기지 않는다.
import type { PassResult } from "./store"

export async function loadAgentContext(runId: string) {
  "use step"
  const { loadContext } = await import("./store")
  return loadContext(runId)
}

export async function runAgentReadTool(runId: string, name: string, input: Record<string, unknown>) {
  "use step"
  const { readTool } = await import("./store")
  return readTool(runId, name, input)
}

export async function runAgentWriteTool(runId: string, name: string, input: Record<string, unknown>, toolCallId: string) {
  "use step"
  const { writeTool } = await import("./store")
  return writeTool(runId, name, input, toolCallId)
}

export async function saveAgentPass(runId: string, pass: PassResult) {
  "use step"
  const { savePass } = await import("./store")
  return savePass(runId, pass)
}

/**
 * 스트림을 닫는다. 구간을 여럿 이어 보내려고 preventClose 로 열어 두므로 직접 닫아야 한다 —
 * 닫지 않으면 Workflow 가 끝나도 응답이 한참(로컬 실측 2.5분) 열려 있어 화면이 끝을 모른다.
 */
export async function closeAgentStream() {
  "use step"
  const { getWritable } = await import("workflow")
  const { AGENT_STOP_NAMESPACE } = await import("./stop-stream")
  await getWritable().close()
  // 멈춤 스트림도 닫는다 — 듣던 쪽이 남지 않게. 신호가 한 번도 오지 않았으면 열린 적이 없을 수 있다
  await getWritable({ namespace: AGENT_STOP_NAMESPACE }).close().catch(() => {})
}
