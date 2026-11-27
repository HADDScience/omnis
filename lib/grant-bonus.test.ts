/** 공고 가점 ↔ 우리 인증. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  bonusExcerpt,
  bonusMatchText,
  certKeysOf,
  keyOfCert,
  matchBonus,
  parseBonusOutput,
  pointsLabel,
  quoteFound,
  readableQuote,
  readableSource,
  stateOf,
  type BonusItem,
  type OurCert,
} from "./grant-bonus"

const REF = new Date("2026-12-10T00:00:00+09:00")

const cert = (name: string, status: OurCert["status"], validUntil: string | null = null, officialName: string | null = null): OurCert => ({
  id: name,
  name,
  officialName,
  status,
  validUntil,
})

const item = (label: string, points: number | null, extra: Partial<BonusItem> = {}): BonusItem => ({
  label,
  points,
  pointsText: points === null ? null : `${points}점`,
  condition: null,
  quote: `${label} ${points ?? ""}점`,
  source: "본문",
  ...extra,
})

test("이름이 다른 같은 인증을 같은 키로 — 벤처기업 확인 = 벤처인증 = 벤처확인기업", () => {
  for (const s of ["벤처기업 확인", "벤처인증 보유기업", "벤처확인기업", "벤처기업"]) assert.deepEqual(certKeysOf(s), ["venture"], s)
  assert.deepEqual(certKeysOf("기업부설연구소 보유"), ["rnd_dept"])
  assert.deepEqual(certKeysOf("연구개발전담부서 인정"), ["rnd_dept"])
  assert.deepEqual(certKeysOf("INNO-BIZ"), ["innobiz"])
  assert.deepEqual(certKeysOf("경영혁신형 중소기업(Main-Biz)"), ["mainbiz"])
  assert.deepEqual(certKeysOf("일자리 으뜸기업"), ["job_creation"])
})

test("한 항목이 여러 인증을 묶으면 키가 여럿 — 좁은 이름이 넓은 이름에 또 걸리지 않는다", () => {
  assert.deepEqual(certKeysOf("벤처기업, 이노비즈, 메인비즈 인증 기업"), ["venture", "innobiz", "mainbiz"])
  assert.deepEqual(certKeysOf("경기도 가족친화 일하기 좋은 기업"), ["gg_family"])
  assert.deepEqual(certKeysOf("가족친화인증 기업"), ["family"])
  assert.deepEqual(certKeysOf("비수도권 공장 보유"), ["non_capital_factory"])
  assert.deepEqual(certKeysOf("여성기업종합지원센터 입주"), [])
  assert.deepEqual(certKeysOf("벤처캐피탈 투자 유치 · 소셜벤처"), [])
  assert.deepEqual(certKeysOf("벤처·이노비즈"), ["venture", "innobiz"])
  // 2026-11-27 표본에서 나온 것 — 부처 이름 · 시설 이름은 벤처기업 확인이 아니고, 우수기업부설연구소는 연구소 인정과 다르다
  assert.deepEqual(certKeysOf("창업보육센터(중소벤처기업부 및 시/군 지정) 또는 벤처집적시설 입주기업"), [])
  assert.deepEqual(certKeysOf("우수기업부설연구소가 소속된 기업"), ["rnd_excellent"])
})

test("우리 인증의 키는 이름 먼저 — 긴 공식 이름에 섞인 다른 제도 이름으로 잇지 않는다", () => {
  assert.equal(keyOfCert({ name: "벤처기업 확인", officialName: "벤처기업 확인 (혁신성장유형 보유)" }), "venture")
  assert.equal(
    keyOfCert({ name: "바이오헬스 혁신기업", officialName: "가까운 제도: ① 혁신형 의료기기기업 인증 ② 혁신형 제약기업 인증" }),
    "med_device"
  )
  assert.equal(keyOfCert({ name: "고용창출우수기업", officialName: "대한민국 일자리 으뜸기업" }), "job_creation")
})

test("우리 상태 — 보유 · 유효기간 안 · 만료 · 없음(기준일은 공고 마감)", () => {
  assert.deepEqual(stateOf(cert("a", "HELD"), REF), { state: "held", note: null })
  assert.deepEqual(stateOf(cert("a", "HELD", "2027-03-01T00:00:00+09:00"), REF), { state: "valid", note: "~ 2027-03-01" })
  assert.deepEqual(stateOf(cert("a", "HELD", "2026-12-10T00:00:00+09:00"), REF).state, "valid")
  assert.deepEqual(stateOf(cert("a", "HELD", "2026-12-09T00:00:00+09:00"), REF), { state: "expired", note: "2026-12-09 만료" })
  assert.equal(stateOf(cert("a", "RENEWAL_DUE"), REF).note, "갱신 필요")
  assert.deepEqual(stateOf(cert("a", "CANDIDATE"), REF), { state: "none", note: "취득 후보" })
  assert.equal(stateOf(cert("a", "NOT_ELIGIBLE"), REF).state, "none")
})

test("표와 예상 가점 — 보유 · 유효만 더하고 상한을 넘지 않는다", () => {
  const certs = [
    cert("벤처기업 확인", "HELD", "2027-05-01T00:00:00+09:00"),
    cert("여성기업 확인", "HELD"),
    cert("이노비즈 (INNO-BIZ)", "NOT_ELIGIBLE"),
    cert("가족친화인증", "CANDIDATE"),
  ]
  const m = matchBonus(
    [
      item("벤처인증 기업", 2),
      item("여성기업", 1),
      item("이노비즈 인증 기업", 1),
      item("가족친화 인증기업", 0.5),
      item("장애인기업", 1),
    ],
    null,
    certs,
    REF
  )
  assert.deepEqual(
    m.rows.map((r) => [r.state, r.cert, r.counted]),
    [
      ["valid", "벤처기업 확인", true],
      ["held", "여성기업 확인", true],
      ["none", "이노비즈 (INNO-BIZ)", false],
      ["none", "가족친화인증", false],
      ["none", null, false],
    ]
  )
  assert.equal(m.expected, 3)
  assert.equal(m.possible, 5.5)
  const capped = matchBonus([item("벤처인증 기업", 2), item("여성기업", 1)], { points: 2, text: "최대 2점", quote: "가점은 최대 2점" }, certs, REF)
  assert.equal(capped.expected, 2)
  assert.equal(capped.possible, 2)
})

test("여러 인증을 묶은 항목은 가장 나은 우리 상태 · 점수 모르는 항목은 더하지 않는다", () => {
  const m = matchBonus(
    [item("벤처 · 이노비즈 · 메인비즈 중 하나", 1), item("여성기업", null)],
    null,
    [cert("이노비즈", "NOT_ELIGIBLE"), cert("벤처기업 확인", "HELD"), cert("여성기업 확인", "HELD")],
    REF
  )
  assert.equal(m.rows[0].state, "held")
  assert.equal(m.rows[0].cert, "벤처기업 확인")
  assert.equal(m.rows[1].counted, false)
  assert.equal(m.expected, 1)
  assert.equal(m.unknownPoints, true)
})

test("가점 문맥만 자르고 출처 머리를 단다 · 없으면 빈 글", () => {
  const body = "가".repeat(3000) + " 벤처기업 가점 1점 " + "나".repeat(3000)
  const ex = bonusExcerpt([
    { source: "본문", text: "가점 이야기는 없습니다" + "다".repeat(100) },
    { source: "첨부: 공고문.hwp", text: body },
  ])
  assert.ok(ex.startsWith("[[본문]]"))
  assert.ok(ex.includes("[[첨부: 공고문.hwp]]"))
  assert.ok(ex.includes("벤처기업 가점 1점"))
  assert.ok(ex.length < 2_500)
  assert.equal(bonusExcerpt([{ source: "본문", text: "지원 대상 안내" }]), "")
  assert.ok(bonusExcerpt([{ source: "본문", text: ("가점 " + "x".repeat(2000)).repeat(20) }], 3_000).length <= 3_000)
})

test("근거 문장은 표 기호 · 태그 · 공백이 달라도 원문에서 찾는다 · 없으면 못 찾는다", () => {
  const src = "<tr><td>벤처기업</td><td>**1점**</td></tr> ⏎ ㅇ 여성기업 확인서 보유 기업 : 0.5점"
  assert.ok(quoteFound("벤처기업 1점", src))
  assert.ok(quoteFound("여성기업 확인서 보유 기업: 0.5점", src))
  assert.ok(quoteFound("벤처기업 … 여성기업 확인서", src))
  assert.equal(quoteFound("이노비즈 인증 1점", src), false)
  assert.equal(quoteFound("벤", src), false)
})

test("모델 출력 읽기 — 원문에 없는 근거는 버리고 점수 글에서 숫자를 읽는다", () => {
  const excerpt = "□ 가점: 벤처기업 확인 기업 2점, 여성기업 1점 ※ 가점은 최대 3점까지 인정"
  const raw =
    "```json\n" +
    JSON.stringify({
      items: [
        { label: "벤처기업 확인 기업", points: "2점", points_text: "2점", quote: "벤처기업 확인 기업 2점", source: "본문" },
        { label: "여성기업", points: 1, quote: "여성기업 1점" },
        { label: "이노비즈", points: 1, quote: "이노비즈 1점" },
        { label: "", points: 1, quote: "여성기업 1점" },
      ],
      cap: { points: 3, text: "최대 3점", quote: "가점은 최대 3점까지 인정" },
    }) +
    "\n```"
  const r = parseBonusOutput(raw, excerpt)!
  assert.deepEqual(r.items.map((x) => [x.label, x.points]), [["벤처기업 확인 기업", 2], ["여성기업", 1]])
  assert.equal(r.dropped, 2)
  assert.deepEqual(r.cap, { points: 3, text: "최대 3점", quote: "가점은 최대 3점까지 인정" })
  assert.equal(parseBonusOutput("모르겠습니다", excerpt), null)
  assert.deepEqual(parseBonusOutput('{"items":[],"cap":null}', excerpt), { items: [], cap: null, dropped: 0 })
})

test("도구용 글 표 — 머리 줄에 예상 · 최대, 칸의 | 는 바꾼다", () => {
  const m = matchBonus([item("벤처기업|확인", 2)], null, [cert("벤처기업 확인", "HELD")], REF)
  const t = bonusMatchText("가 공고", m)
  assert.ok(t.startsWith("가 공고 — 가점 1개 · 예상 2점 / 최대 2점"))
  assert.ok(t.includes("| 벤처기업/확인 | 2점 | 보유 · 벤처기업 확인 |"))
  assert.equal(bonusMatchText("나 공고", matchBonus([], null, [], REF)), "나 공고 — 인증 · 자격 가점 항목이 없습니다.")
})

test("보여 줄 근거 — 표 태그는 「 · 」, 강조 · 줄바꿈은 걷고 출처 괄호를 뗀다", () => {
  assert.equal(readableQuote("경기대진TP 입주기업</td><td>여</td><td>2"), "경기대진TP 입주기업 · 여 · 2")
  assert.equal(readableQuote("**- 벤처기업<br>우대**  \n 1점"), "- 벤처기업 우대 1점")
  assert.equal(readableQuote("<tr><td>가점</td></tr>"), "가점")
  assert.equal(readableSource("[[첨부: 공고문.hwp]]"), "첨부: 공고문.hwp")
  assert.equal(readableSource(null), null)
})

test("점수 칸 — 숫자만 있으면 「점」 을 붙이고, 원문이 없으면 숫자, 둘 다 없으면 —", () => {
  assert.equal(pointsLabel({ points: 2, pointsText: "2" }), "2점")
  assert.equal(pointsLabel({ points: 3, pointsText: "가점 최대3" }), "가점 최대3")
  assert.equal(pointsLabel({ points: 2, pointsText: "2<br>(배점한도)" }), "2 (배점한도)")
  assert.equal(pointsLabel({ points: 1.5, pointsText: null }), "1.5점")
  assert.equal(pointsLabel({ points: null, pointsText: null }), "—")
})
