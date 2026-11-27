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
    "STOPPED"
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

test("단계 — 옛 이름(검토 → 준비, 불참 → 중단)과 새 이름표 둘 다, 모르는 단계는 던진다", () => {
  assert.deepEqual(
    ["검토", "준비", "제출", "선정", "미선정", "불참"].map(grantStage),
    ["PREPARING", "PREPARING", "SUBMITTED", "SELECTED", "REJECTED", "STOPPED"]
  )
  assert.deepEqual(
    ["제출 완료", "선정됨", "수행 중", "완료", "중단"].map(grantStage),
    ["SUBMITTED", "SELECTED", "IN_PROGRESS", "COMPLETED", "STOPPED"]
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

test("공고 첨부 — 형식은 파일 이름 끝, 기업마당은 공고 페이지를 같이, 같은 이름은 하나", async () => {
  const { noticeAttachments } = await import("./grants-import")
  const item = {
    key: "notice:bizinfo:1",
    title: "T",
    members: [
      {
        source: "bizinfo",
        url: "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=P1",
        url_kind: "detail",
      },
    ],
    attachments: [
      {
        name: "(공고문)신청.hwpx",
        url: "https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=F1&fileSn=0",
        type: null,
      },
      {
        name: "(공고문)신청.hwpx",
        url: "https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=F1&fileSn=0",
        type: null,
      },
      {
        name: "RFP",
        url: "https://www.iris.go.kr/comm/file/fileDownload.do?x=1",
        type: "pdf",
      },
    ],
  }
  const r = noticeAttachments(
    item,
    new Map([["https://www.iris.go.kr/comm/file/fileDownload.do?x=1", 1234]])
  ) as unknown as {
    name: string
    type: string
    size: number | null
    page?: string
  }[]
  assert.equal(r.length, 2)
  assert.equal(r[0].type, "hwpx")
  assert.equal(
    r[0].page,
    "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=P1"
  )
  assert.equal(r[1].type, "pdf")
  assert.equal(r[1].size, 1234)
  assert.equal(r[1].page, undefined)
})
