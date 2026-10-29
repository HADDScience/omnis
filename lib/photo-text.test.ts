import { test } from "node:test"
import assert from "node:assert/strict"
import { maskPersonalIds, parsePhotoDescription, photoIndexText, photoPrompt } from "./photo-text"

test("주민등록번호는 가린다 — 하이픈 있든 없든", () => {
  assert.equal(maskPersonalIds("주민등록번호: 931207-2049381"), "주민등록번호: [가림]")
  assert.equal(maskPersonalIds("9312072049381"), "[가림]")
})

test("카드번호는 룬 검사를 통과할 때만 가린다", () => {
  assert.equal(maskPersonalIds("카드 4111-1111-1111-1111"), "카드 [가림]")
  assert.equal(maskPersonalIds("4111 1111 1111 1111"), "[가림]")
  // 룬 실패 16자리 — 계좌 · 관리번호일 수 있어 두고 본다
  assert.equal(maskPersonalIds("1234-5678-9012-3456"), "1234-5678-9012-3456")
})

test("업무 정보는 가리지 않는다 — 전화번호 · 계좌 · 비밀번호 · 날짜 · 금액 · 출원번호", () => {
  const keep = [
    "M. 010-7731-4098",
    "국민은행 482-910-337215",
    "PW: labstation#8842",
    "2026-10-29 14:00",
    "1,250,000원",
    "출원번호 40-2024-0123456",
    "사업자등록번호 123-45-67890",
    // 날짜로 말이 안 되는 13자리(월 13)는 주민번호가 아니다
    "9313072049381",
  ]
  for (const s of keep) assert.equal(maskPersonalIds(s), s, s)
})

test("출력 해석 — 코드블록 · 앞말이 붙어도 읽고, 깨진 JSON 은 null", () => {
  const d = parsePhotoDescription('여기 있습니다\n```json\n{"종류":"포스터","설명":"행사 포스터","검색어":["교류회"]}\n```')
  assert.equal(d?.종류, "포스터")
  assert.deepEqual(d?.검색어, ["교류회"])
  assert.equal(d?.사진속글자, "")
  assert.equal(parsePhotoDescription("{ 깨짐"), null)
  assert.equal(parsePhotoDescription('{"검색어": "문자열"}'), null)
})

test("색인 글은 빈 칸을 빼고, 가림을 글 전체에 건다", () => {
  const text = photoIndexText({
    종류: "문서", 설명: "인적사항 서류. 주민번호 931207-2049381 이 적혀 있다", 사진속글자: "", 업무: "", 검색어: ["입사 서류"],
  })
  assert.equal(text, "종류: 문서\n설명: 인적사항 서류. 주민번호 [가림] 이 적혀 있다\n검색어: 입사 서류")
})

test("프롬프트에 업무와 대화가 들어간다", () => {
  const p = photoPrompt({ task: "부스 운영", lines: ["[10-29 10:00] 김: 부스 사진", "<<이 사진>>"] })
  assert.match(p, /이 사진이 붙은 업무: 부스 운영/)
  assert.match(p, /<<이 사진>>$/)
  assert.match(photoPrompt({ task: null, lines: [] }), /업무: \(없음\)/)
})
