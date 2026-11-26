/** 칸 단위 저장의 충돌 확인. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { staleFields } from "./grants-expect"

const kinds = {
  note: "text",
  deadline: "ymd",
  ownerIds: "ids",
  taskId: "id",
} as const

const current = {
  note: "첫 메모",
  deadline: new Date("2026-12-01T00:00:00+09:00"),
  ownerIds: ["u1", "u2"],
  taskId: null,
}

test("본 값과 지금 값이 같으면 충돌이 없다(빈칸 · 순서 · 날짜 모양은 맞춰 본다)", () => {
  assert.deepEqual(
    staleFields(
      { note: " 첫 메모 ", deadline: "2026-12-01", ownerIds: ["u2", "u1"], taskId: "" },
      current,
      kinds
    ),
    []
  )
})

test("그새 바뀐 칸만 돌려준다", () => {
  assert.deepEqual(
    staleFields({ note: "옛 메모", deadline: "2026-11-30" }, current, kinds),
    ["note", "deadline"]
  )
  assert.deepEqual(staleFields({ ownerIds: ["u1"] }, current, kinds), ["ownerIds"])
})

test("expect 가 없거나 모르는 칸이면 확인하지 않는다(AI 도구는 그대로 덮어쓴다)", () => {
  assert.deepEqual(staleFields(undefined, current, kinds), [])
  assert.deepEqual(staleFields("x", current, kinds), [])
  assert.deepEqual(staleFields({ amount: "1억" }, current, kinds), [])
})
