// 에이전트가 쓰는 모델 — 실제 벤더 모델을 감싼 얇은 껍데기.
//
// 왜 감싸나: WorkflowAgent 는 모델 객체를 Workflow 단계 경계로 넘기며 직렬화한다. @ai-sdk/openai 의 모델을
// 그대로 넘기면 직렬화가 headers() 를 풀어 **API 키가 든 Authorization 헤더가 Workflow 이벤트 기록에 남는다**
// (provider-utils serializeModelOptions — 2026-10-29 확인). 이 껍데기는 vendor · 모델 id · 옵션만 넘기고,
// 실제 모델은 모델 단계(Node) 안에서 그 자리의 환경변수로 만든다.
//
// 「답변 중지」 도 여기서 듣는다 — stopRunId(이 구간의 Workflow 실행 id)가 있으면 그 실행의 멈춤 스트림을 들으며,
// 신호가 오면 벤더 연결을 끊고 응답을 정상으로 끝낸다(lib/agent/stop-stream.ts).
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import type { LanguageModel } from "ai"
import type { AiVendor } from "@/lib/ai-models"
import { AGENT_STOP_NAMESPACE, promptBytes, stoppableStream } from "./stop-stream"

type V4 = Extract<Exclude<LanguageModel, string>, { specificationVersion: "v4" }>
type CallOptions = Parameters<V4["doStream"]>[0]

export interface OmnisModelSpec {
  vendor: AiVendor
  model: string
  /** 멈춤 신호를 들을 Workflow 실행 id. 비밀이 아니다 — 이벤트 기록에 남아도 된다 */
  stopRunId?: string
}

export async function realModel(spec: OmnisModelSpec): Promise<V4> {
  switch (spec.vendor) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai")
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(spec.model) as V4
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic")
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(spec.model) as V4
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(spec.model) as V4
    }
  }
}

export class OmnisLanguageModel implements V4 {
  readonly specificationVersion = "v4" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  constructor(readonly spec: OmnisModelSpec) {
    this.provider = spec.vendor
    this.modelId = spec.model
  }

  static [WORKFLOW_SERIALIZE](m: OmnisLanguageModel) {
    return { vendor: m.spec.vendor, model: m.spec.model, ...(m.spec.stopRunId ? { stopRunId: m.spec.stopRunId } : {}) }
  }

  static [WORKFLOW_DESERIALIZE](data: OmnisModelSpec) {
    return new OmnisLanguageModel(data)
  }

  async doGenerate(options: CallOptions) {
    return (await realModel(this.spec)).doGenerate(options)
  }

  async doStream(options: CallOptions) {
    const model = await realModel(this.spec)
    if (!this.spec.stopRunId) return model.doStream(options)
    // 모델 단계(Node) 안에서만 돈다 — Workflow 묶음의 workflow/api 는 빈 껍데기라 여기서 불러온다
    const { getRun } = await import("workflow/api")
    const listen = getRun(this.spec.stopRunId).getReadable({ namespace: AGENT_STOP_NAMESPACE, startIndex: 0 }).getReader()
    const stop = listen.read().then((r) => {
      if (r.done) throw new Error("멈춤 스트림이 닫혔습니다")
    })
    const close = () => void listen.cancel().catch(() => {})
    try {
      const result = await model.doStream(options)
      return { ...result, stream: stoppableStream(result.stream, stop, { inputBytes: promptBytes(options), onEnd: close }) }
    } catch (err) {
      close()
      throw err
    }
  }
}
