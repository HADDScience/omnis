import { test } from "node:test"
import assert from "node:assert/strict"
import { hasRobotMark, stripRobotMark } from "./robot-mark"

test("맨 앞 🤖 와 뒤 빈칸만 뗀다", () => {
  assert.equal(stripRobotMark("🤖 옴니스가 답했어요"), "옴니스가 답했어요")
  assert.equal(stripRobotMark("🤖옴니스 답 · 요약"), "옴니스 답 · 요약")
  assert.equal(stripRobotMark("🤖  #task-1 재구성"), "#task-1 재구성")
  // 변형 선택자가 붙은 꼴
  assert.equal(stripRobotMark("🤖️ 업무 갱신에 실패했습니다"), "업무 갱신에 실패했습니다")
})

test("맨 앞이 아니면 · 없으면 그대로", () => {
  assert.equal(stripRobotMark("사람 글 🤖 가운데"), "사람 글 🤖 가운데")
  assert.equal(stripRobotMark(" 🤖 앞에 빈칸"), " 🤖 앞에 빈칸")
  assert.equal(stripRobotMark("그냥 글"), "그냥 글")
  assert.equal(stripRobotMark(""), "")
  // 한 번만 — 두 번째 🤖 는 글이다
  assert.equal(stripRobotMark("🤖 🤖 두 개"), "🤖 두 개")
  // 줄바꿈은 빈칸으로 먹지 않는다
  assert.equal(stripRobotMark("🤖\n둘째 줄"), "\n둘째 줄")
})

test("표식이 있는지", () => {
  assert.equal(hasRobotMark("🤖 옴니스"), true)
  assert.equal(hasRobotMark("🤖️"), true)
  assert.equal(hasRobotMark("옴니스 🤖"), false)
  assert.equal(hasRobotMark(""), false)
})
