// 채용 지원서 규칙 — 검사 · 조각 · 티켓 · 보관 기한. 통과 사례와 거부 사례를 함께 둔다. 실행: pnpm test:unit
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  APPLICATION_FILE_MAX_BYTES,
  PART_BYTES,
  addMonths,
  allowedOrigins,
  applicationIntakeSchema,
  kstDay,
  looksLikePdf,
  nextApplicationCode,
  partCount,
  partProblem,
  purgeDeadline,
  secretMatches,
  signTicket,
  verifyTicket,
} from "./rules"

const valid = {
  job: "suwon-anchor-practicum-intern-2026-winter",
  jobTitle: "[수원대 앵커사업단x현장실습] Intern",
  lang: "ko",
  name: "시험 지원자",
  department: "데이터과학부",
  studentId: "20231234",
  grade: "3",
  graduation: "2028년 2월",
  phone: "010-0000-0000",
  email: "Applicant@Example.com",
  portfolioUrl: "",
  motivation: "해 보고 싶습니다.",
  consent: true,
  consentVersion: "career-consent-2026-11-24",
  resume: { name: "이력서.pdf", size: 812_345, type: "application/pdf" },
  portfolioFile: null,
}

test("지원서 — 홈페이지 폼과 같은 칸이면 통과한다", () => {
  const r = applicationIntakeSchema.safeParse(valid)
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal(r.data.lang, "ko")
    assert.equal(r.data.portfolioFile, null)
  }
})

test("지원서 — 동의 없음 · 학번 글자 · PDF 아님 · 10MB 넘음 · 잘못된 링크 · 이상한 공고는 거절한다", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["consent", { consent: false }],
    ["studentId", { studentId: "2023A" }],
    ["resume", { resume: { name: "이력서.docx", size: 100, type: "" } }],
    ["resume", { resume: { name: "이력서.pdf", size: APPLICATION_FILE_MAX_BYTES + 1, type: "application/pdf" } }],
    ["portfolioUrl", { portfolioUrl: "javascript:alert(1)" }],
    ["job", { job: "../etc/passwd" }],
    ["email", { email: "not-an-email" }],
    ["motivation", { motivation: "가".repeat(1501) }],
    ["consentVersion", { consentVersion: "" }],
  ]
  for (const [field, patch] of bad) {
    const r = applicationIntakeSchema.safeParse({ ...valid, ...patch })
    assert.equal(r.success, false, `${field} 가 통과했다`)
    if (!r.success) assert.ok(r.error.issues.some((i) => i.path[0] === field), `${field} 오류가 아니다: ${r.error.issues.map((i) => i.path.join(".")).join(",")}`)
  }
})

test("조각 — 10MB 는 3조각, 차례로만 받고 다시 보낸 조각은 받는다", () => {
  const size = 10 * 1024 * 1024
  assert.equal(partCount(size), 3)
  assert.equal(partCount(1), 1)
  assert.ok(PART_BYTES < 4.5 * 1024 * 1024 - 64 * 1024, "조각이 함수 본문 한도에 너무 가깝다")
  assert.equal(partProblem({ part: 0, bodyBytes: PART_BYTES, size, receivedBytes: 0 }), null)
  assert.equal(partProblem({ part: 1, bodyBytes: PART_BYTES, size, receivedBytes: PART_BYTES }), null)
  assert.equal(partProblem({ part: 0, bodyBytes: PART_BYTES, size, receivedBytes: PART_BYTES }), null, "재전송")
  assert.equal(partProblem({ part: 2, bodyBytes: size - 2 * PART_BYTES, size, receivedBytes: 2 * PART_BYTES }), null, "마지막 조각")
  // 거부
  assert.match(partProblem({ part: 1, bodyBytes: PART_BYTES, size, receivedBytes: 0 }) ?? "", /앞 조각/)
  assert.match(partProblem({ part: 3, bodyBytes: 1, size, receivedBytes: size }) ?? "", /범위/)
  assert.match(partProblem({ part: -1, bodyBytes: 1, size, receivedBytes: 0 }) ?? "", /범위/)
  assert.match(partProblem({ part: Number.NaN, bodyBytes: 1, size, receivedBytes: 0 }) ?? "", /범위/)
  assert.match(partProblem({ part: 0, bodyBytes: PART_BYTES - 1, size, receivedBytes: 0 }) ?? "", /크기/)
  assert.match(partProblem({ part: 2, bodyBytes: PART_BYTES, size, receivedBytes: 2 * PART_BYTES }) ?? "", /크기/)
})

test("PDF 머리 — %PDF 만 받는다", () => {
  assert.equal(looksLikePdf(Buffer.from("%PDF-1.7\n")), true)
  assert.equal(looksLikePdf(Buffer.from("PK\u0003\u0004")), false)
  assert.equal(looksLikePdf(Buffer.from("%PD")), false)
})

test("티켓 — 같은 지원서 · 같은 칸 · 만료 전에만 맞다", () => {
  const key = "k1"
  const now = 1_000_000
  const t = signTicket({ applicationId: "a1", slot: "resume", size: 10, expiresAt: now + 1000 }, key)
  assert.deepEqual(verifyTicket(t, { applicationId: "a1", slot: "resume" }, key, now), { ok: true, size: 10 })
  // 거부
  assert.equal(verifyTicket(t, { applicationId: "a2", slot: "resume" }, key, now).ok, false, "다른 지원서")
  assert.equal(verifyTicket(t, { applicationId: "a1", slot: "portfolio" }, key, now).ok, false, "다른 칸")
  assert.equal(verifyTicket(t, { applicationId: "a1", slot: "resume" }, "other", now).ok, false, "다른 키")
  assert.equal(verifyTicket(t, { applicationId: "a1", slot: "resume" }, key, now + 1000).ok, false, "만료")
  const [payload, mac] = t.split(".")
  const forged = Buffer.from(JSON.stringify({ a: "a1", s: "resume", z: 10, e: now + 10_000_000 })).toString("base64url")
  assert.equal(verifyTicket(`${forged}.${mac}`, { applicationId: "a1", slot: "resume" }, key, now).ok, false, "만료를 늘린 위조")
  assert.equal(verifyTicket(`${payload}`, { applicationId: "a1", slot: "resume" }, key, now).ok, false, "서명 없음")
  assert.equal(verifyTicket(`${payload}.${mac}.x`, { applicationId: "a1", slot: "resume" }, key, now).ok, false, "덧붙임")
})

test("비밀 대조 — 길이가 달라도 던지지 않는다", () => {
  assert.equal(secretMatches("abc", "abc"), true)
  assert.equal(secretMatches("abcd", "abc"), false)
  assert.equal(secretMatches("", "abc"), false)
})

test("오리진 — 기본은 홈페이지 운영 주소 둘, env 가 있으면 그것만", () => {
  assert.deepEqual(allowedOrigins(undefined), ["https://haddscience.com", "https://www.haddscience.com"])
  assert.deepEqual(allowedOrigins(" http://localhost:3000/ , "), ["http://localhost:3000"])
})

test("접수 번호 — 서울 날짜 · 그날 다음 번호", () => {
  // 2026-11-24 15:30 UTC = 11-25 00:30 KST
  assert.equal(kstDay(new Date("2026-11-24T15:30:00Z")), "261125")
  assert.equal(nextApplicationCode("261124", []), "APP261124-001")
  assert.equal(nextApplicationCode("261124", ["APP261124-001", "APP261124-007", "APP261123-020", null]), "APP261124-008")
})

test("보관 기한 — 선발 종료 + 6개월, 누르지 않았으면 접수 + 12개월, 접수 전이면 없음", () => {
  const received = new Date("2026-11-27T08:00:00Z")
  const ended = new Date("2026-12-03T00:00:00Z")
  assert.equal(purgeDeadline({ selectionEndedAt: null, receivedAt: received, purgeAfter: null })?.toISOString(), "2027-11-27T08:00:00.000Z")
  assert.equal(purgeDeadline({ selectionEndedAt: ended, receivedAt: received, purgeAfter: null })?.toISOString(), "2027-06-03T00:00:00.000Z")
  assert.equal(purgeDeadline({ selectionEndedAt: null, receivedAt: null, purgeAfter: null }), null)
  assert.equal(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10), "2026-03-03", "달 끝은 넘친다(보관이 짧아지지 않는 쪽)")
})
