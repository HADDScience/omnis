// 「답변 중지」 — 지금 흐르는 모델 응답을 그 자리에서 끝낸다. 순수 모듈(prisma 없음) — Workflow 안에서도 읽힌다.
// 시험: lib/agent/stop-stream.test.ts
//
// 왜 Workflow 의 run.cancel() 만으로 멈추지 않나: cancel 은 「다음 멈춤 지점」 에서 Workflow 를 세울 뿐 돌고 있는
// 단계(모델 호출)는 끝까지 돈다 — 긴 답은 대개 모델 호출 한 번이라 멈춘 효과가 없다. 그리고 그 뒤의 구간 끝(saveAgentPass)이
// 돌지 않아 그때까지 쓴 토큰 사용량 · 흘러나온 답이 남지 않는다. 그래서 모델 단계 안에서 벤더 연결을 끊고, 단계는
// 정상으로(finish) 끝낸다 — WorkflowAgent 는 도구 호출이 없으니 루프를 닫고, 구간 끝이 사용량과 그때까지의 답을 남긴다.
//
// 멈춤 신호는 그 Workflow 실행의 이름 붙은 스트림(AGENT_STOP_NAMESPACE)으로 온다. 중지 API 가 한 줄 쓰고,
// 모델 단계(lib/agent/model.ts)가 듣는다 — 단계는 DB 를 읽을 수 없다(모델 껍데기는 Workflow 묶음에도 들어가 prisma 를 넣지 못한다).

/** 멈춤 신호를 싣는 Workflow 스트림 이름 */
export const AGENT_STOP_NAMESPACE = "agent-stop"

/**
 * 멈춘 실행에서 도구가 돌려주는 값. stopWhen 이 이것을 보면 다음 모델 호출을 하지 않는다 —
 * 도구가 도는 동안 멈춘 경우(모델 스트림이 없을 때)
 */
export const RUN_STOPPED_RESULT = "[omnis:run-stopped] 사용자가 답을 멈춰 실행하지 않았습니다"

export type StreamPart = { type: string }

const utf8 = new TextEncoder()
const bytes = (s: string) => utf8.encode(s).length

/**
 * 멈춘 호출의 토큰 어림. 벤더는 응답을 끝까지 받아야 사용량을 주므로 끊은 호출은 사용량을 모른다.
 * UTF-8 3바이트 ≈ 1토큰 — 한국어 1글자(3바이트)를 1토큰으로, 영어 · JSON 은 실제보다 조금 크게 센다(적게 잡지 않는다).
 * 캐시 입력은 모른다 — 전부 캐시 없는 입력으로 센다
 */
export function estimateTokens(byteCount: number): number {
  return Math.ceil(Math.max(byteCount, 0) / 3)
}

/** 모델에 보낸 입력의 바이트 — 글 · 도구 호출 · 도구 결과 · 도구 정의. 암호화된 추론 덩어리(providerOptions)는 세지 않는다 */
export function promptBytes(options: { prompt?: unknown; tools?: unknown }): number {
  let n = 0
  const prompt = Array.isArray(options.prompt) ? (options.prompt as { role?: string; content?: unknown }[]) : []
  for (const m of prompt) {
    if (typeof m.content === "string") {
      n += bytes(m.content)
      continue
    }
    if (!Array.isArray(m.content)) continue
    for (const p of m.content as { type?: string; text?: unknown; input?: unknown; output?: unknown }[]) {
      if (typeof p.text === "string") n += bytes(p.text)
      else if (p.type === "tool-call") n += bytes(JSON.stringify(p.input ?? null))
      else if (p.type === "tool-result") n += bytes(JSON.stringify(p.output ?? null))
    }
  }
  if (options.tools) n += bytes(JSON.stringify(options.tools))
  return n
}

/**
 * source 를 그대로 흘리다가 stop 이 풀리면 위(벤더 연결)를 끊고, 열린 글 · 추론 칸을 닫은 뒤 finish 하나로 끝낸다.
 * finish 의 사용량은 어림(estimateTokens) — 입력은 inputBytes, 출력은 그때까지 받은 글 · 추론 조각.
 * source 가 이미 finish 를 보냈으면 덧붙이지 않는다. 다 읽었거나 끊었으면 onEnd 를 한 번 부른다(멈춤 듣기를 닫는다)
 */
export function stoppableStream<P extends StreamPart>(
  source: ReadableStream<P>,
  stop: Promise<unknown>,
  opts: { inputBytes: number; onEnd?: () => void },
): ReadableStream<P> {
  const reader = source.getReader()
  const openText = new Set<string>()
  const openReasoning = new Set<string>()
  let outBytes = 0
  let sawFinish = false
  let ended = false
  // 신호가 오지 않거나(거절) 듣기가 닫혀도 흐름은 그대로 — 멈춤으로만 쓴다
  const stopped = new Promise<"stop">((resolve) => void stop.then(() => resolve("stop"), () => {}))

  const end = () => {
    if (ended) return
    ended = true
    opts.onEnd?.()
  }

  return new ReadableStream<P>({
    async pull(controller) {
      if (ended) return
      let next: ReadableStreamReadResult<P> | "stop"
      try {
        next = await Promise.race([reader.read(), stopped])
      } catch (err) {
        end()
        controller.error(err)
        return
      }
      if (next === "stop") {
        end()
        await reader.cancel("stopped").catch(() => {})
        if (!sawFinish) {
          for (const id of openText) controller.enqueue({ type: "text-end", id } as unknown as P)
          for (const id of openReasoning) controller.enqueue({ type: "reasoning-end", id } as unknown as P)
          const input = estimateTokens(opts.inputBytes)
          const output = estimateTokens(outBytes)
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "omnis-stopped" },
            usage: {
              inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: undefined },
              outputTokens: { total: output, text: output, reasoning: undefined },
              raw: { estimated: true },
            },
          } as unknown as P)
        }
        controller.close()
        return
      }
      if (next.done) {
        end()
        controller.close()
        return
      }
      const p = next.value
      const f = p as unknown as { id?: unknown; delta?: unknown }
      const id = typeof f.id === "string" ? f.id : ""
      switch (p.type) {
        case "text-start": openText.add(id); break
        case "text-end": openText.delete(id); break
        case "reasoning-start": openReasoning.add(id); break
        case "reasoning-end": openReasoning.delete(id); break
        case "text-delta":
        case "reasoning-delta":
          outBytes += bytes(String(f.delta ?? ""))
          break
        case "finish": sawFinish = true; break
      }
      controller.enqueue(p)
    },
    async cancel(reason) {
      end()
      await reader.cancel(reason)
    },
  })
}
