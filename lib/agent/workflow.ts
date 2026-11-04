// 옴니스 에이전트 한 구간 — Vercel AI SDK 7 WorkflowAgent. 계획서 「실행 모델」.
//
//   사용자 글 → 실행(AgentRun) → 이 Workflow 한 번 = 한 구간
//     모델 ↔ 읽기 도구(자동) … 쓰기 도구를 부르면 needsApproval 로 멈추고 구간이 끝난다(카드 저장)
//   [확인] → DB 의 대화에 승인 응답을 붙여 이 Workflow 를 다시 연다 → WorkflowAgent 가 승인된 도구를 실행하고 이어 간다
//
// 이 파일은 Workflow 문맥(결정적 · Node 없음)에서 돈다. DB · 벤더 호출은 전부 steps.ts 의 "use step" 함수다.
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow"
import { jsonSchema, tool, type ToolSet } from "ai"
import { getWorkflowMetadata, getWritable } from "workflow"
import { OmnisLanguageModel } from "./model"
import { limitReason, spentWith, usageOf } from "./limits"
import { RUN_STOPPED_RESULT } from "./stop-stream"
import { closeAgentStream, loadAgentContext, runAgentReadTool, runAgentWriteTool, saveAgentPass } from "./steps"

/** 막힌 제안만 있어 곧바로 이어 가는 일이 끝없이 돌지 않게 */
const MAX_PASSES = 3

export async function omnisAgentWorkflow(runId: string) {
  "use workflow"
  const writable = getWritable<ModelCallStreamPart>()
  // 「답변 중지」 신호는 이 Workflow 실행의 멈춤 스트림으로 온다 — 모델 단계가 듣는다(lib/agent/model.ts)
  const { workflowRunId } = getWorkflowMetadata()
  let status = "RUNNING"

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const ctx = await loadAgentContext(runId)
    if (!ctx.ok) {
      await closeAgentStream()
      return { status: "SKIPPED", reason: ctx.reason }
    }

    const tools: ToolSet = {}
    for (const spec of ctx.tools) {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema<Record<string, unknown>>(spec.schema as Parameters<typeof jsonSchema>[0]),
        ...(spec.risk === "write"
          ? {
              needsApproval: true,
              execute: (input: Record<string, unknown>, { toolCallId }: { toolCallId: string }) =>
                runAgentWriteTool(runId, spec.name, input, toolCallId),
            }
          : { execute: (input: Record<string, unknown>) => runAgentReadTool(runId, spec.name, input) }),
      })
    }

    const agent = new WorkflowAgent({
      model: new OmnisLanguageModel({ vendor: ctx.model.vendor, model: ctx.model.model, stopRunId: workflowRunId }),
      instructions: ctx.instructions,
      tools,
      providerOptions: ctx.providerOptions,
      // 같은 승인 요청을 서버가 서명한다 — 대화가 바뀌어 들어와도 서명이 없으면 실행하지 않는다
      experimental_toolApprovalSecret: { environmentVariable: "OMNIS_AGENT_APPROVAL_SECRET" },
      toolCallConcurrency: 1,
    })

    const result = await agent.stream({
      messages: ctx.messages,
      writable,
      // 여러 구간을 한 스트림으로 보낸다 — 닫는 것은 Workflow 가 끝날 때
      preventClose: true,
      sendFinish: false,
      // 상한에 닿았거나, 도구가 도는 동안 사용자가 멈췄으면(도구가 RUN_STOPPED_RESULT 를 돌려준다) 모델을 더 부르지 않는다
      stopWhen: ({ steps }) =>
        steps.some((s) => s.toolResults.some((r) => r.output === RUN_STOPPED_RESULT)) ||
        limitReason(spentWith(ctx.spent, ctx.modelKey, steps.map((s) => usageOf(s.usage))), ctx.limits) !== null,
    })

    const saved = await saveAgentPass(runId, {
      messages: result.messages,
      steps: result.steps.map((s) => ({ ...usageOf(s.usage), finishReason: s.finishReason, text: s.text })),
      ...("error" in result && result.error !== undefined ? { error: String(result.error instanceof Error ? result.error.message : result.error) } : {}),
    })
    status = saved.status
    if (!saved.autoContinue) break
  }
  await closeAgentStream()
  return { status }
}
