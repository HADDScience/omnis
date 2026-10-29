// 에이전트가 쓰는 모델 — 실제 벤더 모델을 감싼 얇은 껍데기.
//
// 왜 감싸나: WorkflowAgent 는 모델 객체를 Workflow 단계 경계로 넘기며 직렬화한다. @ai-sdk/openai 의 모델을
// 그대로 넘기면 직렬화가 headers() 를 풀어 **API 키가 든 Authorization 헤더가 Workflow 이벤트 기록에 남는다**
// (provider-utils serializeModelOptions — 2026-10-29 확인). 이 껍데기는 vendor · 모델 id · 옵션만 넘기고,
// 실제 모델은 모델 단계(Node) 안에서 그 자리의 환경변수로 만든다.
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import type { LanguageModel } from "ai"
import type { AiVendor } from "@/lib/ai-models"

type V4 = Extract<Exclude<LanguageModel, string>, { specificationVersion: "v4" }>
type CallOptions = Parameters<V4["doStream"]>[0]

export interface OmnisModelSpec {
  vendor: AiVendor
  model: string
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
    return { vendor: m.spec.vendor, model: m.spec.model }
  }

  static [WORKFLOW_DESERIALIZE](data: OmnisModelSpec) {
    return new OmnisLanguageModel(data)
  }

  async doGenerate(options: CallOptions) {
    return (await realModel(this.spec)).doGenerate(options)
  }

  async doStream(options: CallOptions) {
    return (await realModel(this.spec)).doStream(options)
  }
}
