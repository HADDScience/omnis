/** 탭 이동 멈춤 풀기 — 새로 열기 한 번 · ChunkLoadError · RSC 실패 줄 · 오프라인 보고 줄. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ERROR_QUEUE_MAX,
  RESCUE_GUARD_MS,
  drainQueue,
  enqueueReport,
  isChunkLoadError,
  rescueAction,
  rscFailureMessage,
} from "./nav-rescue"

function mem() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

test("멈춘 이동은 한 번만 새로 연다 — 같은 주소를 1분 안에 다시 열지 않는다", () => {
  const store = mem()
  const base = { target: "/tasks", current: "/chat", online: true, store }
  assert.equal(rescueAction({ ...base, now: 1_000 }), "assign")
  assert.equal(rescueAction({ ...base, now: 1_000 + RESCUE_GUARD_MS - 1 }), null)
  assert.equal(rescueAction({ ...base, now: 1_000 + RESCUE_GUARD_MS }), "assign")
  // 다른 주소는 따로 센다
  assert.equal(rescueAction({ ...base, target: "/omnis", now: 2_000 }), "assign")
})

test("오프라인이면 기다리고, 지금 주소와 같으면 reload", () => {
  const store = mem()
  assert.equal(rescueAction({ target: "/tasks", current: "/chat", online: false, now: 0, store }), null)
  assert.equal(rescueAction({ target: "/tasks", current: "/tasks", online: true, now: 0, store }), "reload")
})

test("저장소를 못 써도(사생활 보호) 새로 열기는 한다", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied")
    },
    setItem: () => {
      throw new Error("denied")
    },
    removeItem: () => {},
  }
  assert.throws(() => broken.getItem())
  assert.equal(rescueAction({ target: "/tasks", current: "/chat", online: true, now: 0, store: null }), "assign")
})

test("ChunkLoadError 를 알아본다", () => {
  assert.equal(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" })), true)
  assert.equal(isChunkLoadError(new Error("Loading chunk 8123 failed.\n(error: https://x/_next/static/chunks/8123.js)")), true)
  assert.equal(isChunkLoadError(new Error("Loading CSS chunk app/omnis failed")), true)
  assert.equal(isChunkLoadError(new Error("Failed to load chunk /_next/static/chunks/a.js from module 1")), true)
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false)
  assert.equal(isChunkLoadError(null), false)
})

test("Next 의 RSC 실패 줄만 골라낸다", () => {
  assert.equal(
    rscFailureMessage(["Failed to fetch RSC payload for https://x/omnis. Falling back to browser navigation.", new TypeError("Failed to fetch")]),
    "Failed to fetch RSC payload for https://x/omnis. Falling back to browser navigation."
  )
  assert.equal(rscFailureMessage(["Warning: something"]), null)
  assert.equal(rscFailureMessage([new Error("x")]), null)
})

test("오프라인 보고 줄 — 쌓고 꺼내면 비고, 오래된 것부터 버린다", () => {
  const store = mem()
  for (let i = 0; i < ERROR_QUEUE_MAX + 5; i++) enqueueReport(store, { message: `m${i}`, at: i })
  const out = drainQueue(store)
  assert.equal(out.length, ERROR_QUEUE_MAX)
  assert.equal(out[0].message, "m5")
  assert.deepEqual(drainQueue(store), [])
  assert.deepEqual(drainQueue(null), [])
})
