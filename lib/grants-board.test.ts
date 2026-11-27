/** 국가과제 우리 결정 보드. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BOARD_COLUMNS,
  cardDue,
  cardMoney,
  groupByStage,
  readBoardView,
  stageMove,
  withStage,
} from "./grants-board"

test("열은 단계 순서 — 준비 · 제출 완료 · 선정됨 · 미선정 · 수행 중 · 완료 · 중단", () => {
  assert.deepEqual(
    BOARD_COLUMNS.map((c) => c.label),
    ["준비", "제출 완료", "선정됨", "미선정", "수행 중", "완료", "중단"]
  )
})

test("보기는 view=board 일 때만 보드, 나머지는 목록", () => {
  assert.equal(readBoardView("board"), "board")
  assert.equal(readBoardView("list"), "list")
  assert.equal(readBoardView(undefined), "list")
  assert.equal(readBoardView("BOARD"), "list")
})

test("단계별로 나누고 열 안의 순서는 받은 순서를 지킨다 · 빈 열도 있다", () => {
  const g = groupByStage([
    { id: "a", stage: "PREPARING" as const },
    { id: "b", stage: "STOPPED" as const },
    { id: "c", stage: "PREPARING" as const },
  ])
  assert.deepEqual(g.PREPARING.map((r) => r.id), ["a", "c"])
  assert.deepEqual(g.STOPPED.map((r) => r.id), ["b"])
  assert.deepEqual(g.IN_PROGRESS, [])
  assert.equal(Object.keys(g).length, 7)
})

test("다른 열에 놓으면 단계와 expect(옮기기 전 단계)를 보낸다", () => {
  assert.deepEqual(stageMove("PREPARING", "SUBMITTED"), {
    stage: "SUBMITTED",
    expect: { stage: "PREPARING" },
  })
})

test("같은 열 · 모르는 열에 놓으면 보내지 않는다", () => {
  assert.equal(stageMove("SELECTED", "SELECTED"), null)
  assert.equal(stageMove("SELECTED", "REVIEW"), null)
  assert.equal(stageMove("SELECTED", null), null)
})

test("화면 먼저 옮기기 · 되돌리기는 그 카드 하나만 바꾼다", () => {
  const rows = [
    { id: "a", stage: "PREPARING" as const },
    { id: "b", stage: "PREPARING" as const },
  ]
  const moved = withStage(rows, "a", "SUBMITTED")
  assert.deepEqual(moved.map((r) => r.stage), ["SUBMITTED", "PREPARING"])
  assert.deepEqual(withStage(moved, "a", "PREPARING"), rows)
  assert.equal(rows[0].stage, "PREPARING")
})

test("지원금액 — 확정 지원금이 먼저, 없으면 적어 둔 글", () => {
  assert.equal(cardMoney({ awardedAmount: "120000000", amount: "최대 1억" }), "120,000,000원")
  assert.equal(cardMoney({ awardedAmount: null, amount: " 최대 1억 " }), "최대 1억")
  assert.equal(cardMoney({ awardedAmount: null, amount: "  " }), null)
  assert.equal(cardMoney({ awardedAmount: null, amount: null }), null)
})

test("카드 날짜 — 수행 중은 종료일, 완료는 완료일, 나머지는 마감(서울 날짜)", () => {
  const base = {
    deadline: "2027-03-01T15:00:00.000Z",
    endsOn: "2027-12-30T15:00:00.000Z",
    completedOn: "2028-01-04T15:00:00.000Z",
  }
  assert.equal(cardDue({ ...base, stage: "PREPARING" }), "마감 2027-03-02")
  assert.equal(cardDue({ ...base, stage: "IN_PROGRESS" }), "~ 2027-12-31")
  assert.equal(cardDue({ ...base, stage: "COMPLETED" }), "완료 2028-01-05")
  assert.equal(cardDue({ ...base, stage: "IN_PROGRESS", endsOn: null }), null)
  assert.equal(cardDue({ stage: "SUBMITTED", deadline: null, endsOn: null, completedOn: null }), null)
})
