import { test } from "node:test"
import assert from "node:assert/strict"
import { isConnectionDropped, retryOnDrop } from "./storage"

const dropped = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })

test("끊긴 연결로 보는 것 — ECONNRESET · socket hang up 만", () => {
  assert.equal(isConnectionDropped(dropped()), true)
  assert.equal(isConnectionDropped(new Error("socket hang up")), true)
  assert.equal(isConnectionDropped(Object.assign(new Error("read"), { code: "ECONNRESET" })), true)
  assert.equal(isConnectionDropped(new Error("시놀로지가 30초 안에 응답하지 않았습니다")), false)
  assert.equal(isConnectionDropped(new Error("시놀로지 인증서 지문이 일치하지 않습니다. 연결을 중단했습니다.")), false)
  assert.equal(isConnectionDropped("socket hang up"), false)
})

test("끊기면 한 번 더 해 본다", async () => {
  let tries = 0
  const result = await retryOnDrop(async () => {
    if (++tries === 1) throw dropped()
    return "됨"
  })
  assert.equal(result, "됨")
  assert.equal(tries, 2)
})

test("다시 해도 끊기면 그 오류로 끝난다 — 두 번까지만", async () => {
  let tries = 0
  await assert.rejects(
    retryOnDrop(async () => {
      tries++
      throw dropped()
    }),
    /socket hang up/,
  )
  assert.equal(tries, 2)
})

test("다른 오류는 다시 하지 않는다", async () => {
  let tries = 0
  await assert.rejects(
    retryOnDrop(async () => {
      tries++
      throw new Error("시놀로지가 30초 안에 응답하지 않았습니다")
    }),
    /30초/,
  )
  assert.equal(tries, 1)
})
