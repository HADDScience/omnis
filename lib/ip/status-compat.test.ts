// 대장이 상태 5개로 바뀐 뒤에도 /ip 화면의 줄 세우기 · 내보내기 · 경고가 예전 뜻을 지키는지 본다.
import { test } from "node:test"
import assert from "node:assert/strict"

import { detect } from "./detect"
import { exportGroupOf } from "./excel"
import { groupOf, sortByDefault } from "./stage-order"
import type { Patent } from "./types"

const TODAY = "2026-11-04"
const OLD = "2026-01-01"

function patent(over: Partial<Patent>): Patent {
  return {
    id: "ZZ-1", title: "시험 건", appNo: "10-2000-0000001", regNo: null, date: OLD,
    filedOn: null, registeredOn: null, applicant: "시험", status: "출원", note: "", ...over,
  }
}

const stale = (p: Patent, events: { stage: string; date: string; source?: string }[] = []) =>
  detect([], [p], TODAY, events.map((e) => ({ entityKind: "patent" as const, entityId: p.id, ...e })))
    .filter((i) => i.key.startsWith("stale:"))

test("상태 5개의 기본 차례 — 등록 · 출원 · 출원전 · 거절 · 포기", () => {
  assert.deepEqual(sortByDefault(["포기", "출원전", "거절", "출원", "등록"]), ["등록", "출원", "출원전", "거절", "포기"])
  assert.equal(groupOf("출원전"), 2)
  assert.equal(groupOf("출원"), 1)
})

test("거절 · 포기는 내보내기에서 준비 칸으로 떨어지지 않는다", () => {
  assert.equal(exportGroupOf("patent", "거절"), "특허 거절")
  assert.equal(exportGroupOf("patent", "포기"), "특허 중단")
  assert.equal(exportGroupOf("trademark", "거절"), "상표 거절")
  assert.equal(exportGroupOf("trademark", "포기"), "상표 중단")
  assert.equal(exportGroupOf("patent", "출원전"), "특허 출원 준비")
  assert.equal(exportGroupOf("trademark", "출원전"), "상표 준비")
})

test("오래 멈춘 출원전은 경고한다", () => {
  assert.equal(stale(patent({ status: "출원전", appNo: null })).length, 1)
})

test("출원 상태도 마지막 사건이 우리 차례면 경고한다", () => {
  assert.equal(stale(patent({}), [{ stage: "의견제출통지", date: OLD }]).length, 1)
})

test("심사 대기인 출원은 경고하지 않는다", () => {
  assert.equal(stale(patent({})).length, 0)
  assert.equal(stale(patent({}), [{ stage: "출원", date: OLD }]).length, 0)
})

test("우리 차례가 지났거나 값 정정뿐이면 경고하지 않는다", () => {
  assert.equal(stale(patent({}), [{ stage: "의견제출통지", date: "2025-12-01" }, { stage: "심사청구", date: OLD }]).length, 0)
  assert.equal(stale(patent({}), [{ stage: "의견제출통지", date: OLD, source: "edit" }]).length, 0)
})

test("닫힌 상태는 경고하지 않는다", () => {
  assert.equal(stale(patent({ status: "등록", regNo: "10-0000001" })).length, 0)
  assert.equal(stale(patent({ status: "포기" })).length, 0)
})
