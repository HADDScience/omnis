import test from "node:test"
import assert from "node:assert/strict"
import { photoIndexText } from "@/lib/photo-text"
import { photoSearchText } from "@/lib/chat-search-photo"

test("라벨과 종류 · 용도는 검색 대상에서 빠지고 설명 · 사진 속 글자 · 검색어 값만 남는다", () => {
  const description = photoIndexText({ 종류: "포스터", 설명: "부스 앞 안내판", 사진속글자: "입장 안내\n둘째 줄", 업무: "행사 준비", 검색어: ["부스", "안내판"] })
  assert.equal(photoSearchText(description), "부스 앞 안내판\n입장 안내\n둘째 줄\n부스, 안내판")
})

test("값 안의 같은 글자는 지우지 않는다", () => {
  assert.equal(photoSearchText("설명: 사진 속 글자: 가 적힌 판"), "사진 속 글자: 가 적힌 판")
})
