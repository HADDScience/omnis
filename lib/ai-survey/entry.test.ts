import { test } from "node:test"
import assert from "node:assert/strict"
import { ENTRY_LABEL, bannerNeeded, recordsByUser, surveyEntry } from "./entry"

const row = (userId: string, status: string, day: number, id = `${userId}-${day}`) => ({ id, userId, status, createdAt: new Date(Date.UTC(2026, 10, day)) })

test("마이 화면 카드 — 안 했으면 참여하기, 하다 말았으면 이어서 하기, 제출했으면 확인하기", () => {
  assert.equal(ENTRY_LABEL[surveyEntry(null)], "설문 참여하기")
  assert.equal(ENTRY_LABEL[surveyEntry({ status: "IN_PROGRESS" })], "설문 이어서 하기")
  assert.equal(ENTRY_LABEL[surveyEntry({ status: "CONFIRM" })], "설문 이어서 하기")
  assert.equal(ENTRY_LABEL[surveyEntry({ status: "SUBMITTED" })], "설문 확인하기")
})

test("안내 띠 — 한 번도 제출하지 않은 사람에게만", () => {
  assert.equal(bannerNeeded(0), true)
  assert.equal(bannerNeeded(1), false)
  assert.equal(bannerNeeded(3), false)
})

test("집계는 사람마다 가장 최근에 제출한 1건 — 앞 응답은 기록으로만 남는다", () => {
  const m = recordsByUser([row("a", "SUBMITTED", 3), row("a", "SUBMITTED", 1), row("a", "SUBMITTED", 2), row("b", "SUBMITTED", 1)])
  assert.equal(m.get("a")!.counted!.id, "a-3")
  assert.equal(m.get("a")!.current.id, "a-3")
  assert.equal(m.get("a")!.submitted, 3)
  assert.equal(m.get("b")!.submitted, 1)
  assert.equal(m.size, 2)
})

test("다시 하다 만 응답은 앞서 제출한 응답을 밀어내지 않는다 — 상태는 「답하는 중」, 집계는 앞 제출", () => {
  const m = recordsByUser([row("a", "SUBMITTED", 1), row("a", "IN_PROGRESS", 5)])
  assert.equal(m.get("a")!.current.id, "a-5")
  assert.equal(m.get("a")!.counted!.id, "a-1")
  assert.equal(m.get("a")!.submitted, 1)
  assert.equal(surveyEntry(m.get("a")!.current), "resume")
  assert.equal(bannerNeeded(m.get("a")!.submitted), false, "한 번 제출한 사람에게는 띠를 띄우지 않는다")
})

test("제출한 적 없는 사람은 집계에 들지 않는다 · 응답이 없는 사람은 묶음에 없다", () => {
  const m = recordsByUser([row("a", "IN_PROGRESS", 1), row("b", "CONFIRM", 2)])
  assert.equal(m.get("a")!.counted, null)
  assert.equal(m.get("b")!.counted, null)
  assert.equal(m.get("a")!.submitted, 0)
  assert.equal(m.get("c"), undefined)
  assert.equal(recordsByUser([]).size, 0)
})
