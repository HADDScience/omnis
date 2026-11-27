/** 국가과제 검색 규칙. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { likePattern, matchesAll, searchTerms, squashForSearch } from "./grants-search"

test("찾는 말 → 낱말 — 공백으로 나누고 소문자 · 중복 없이 · 최대 8개", () => {
  assert.deepEqual(searchTerms("  벤처   확인 "), ["벤처", "확인"])
  assert.deepEqual(searchTerms("TIPS tips 팁스"), ["tips", "팁스"])
  assert.deepEqual(searchTerms(""), [])
  assert.deepEqual(searchTerms(null), [])
  assert.equal(searchTerms("a b c d e f g h i j").length, 8)
  assert.equal(searchTerms("가".repeat(80))[0].length, 50)
})

test("한글 자모가 나뉜 글(NFD)도 같은 낱말로 본다", () => {
  const nfd = "벤처".normalize("NFD")
  assert.deepEqual(searchTerms(nfd), ["벤처"])
  assert.equal(squashForSearch(`${nfd} 기업`), "벤처기업")
})

test("LIKE 패턴 — % _ \\ 는 글자 그대로", () => {
  assert.equal(likePattern("벤처"), "%벤처%")
  assert.equal(likePattern("10%"), "%10\\%%")
  assert.equal(likePattern("a_b"), "%a\\_b%")
  assert.equal(likePattern("c:\\x"), "%c:\\\\x%")
})

test("띄어쓰기 무시 · 부분 일치 · 여러 낱말은 모두(AND)", () => {
  const hay = "2026년 IP투자연계 지식재산 평가 지원사업 · 한국발명진흥회 · 벤처기업"
  assert.ok(matchesAll(hay, searchTerms("지식재산평가")))
  assert.ok(matchesAll(hay, searchTerms("투자 발명")))
  assert.ok(matchesAll(hay, searchTerms("ip투자")))
  assert.equal(matchesAll(hay, searchTerms("벤처 이노비즈")), false)
  assert.ok(matchesAll(hay, []))
})
