import { test } from "node:test"
import assert from "node:assert/strict"
import { kakaoMissingAttachment, missingAttachmentLabel, missingAttachmentRest, missingAttachmentToolNote } from "./kakao-placeholder"

const kakao = (content: string, files: unknown[] = []) => ({ sourceId: "kakao:abc123", content, files })

test("자리표시 네 꼴을 가른다", () => {
  assert.deepEqual(kakaoMissingAttachment(kakao("Photo")), { kind: "photo", count: 1, deleted: false })
  assert.deepEqual(kakaoMissingAttachment(kakao("3 photos")), { kind: "photo", count: 3, deleted: false })
  assert.deepEqual(kakaoMissingAttachment(kakao("Video")), { kind: "video", deleted: false })
  assert.deepEqual(kakaoMissingAttachment(kakao("File: 보고서 v2 (최종).pdf")), { kind: "file", name: "보고서 v2 (최종).pdf", deleted: false })
  // 앞뒤 빈칸 · 줄바꿈은 본다
  assert.deepEqual(kakaoMissingAttachment(kakao("  Photo\r\n")), { kind: "photo", count: 1, deleted: false })
})

test("삭제 표시가 붙은 글 — 다음 줄이든 같은 줄 뒤든", () => {
  assert.deepEqual(kakaoMissingAttachment(kakao("Photo\nThe message has been deleted.")), { kind: "photo", count: 1, deleted: true })
  assert.deepEqual(kakaoMissingAttachment(kakao("2 photos The message has been deleted.")), { kind: "photo", count: 2, deleted: true })
  assert.deepEqual(
    kakaoMissingAttachment(kakao("File: 견적서.xlsx The message has been deleted.")),
    { kind: "file", name: "견적서.xlsx", deleted: true },
  )
  // 삭제 표시만 있는 글은 첨부가 아니다
  assert.equal(kakaoMissingAttachment(kakao("The message has been deleted.")), null)
})

test("카톡에서 온 글이 아니거나 첨부가 붙었으면 그리지 않는다", () => {
  assert.equal(kakaoMissingAttachment({ sourceId: null, content: "Photo", files: [] }), null)
  assert.equal(kakaoMissingAttachment({ content: "Photo" }), null)
  assert.equal(kakaoMissingAttachment({ sourceId: "mcp:1", content: "Photo", files: [] }), null)
  assert.equal(kakaoMissingAttachment(kakao("Photo", [{ id: "f1" }])), null)
  assert.equal(kakaoMissingAttachment(kakao("File: a.pdf", [{ id: "f1" }])), null)
})

test("이모티콘 · 통화 · 사람이 쓴 글은 글 그대로", () => {
  for (const s of [
    "Emoticon",
    "Voice Call",
    "KakaoTalk Profile",
    "Photo 다시 보내주세요",
    "Photos",
    "0 photos",
    "사진",
    "File:",
    "File:   ",
    "3 photos 보냈어요",
    "보내드립니다\nFile: 견적서.xlsx",
    "Photo\nPhoto",
    "",
  ]) {
    assert.equal(kakaoMissingAttachment(kakao(s)), null, s)
  }
})

test("칸 이름과 남길 본문", () => {
  assert.equal(missingAttachmentLabel({ kind: "photo", count: 1, deleted: false }), "사진")
  assert.equal(missingAttachmentLabel({ kind: "photo", count: 3, deleted: false }), "사진 3장")
  assert.equal(missingAttachmentLabel({ kind: "video", deleted: false }), "동영상")
  assert.equal(missingAttachmentLabel({ kind: "file", name: "a.pdf", deleted: false }), "a.pdf")
  assert.equal(missingAttachmentRest({ kind: "photo", count: 1, deleted: false }), "")
  assert.equal(missingAttachmentRest({ kind: "video", deleted: true }), "The message has been deleted.")
})

test("도구 결과의 자리표시 표시 — 파일은 이름째, 열 수 없다 · 누구에게 요청할지", () => {
  const note = missingAttachmentToolNote({ kind: "file", name: "P1_발표.pdf", deleted: false })
  assert.match(note, /^\[첨부 없음 — 「P1_발표\.pdf」 파일은 .*옴니스에 원본이 없다\. 열기 · 내려받기 불가\. 카톡 원본이나 보낸 사람에게 요청해야 한다\]$/)
  assert.match(missingAttachmentToolNote({ kind: "photo", count: 3, deleted: false }), /^\[첨부 없음 — 사진 3장은 /)
})
