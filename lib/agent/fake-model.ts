// 시험용 모델 — 벤더를 부르지 않고 질문을 되받아 답한다. e2e 가 @옴니스 → 세션 → 답 → 방 안내까지를
// 실제 Workflow · 저장 경로로 돌리게 한다(tests/feature/omnis-mention-session.spec.ts).
// OMNIS_AGENT_FAKE=1 일 때만, 운영 배포(VERCEL_ENV=production)에서는 켜지지 않는다 — lib/agent/model.ts realModel
import type { LanguageModel } from "ai"

type V4 = Extract<Exclude<LanguageModel, string>, { specificationVersion: "v4" }>
type CallOptions = Parameters<V4["doStream"]>[0]
type StreamPart = Awaited<ReturnType<V4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never

export function fakeAgentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OMNIS_AGENT_FAKE === "1" && env.VERCEL_ENV !== "production"
}

/** 마지막 사용자 글의 글자만 */
export function lastUserText(prompt: CallOptions["prompt"]): string {
  const last = [...prompt].reverse().find((m) => m.role === "user")
  if (!last || !Array.isArray(last.content)) return ""
  return last.content.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim()
}

export function fakeAnswer(question: string): string {
  const q = question.replace(/\s+/g, " ").slice(0, 40)
  // 세 줄 — 방 안내는 앞 두 줄만 싣는다(lib/omnis-mention-rules.ts answerSummary). 셋째 줄은 세션에만 있어야 한다
  return `시험 답입니다 — 「${q}」 를 받았어요.\n실제 모델은 부르지 않았습니다.\n셋째 줄은 세션에만 있습니다.`
}

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}
const STOP = { unified: "stop" as const, raw: "stop" }

export function fakeAgentModel(spec: { vendor: string; model: string }): V4 {
  return {
    specificationVersion: "v4",
    provider: spec.vendor,
    modelId: spec.model,
    supportedUrls: {},
    async doGenerate(options: CallOptions) {
      return { content: [{ type: "text", text: fakeAnswer(lastUserText(options.prompt)) }], finishReason: STOP, usage: USAGE, warnings: [] }
    },
    async doStream(options: CallOptions) {
      const text = fakeAnswer(lastUserText(options.prompt))
      const parts: StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", usage: USAGE, finishReason: STOP },
      ]
      return {
        stream: new ReadableStream<StreamPart>({
          start(c) {
            for (const p of parts) c.enqueue(p)
            c.close()
          },
        }),
      }
    },
  } as V4
}
