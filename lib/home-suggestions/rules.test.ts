import { test } from "node:test"
import assert from "node:assert/strict"
import {
  COMPANY_DAILY_AI, COOLDOWN_MS, SHOW, USER_DAILY_AI, buildPrompt, candidateHash, codeLine, codeOrder, decide, daysUntil,
  dueWord, parseAiOrder, seoulDay, toItems, type Candidate, type RunLite,
} from "./rules"

// 모든 값은 지어낸 것이다
const NOW = new Date("2026-11-27T03:00:00Z") // 서울 12:00
const c = (key: string, kind: Candidate["kind"], due: string | null, at = "2026-11-27T00:00:00Z"): Candidate => ({
  key, kind, title: key, detail: "", due, at, action: { type: "link", href: `/x/${key}` },
})
const run = (over: Partial<RunLite>): RunLite => ({ id: "r1", day: "2026-11-27", source: "ai", trigger: "first_visit", candidateHash: "h", createdAt: new Date(NOW.getTime() - 3600_000), ...over })
const base = { now: NOW, hash: "h", count: 3, lastAi: null, lastAny: null, userAiToday: 0, companyAiToday: 0 }

test("서울 날짜 — 자정 넘김", () => {
  assert.equal(seoulDay(new Date("2026-11-26T15:30:00Z")), "2026-11-27")
  assert.equal(seoulDay(new Date("2026-11-26T14:59:00Z")), "2026-11-26")
  assert.equal(daysUntil("2026-11-27T14:00:00Z", NOW), 0) // 서울 23시 — 오늘
  assert.equal(daysUntil("2026-11-27T15:00:00Z", NOW), 1) // 서울 0시 — 내일
  assert.equal(dueWord("2026-11-26T03:00:00Z", NOW), "마감 1일 지남")
  assert.equal(dueWord(null, NOW), "")
})

test("해시는 열쇠 집합만 본다 — 순서 · 제목이 달라도 같다", () => {
  const a = [c("task_due:1", "task_due", null), c("mention:2", "mention", null)]
  const b = [{ ...a[1], title: "다른 제목" }, a[0]]
  assert.equal(candidateHash(a), candidateHash(b))
  assert.notEqual(candidateHash(a), candidateHash([...a, c("grant_due:3", "grant_due", null)]))
})

test("코드 순서 — 마감 가까운 순, 마감 없는 것은 뒤에 종류 · 최근 순", () => {
  const cs = [
    c("mention:old", "mention", null, "2026-11-26T00:00:00Z"),
    c("task_due:tomorrow", "task_due", "2026-11-28T09:00:00Z"),
    c("approval:a", "approval", null),
    c("task_due:today", "task_due", "2026-11-27T09:00:00Z"),
    c("mention:new", "mention", null, "2026-11-27T01:00:00Z"),
  ]
  assert.deepEqual(codeOrder(cs).map((x) => x.key), ["task_due:today", "task_due:tomorrow", "approval:a", "mention:new", "mention:old"])
  assert.equal(toItems(codeOrder([...cs, ...cs.map((x) => ({ ...x, key: x.key + "2" }))]), NOW).length, SHOW)
  assert.equal(codeLine(cs[3], NOW), "「task_due:today」 오늘 마감")
})

test("정책 — 하루 첫 접속은 AI, 같은 후보면 저장된 것", () => {
  assert.deepEqual(decide({ ...base, count: 0 }), { kind: "empty" })
  assert.deepEqual(decide(base), { kind: "ai", trigger: "first_visit" })
  // 어제 AI 실행만 있다 — 오늘 첫 접속
  assert.deepEqual(decide({ ...base, lastAi: run({ day: "2026-11-26", createdAt: new Date("2026-11-26T05:00:00Z") }) }), { kind: "ai", trigger: "first_visit" })
  const today = run({})
  assert.deepEqual(decide({ ...base, lastAi: today, lastAny: today }), { kind: "reuse", run: today })
})

test("정책 — 후보가 바뀌면 AI, 단 30분 안에는 코드 순서", () => {
  const recent = run({ createdAt: new Date(NOW.getTime() - COOLDOWN_MS + 60_000) })
  assert.deepEqual(decide({ ...base, hash: "h2", lastAi: recent, lastAny: recent }), { kind: "code", trigger: "candidates_changed", reason: "cooldown" })
  // 같은 후보로 이미 코드 순서를 만들었으면 다시 쓴다 — 열 때마다 줄이 쌓이지 않게
  const codeRun = run({ id: "r2", source: "code", candidateHash: "h2", createdAt: new Date(NOW.getTime() - 60_000) })
  assert.deepEqual(decide({ ...base, hash: "h2", lastAi: recent, lastAny: codeRun }), { kind: "reuse", run: codeRun })
  const old = run({ createdAt: new Date(NOW.getTime() - COOLDOWN_MS - 1) })
  assert.deepEqual(decide({ ...base, hash: "h2", lastAi: old, lastAny: codeRun }), { kind: "ai", trigger: "candidates_changed" })
})

test("정책 — AI 가 실패한 뒤에도 30분 안에는 다시 부르지 않는다", () => {
  const failed = run({ id: "f1", source: "code", createdAt: new Date(NOW.getTime() - 60_000) })
  // 오늘 성공한 AI 는 없다 — 첫 접속이지만, 1분 전에 부른 것이 있어 코드 순서(같은 후보면 그 실행을 다시 쓴다)
  assert.deepEqual(decide({ ...base, lastAi: null, lastAttempt: failed, lastAny: failed }), { kind: "reuse", run: failed })
  assert.deepEqual(decide({ ...base, hash: "h3", lastAi: null, lastAttempt: failed, lastAny: failed }), { kind: "code", trigger: "first_visit", reason: "cooldown" })
  const later = { ...failed, createdAt: new Date(NOW.getTime() - COOLDOWN_MS - 1) }
  assert.deepEqual(decide({ ...base, lastAi: null, lastAttempt: later, lastAny: later }), { kind: "ai", trigger: "first_visit" })
})

test("정책 — 사람당 하루 6회 · 회사 하루 50회", () => {
  const old = run({ createdAt: new Date(NOW.getTime() - 2 * COOLDOWN_MS) })
  assert.deepEqual(decide({ ...base, hash: "h2", lastAi: old, lastAny: old, userAiToday: USER_DAILY_AI }), { kind: "code", trigger: "candidates_changed", reason: "user_limit" })
  assert.deepEqual(decide({ ...base, hash: "h2", lastAi: old, lastAny: old, userAiToday: 1, companyAiToday: COMPANY_DAILY_AI }), { kind: "code", trigger: "candidates_changed", reason: "company_limit" })
  assert.deepEqual(decide({ ...base, companyAiToday: COMPANY_DAILY_AI }), { kind: "code", trigger: "first_visit", reason: "company_limit" })
})

test("AI 응답 — 순서 · 한 줄, 모르는 id 는 버리고 빠진 후보는 코드 순서로 뒤에", () => {
  const cs = [c("task_due:a", "task_due", "2026-11-27T09:00:00Z"), c("mention:b", "mention", null), c("approval:c", "approval", null)]
  const { prompt, ids } = buildPrompt(cs, NOW)
  assert.ok(prompt.includes('"id":"c1"'))
  assert.ok(prompt.includes("오늘 마감"))
  const r = parseAiOrder(JSON.stringify({ items: [{ id: "c2", line: "부른 글에 답해야 합니다" }, { id: "c9", line: "x" }, { id: "c2", line: "중복" }, { id: "c1", line: "" }] }), ids, cs)
  assert.deepEqual(r.ordered.map((x) => x.key), ["mention:b", "task_due:a", "approval:c"])
  assert.equal(r.lines.get("mention:b"), "부른 글에 답해야 합니다")
  assert.equal(r.lines.has("task_due:a"), false)
  assert.equal(toItems(r.ordered, NOW, r.lines)[1].line, "「task_due:a」 오늘 마감")
  assert.throws(() => parseAiOrder(JSON.stringify({ items: [{ id: "c9", line: "x" }] }), ids, cs))
  assert.throws(() => parseAiOrder("not json", ids, cs))
})
