import { test } from "node:test"
import assert from "node:assert/strict"
import { createSerialQueue } from "./serial-queue"

const deferred = () => {
  let resolve = () => {}
  let reject = (_: Error) => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test("앞의 일이 끝나기 전에는 다음 일을 시작하지 않는다", async () => {
  const q = createSerialQueue()
  const gate = deferred()
  const log: string[] = []
  const a = q.run(async () => {
    log.push("a 시작")
    await gate.promise
    log.push("a 끝")
  })
  const b = q.run(async () => {
    log.push("b")
  })
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(log, ["a 시작"])
  gate.resolve()
  await Promise.all([a, b])
  assert.deepEqual(log, ["a 시작", "a 끝", "b"])
})

test("앞의 일이 실패해도 뒤의 일은 돌고, 실패는 맡긴 쪽이 받는다", async () => {
  const q = createSerialQueue()
  const a = q.run(async () => {
    throw new Error("올리지 못함")
  })
  const b = q.run(async () => "보냄")
  await assert.rejects(a, /올리지 못함/)
  assert.equal(await b, "보냄")
})
