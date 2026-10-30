/** 「답변 중지」 — 흐르는 모델 응답을 그 자리에서 끝내기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { estimateTokens, promptBytes, stoppableStream, type StreamPart } from "./stop-stream"

type P = StreamPart & Record<string, unknown>

/** 조각을 하나씩 내보내고, 다음 조각은 gate 가 풀릴 때까지 기다리는 벤더 흉내. 끊겼는지(cancelled)도 본다 */
function fakeSource(parts: P[], holdAfter = Infinity) {
  let i = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  const state = { cancelled: false }
  const stream = new ReadableStream<P>({
    async pull(c) {
      if (i === holdAfter) await gate
      if (state.cancelled) return
      if (i < parts.length) c.enqueue(parts[i++])
      else c.close()
    },
    cancel() {
      state.cancelled = true
      release()
    },
  })
  return { stream, state, release }
}

async function readAll(s: ReadableStream<P>) {
  const out: P[] = []
  const r = s.getReader()
  for (;;) {
    const { value, done } = await r.read()
    if (done) return out
    out.push(value)
  }
}

const head: P[] = [
  { type: "stream-start", warnings: [] },
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-end", id: "r1" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "이번 달 업무를 " },
  { type: "text-delta", id: "t1", delta: "담당자별로" },
]
const tail: P[] = [
  { type: "text-delta", id: "t1", delta: " 정리하면…" },
  { type: "text-end", id: "t1" },
  { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage: { inputTokens: { total: 100 }, outputTokens: { total: 20 } } },
]

test("멈추지 않으면 그대로 흘린다 — 조각 · 순서 · finish 그대로", async () => {
  const src = fakeSource([...head, ...tail])
  let ended = 0
  const out = await readAll(stoppableStream(src.stream, new Promise(() => {}), { inputBytes: 300, onEnd: () => ended++ }))
  assert.deepEqual(out, [...head, ...tail])
  assert.equal(src.state.cancelled, false)
  assert.equal(ended, 1)
})

test("멈추면 벤더 연결을 끊고, 열린 글 칸을 닫은 뒤 finish(stop, 어림 사용량) 하나로 끝낸다", async () => {
  const src = fakeSource([...head, ...tail], head.length) // head 다음에서 벤더가 멈춰 있다(아직 쓰는 중)
  let stop: () => void = () => {}
  const signal = new Promise<void>((r) => (stop = r))
  let ended = 0
  const reading = readAll(stoppableStream(src.stream, signal, { inputBytes: 300, onEnd: () => ended++ }))
  await new Promise((r) => setTimeout(r, 10))
  stop()
  const out = await reading

  assert.equal(src.state.cancelled, true, "벤더 연결(source)을 끊어야 한다")
  assert.deepEqual(out.slice(0, head.length), head, "그때까지 흘러나온 글은 그대로")
  const rest = out.slice(head.length)
  assert.deepEqual(rest.map((p) => p.type), ["text-end", "finish"], "쓰던 글 칸을 닫고 finish — 그 뒤 조각은 없다")
  assert.equal(rest[0].id, "t1")
  const finish = rest[1] as unknown as { finishReason: { unified: string }; usage: { inputTokens: { total: number; cacheRead: number }; outputTokens: { total: number } } }
  assert.equal(finish.finishReason.unified, "stop")
  assert.equal(finish.usage.inputTokens.total, estimateTokens(300))
  assert.equal(finish.usage.inputTokens.cacheRead, 0)
  // 「이번 달 업무를 」 + 「담당자별로」 — 한글 11자(33바이트) + 공백 3 = 36바이트 → 12토큰
  assert.equal(finish.usage.outputTokens.total, 12)
  assert.equal(ended, 1)
})

test("글이 오기 전에 멈춰도 finish 로 끝난다(출력 0) — 열린 추론 칸도 닫는다", async () => {
  const src = fakeSource([{ type: "stream-start", warnings: [] }, { type: "reasoning-start", id: "r1" }, ...tail], 2)
  const out = await readAll(stoppableStream(src.stream, Promise.resolve(), { inputBytes: 0 }))
  // 이미 풀린 신호 — 첫 조각보다 먼저 멈출 수도 있다. 어느 쪽이든 끝은 finish 하나이고 벤더는 끊긴다
  assert.equal(out.at(-1)?.type, "finish")
  assert.equal(out.filter((p) => p.type === "finish").length, 1)
  assert.equal(src.state.cancelled, true)
  const finish = out.at(-1) as unknown as { usage: { outputTokens: { total: number } } }
  assert.equal(finish.usage.outputTokens.total, 0)
})

test("벤더가 이미 finish 를 보낸 뒤 신호가 와도 finish 를 덧붙이지 않는다", async () => {
  const all = [...head, ...tail]
  const src = fakeSource(all, all.length) // 다 보낸 뒤 닫기 전에 멈춰 있다
  let stop: () => void = () => {}
  const signal = new Promise<void>((r) => (stop = r))
  const reading = readAll(stoppableStream(src.stream, signal, { inputBytes: 10 }))
  await new Promise((r) => setTimeout(r, 10))
  stop()
  const out = await reading
  assert.deepEqual(out, all)
})

test("신호가 거절되면(멈춤 스트림이 닫힘) 멈춤으로 보지 않는다", async () => {
  const src = fakeSource([...head, ...tail])
  const out = await readAll(stoppableStream(src.stream, Promise.reject(new Error("closed")), { inputBytes: 10 }))
  assert.deepEqual(out, [...head, ...tail])
  assert.equal(src.state.cancelled, false)
})

test("입력 어림 — 글 · 도구 호출 · 결과 · 도구 정의를 세고, 암호화된 추론 덩어리는 세지 않는다", () => {
  const big = "x".repeat(9000)
  const n = promptBytes({
    prompt: [
      { role: "system", content: "안녕" }, // 6
      { role: "user", content: [{ type: "text", text: "abc" }] }, // 3
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { openai: { reasoningEncryptedContent: big } } }, // 0
          { type: "tool-call", input: { q: "a" } }, // {"q":"a"} 9
        ],
      },
      { role: "tool", content: [{ type: "tool-result", output: { type: "text", value: "ok" } }] }, // 29
    ],
  })
  assert.equal(n, 6 + 3 + 0 + 9 + JSON.stringify({ type: "text", value: "ok" }).length)
  assert.equal(promptBytes({ tools: [{ name: "a" }] }), JSON.stringify([{ name: "a" }]).length)
  assert.equal(estimateTokens(0), 0)
  assert.equal(estimateTokens(4), 2)
})
