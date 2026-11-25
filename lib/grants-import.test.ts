/** 인증 · 과제 결정 이식 변환. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  certRow,
  certStatus,
  decisionRow,
  grantStage,
  matchMilestone,
} from "./grants-import"

test("인증 상태 — 보유 · 미충족 · 나머지는 후보", () => {
  assert.equal(certStatus({ key: "a", name: "a", held: true }), "HELD")
  assert.equal(
    certStatus({
      key: "a",
      name: "a",
      held: null,
      research: { our_status: "보유" },
    }),
    "HELD"
  )
  assert.equal(
    certStatus({ key: "a", name: "a", research: { our_status: "미충족" } }),
    "NOT_ELIGIBLE"
  )
  assert.equal(
    certStatus({ key: "a", name: "a", research: { our_status: "확인 필요" } }),
    "CANDIDATE"
  )
  assert.equal(
    certStatus({ key: "a", name: "a", research: { our_status: "충족" } }),
    "CANDIDATE"
  )
})

test("단계 6개 — 모르는 단계는 던진다", () => {
  assert.deepEqual(
    ["검토", "준비", "제출", "선정", "미선정", "불참"].map(grantStage),
    ["REVIEW", "PREPARING", "SUBMITTED", "SELECTED", "REJECTED", "DROPPED"]
  )
  assert.throws(() => grantStage("보류"))
})

test("행 변환 — 빈 문자열은 null, 공고 연결이 없으면 null", () => {
  const c = certRow(
    { key: "cert:x", name: "X", issuer: "", bonus_mss: "+1점" },
    new Date(0)
  )
  assert.equal(c.issuer, null)
  assert.equal(c.researchedAt, null)
  assert.deepEqual(c.bonus, { medibio: null, mss: "+1점", examples: null })
  assert.equal(
    decisionRow({
      key: "notion:1",
      title: "T",
      stage: "불참",
      notice_links: [],
    }).noticeLinks,
    undefined
  )
})

test("연혁 잇기 — 하나만 맞을 때만", () => {
  const recs = [
    { id: "r1", title: "여성기업인증 획득" },
    { id: "r2", title: "벤처기업인증(혁신성장형)" },
    { id: "r3", title: "벤처기업 지원사업 선정" },
  ]
  assert.equal(matchMilestone("여성기업 확인", recs), "r1")
  assert.equal(matchMilestone("벤처기업", recs), "r2")
  assert.equal(matchMilestone("이노비즈", recs), null)
})

test("공고 — 사람이 읽은 판정이 있으면 그것, 없으면 규칙 판정 · 상세 주소를 먼저", async () => {
  const { noticeRow } = await import("./grants-import")
  const base = {
    key: "notice:x:1",
    title: "T",
    members: [
      { url: "https://a/list", url_kind: "list" },
      { url: "https://a/detail", url_kind: "detail" },
    ],
    deadline_at: "2026-11-26T23:59:59+09:00",
    index: { region_class: "national", region_detail: ["전국"] },
    judgements: {
      rules: { sole: { verdict: "애매" }, corp: { verdict: "해당" } },
    },
  }
  const r = noticeRow(base)
  assert.equal(r.url, "https://a/detail")
  assert.equal(r.verdictSole, "애매")
  assert.equal(r.judgedBy, "rules")
  assert.equal(r.deadlineAt?.toISOString(), "2026-11-26T14:59:59.000Z")
  const l = noticeRow({
    ...base,
    judgements: {
      ...base.judgements,
      llm: { sole: { verdict: "비해당", reasons: [{ claim: "c" }] } },
    },
  })
  assert.equal(l.verdictSole, "비해당")
  assert.equal(l.judgedBy, "llm")
  assert.deepEqual(l.reasonsSole, [{ claim: "c", quote: "" }])
})
