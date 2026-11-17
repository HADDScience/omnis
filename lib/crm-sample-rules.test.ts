/**
 * 샘플 전달 기록 규칙(#231) — 기관 · 제품 고르기와 입력 검사. 실행: pnpm test:unit
 * 이름은 지어낸 것이다.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeOrgName, parseSampleArgs, pickOrg, pickProduct, rankOrgs, sampleRequestText } from "./crm-sample-rules"

const ORGS = [
  { id: "1", name: "가나바이오 주식회사", code: "ORG001" },
  { id: "2", name: "(주)다라메디칼", code: "ORG002" },
  { id: "3", name: "마바대학교", code: "ORG003" },
  { id: "4", name: "마바대학교 산학협력단", code: "ORG004" },
  { id: "5", name: "Saha Labs Inc.", code: "ORG005" },
]
const names = (q: string) => rankOrgs(q, ORGS).map((r) => r.org.name)

test("법인 표기 · 띄어쓰기 · 대소문자를 빼고 맞춘다", () => {
  assert.equal(normalizeOrgName("(주) 다라 메디칼"), "다라메디칼")
  assert.equal(normalizeOrgName("㈜다라메디칼"), "다라메디칼")
  assert.equal(normalizeOrgName("Saha Labs, Inc."), "sahalabs")
  // 낱말 안의 inc 는 지우지 않는다
  assert.equal(normalizeOrgName("Princeton"), "princeton")
})

test("이름 일부 · 법인 표기가 달라도 찾는다", () => {
  assert.deepEqual(names("가나바이오"), ["가나바이오 주식회사"])
  assert.deepEqual(names("다라 메디칼"), ["(주)다라메디칼"])
  assert.deepEqual(names("㈜다라메디칼"), ["(주)다라메디칼"])
  assert.deepEqual(names("saha labs"), ["Saha Labs Inc."])
  assert.deepEqual(names("org002"), ["(주)다라메디칼"])
  // 사람이 기관 뒤에 부서 · 사람을 붙여 말한다
  assert.deepEqual(names("가나바이오 연구소 홍길동 박사님"), ["가나바이오 주식회사"])
})

test("한 글자 · 엉뚱한 이름은 걸리지 않는다", () => {
  assert.deepEqual(names("가"), [])
  assert.deepEqual(names(" "), [])
  assert.deepEqual(names("하하제약"), [])
})

test("같은 이름이 하나면 고르고, 여럿 걸리면 고르지 않는다", () => {
  const exact = pickOrg(rankOrgs("마바대학교", ORGS))
  assert.equal(exact.kind, "one")
  assert.equal(exact.kind === "one" && exact.org.code, "ORG003")
  // 「마바대」 는 대학 · 산학협력단 둘 다 품는다 — 엉뚱한 쪽에 붙이지 않는다
  const many = pickOrg(rankOrgs("마바대", ORGS))
  assert.equal(many.kind, "many")
  assert.equal(many.kind === "many" && many.candidates.length, 2)
  assert.equal(pickOrg(rankOrgs("하하제약", ORGS)).kind, "none")
})

const PRODUCTS = [
  { id: "p1", name: "시험젤", spec: "1ml" },
  { id: "p2", name: "시험젤", spec: "5ml" },
  { id: "p3", name: "다른젤", spec: null },
]

test("제품은 규격까지 맞으면 고르고, 규격이 갈리면 후보를 돌려준다", () => {
  const one = pickProduct("시험젤 5ml", PRODUCTS)
  assert.equal(one.kind === "one" && one.product.id, "p2")
  const byName = pickProduct("다른젤", PRODUCTS)
  assert.equal(byName.kind === "one" && byName.product.id, "p3")
  const many = pickProduct("시험젤", PRODUCTS)
  assert.equal(many.kind, "many")
  assert.equal(pickProduct("없는젤", PRODUCTS).kind, "none")
})

const ALIASED = [
  { id: "a1", name: "가나젤 (GANA Gel)", spec: "2ml" },
  { id: "a2", name: "가나젤 (GANA Gel)", spec: "10ml" },
  { id: "b1", name: "다라젤 (DARA Gel)", spec: "3ml" },
]

test("괄호 영문 별칭이 붙은 제품도 한글 · 영문 · 전체 이름으로 고른다", () => {
  for (const q of ["가나젤 2ml", "GANA Gel 2ml", "gana gel 2ml", "가나젤 (GANA Gel) 2ml"]) {
    const r = pickProduct(q, ALIASED)
    assert.equal(r.kind === "one" && r.product.id, "a1", q)
  }
  const b = pickProduct("다라젤 3ml", ALIASED)
  assert.equal(b.kind === "one" && b.product.id, "b1")
  const bName = pickProduct("다라젤", ALIASED)
  assert.equal(bName.kind === "one" && bName.product.id, "b1")
  // 규격이 갈리면 지금처럼 후보를 돌려준다
  const many = pickProduct("GANA Gel", ALIASED)
  assert.equal(many.kind, "many")
  assert.equal(many.kind === "many" && many.candidates.length, 2)
  assert.equal(pickProduct("가나젤 5ml", ALIASED).kind, "none")
})

const NOW = new Date("2026-11-17T03:00:00Z") // 서울 2026-11-17 12:00

test("입력 검사 — 받는 것", () => {
  const r = parseSampleArgs({ org: "가나바이오", product: "시험젤 1ml", quantity: 3 }, NOW)
  assert.ok(r.ok)
  assert.equal(r.ok && r.value.date, "2026-11-17")
  assert.equal(r.ok && r.value.quantity, 3)
  assert.equal(r.ok && r.value.createOrg, false)
  assert.equal(r.ok && r.value.confirm, false)
  assert.equal(r.ok && r.value.orgType, "OTHER")
  const c = parseSampleArgs({ org: "새기관", create_org: true, org_type: "company", confirm: true, date: "2026-11-10" }, NOW)
  assert.ok(c.ok && c.value.createOrg && c.value.confirm && c.value.orgType === "COMPANY" && c.value.date === "2026-11-10")
})

test("입력 검사 — 거부하는 것", () => {
  const bad = (args: Record<string, unknown>) => {
    const r = parseSampleArgs(args, NOW)
    assert.equal(r.ok, false, JSON.stringify(args))
  }
  bad({})
  bad({ org: "  " })
  bad({ org: "가나바이오", quantity: 3 }) // 제품 없이 수량
  bad({ org: "가나바이오", product: "시험젤", quantity: 0 })
  bad({ org: "가나바이오", product: "시험젤", quantity: 1.5 })
  bad({ org: "가나바이오", product: "시험젤", quantity: 20000 })
  bad({ org: "가나바이오", date: "11/17" })
  bad({ org: "가나바이오", date: "2026-11-18" }) // 앞날
  bad({ org: "가나바이오", org_type: "SHOP" })
  // create_org · confirm 은 true 만 true — 「"true"」 글자는 동의가 아니다
  const s = parseSampleArgs({ org: "가나바이오", create_org: "true", confirm: "yes" }, NOW)
  assert.ok(s.ok && !s.value.createOrg && !s.value.confirm)
})

test("요청사항 — 준 말이 먼저, 없으면 제품 · 수량", () => {
  assert.equal(sampleRequestText({ content: "카탈로그 함께" }, PRODUCTS[0], 2), "카탈로그 함께")
  assert.equal(sampleRequestText({ content: null }, PRODUCTS[0], 2), "시험젤 1ml 2개 샘플 전달")
  assert.equal(sampleRequestText({ content: null }, null, null), "샘플 전달")
})
