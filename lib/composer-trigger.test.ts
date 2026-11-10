import { test } from "node:test"
import assert from "node:assert/strict"
import { composerTrigger } from "./composer-trigger"

const on = { commands: true }
const off = { commands: false }

test("명령은 글 맨 앞에서만, 명령을 끈 방에서는 아니다", () => {
  assert.deepEqual(composerTrigger("/업", on), { kind: "command", query: "업", start: 0 })
  assert.equal(composerTrigger("/업", off), null)
  assert.equal(composerTrigger("가격 3/4", on), null)
  assert.equal(composerTrigger("/업무 견적", on), null)
})

test("# 와 @ 는 문장 중간에서도 그 자리부터 잡는다", () => {
  assert.deepEqual(composerTrigger("확인 부탁 #가벽", on), { kind: "task", query: "가벽", start: 6 })
  assert.deepEqual(composerTrigger("@사원", off), { kind: "user", query: "사원", start: 0 })
  assert.deepEqual(composerTrigger("안녕 @", off), { kind: "user", query: "", start: 3 })
})

test("공백을 치면 목록이 닫힌다", () => {
  assert.equal(composerTrigger("@사원 ", on), null)
  assert.equal(composerTrigger("#가벽 설치", on), null)
  assert.equal(composerTrigger("그냥 글", on), null)
})
