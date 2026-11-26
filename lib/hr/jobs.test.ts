/** 채용 공고 읽기 · 묶기 · 보드 열. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { BOARD_COLUMNS, KNOWN_JOBS, columnOf, groupJobs, loadJobs, parseJobs } from "./jobs"

const SRC = `
export const ko = {
  career: {
    form: { title: "지원서" },
    jobs: [
      {
        slug: "suwon-anchor-practicum-intern-2026-winter",
        title: "[수원대 앵커사업단x현장실습] Intern",
        closesAt: "2026-11-27T17:00:00+09:00",
        tracks: [{ value: "ai-bio", label: "AI 기반 바이오 연구" }],
      },
      {
        slug: "bio-researcher-2027",
        title: "연구원 \\"정규직\\"",
        summary: "x",
      },
    ],
  },
  columns: [{ slug: "not-a-job", title: "칼럼 [1]" }],
}`

test("parseJobs — slug · title · closesAt, 마감이 없으면 null", () => {
  const jobs = parseJobs(SRC)
  assert.deepEqual(jobs, [
    { slug: "suwon-anchor-practicum-intern-2026-winter", title: "[수원대 앵커사업단x현장실습] Intern", closesAt: "2026-11-27T17:00:00+09:00" },
    { slug: "bio-researcher-2027", title: '연구원 "정규직"', closesAt: null },
  ])
  assert.deepEqual(parseJobs("export const x = 1"), [])
})

test("loadJobs — 원문을 못 읽으면 사본", async () => {
  const fail = (async () => new Response("", { status: 500 })) as typeof fetch
  assert.deepEqual(await loadJobs(fail), KNOWN_JOBS)
  const boom = (async () => { throw new Error("offline") }) as typeof fetch
  assert.deepEqual(await loadJobs(boom), KNOWN_JOBS)
  const ok = (async () => new Response(SRC)) as typeof fetch
  assert.equal((await loadJobs(ok)).length, 2)
})

test("groupJobs — 열린 공고는 마감 이른 순, 마감된 공고는 따로, 모르는 공고는 지원서 제목으로 열린 쪽", () => {
  const now = Date.parse("2026-11-26T10:00:00+09:00")
  const g = groupJobs(
    [
      { slug: "a", title: "A", closesAt: "2026-12-10T17:00:00+09:00" },
      { slug: "b", title: "B", closesAt: "2026-11-27T17:00:00+09:00" },
      { slug: "old", title: "옛 공고", closesAt: "2026-06-01T17:00:00+09:00" },
    ],
    [{ slug: "x", title: "지원서에만 있는 공고" }, { slug: "b", title: "B 사본" }],
    now,
  )
  assert.deepEqual(g.open.map((j) => j.slug), ["b", "a", "x"])
  assert.equal(g.open.find((j) => j.slug === "x")!.title, "지원서에만 있는 공고")
  assert.deepEqual(g.closed.map((j) => j.slug), ["old"])
  // 마감 시각을 지나면 닫힌 쪽
  const later = groupJobs([{ slug: "b", title: "B", closesAt: "2026-11-27T17:00:00+09:00" }], [], Date.parse("2026-11-27T17:00:00+09:00"))
  assert.deepEqual([later.open.length, later.closed.length], [0, 1])
})

test("보드 열 — 접수 = RECEIVED·SCREENING, 서류 합격 = INTERVIEW·OFFERED, 최종 합격 = HIRED, 불합격·철회는 따로", () => {
  assert.deepEqual(["RECEIVED", "SCREENING", "INTERVIEW", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN", "RECEIVING"].map(columnOf),
    ["received", "received", "passed", "passed", "hired", "out", "out", null])
  assert.deepEqual(BOARD_COLUMNS.map((c) => c.dropTo), ["RECEIVED", "INTERVIEW", "HIRED"])
})
