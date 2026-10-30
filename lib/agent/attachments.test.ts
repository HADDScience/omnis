/**
 * 옴니스 질문 첨부 — 모델에 넣는 모양 · 자르기 · 비밀 가리기 · 입력 검증. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ATTACH_IMAGE_MAX,
  ATTACH_TEXT_PER_FILE,
  ATTACH_TEXT_TOTAL,
  attachmentKind,
  historyWithAttachmentNames,
  prepareAttachmentText,
  questionWithAttachments,
  type ReadAttachment,
} from "./attachments"
import { AgentTurnSchema, StartAgentRoomSchema } from "@/lib/schemas/agent"

const UUID = "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f"
const UUID2 = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d"

test("형식 가르기 — 이미지 · PDF · 엑셀 · 텍스트 · 그 밖", () => {
  assert.equal(attachmentKind("표.png", "image/png"), "image")
  assert.equal(attachmentKind("scan.JPG", "application/octet-stream"), "image")
  assert.equal(attachmentKind("계약.pdf", "application/pdf"), "pdf")
  assert.equal(attachmentKind("재고.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "sheet")
  assert.equal(attachmentKind("memo.md", ""), "text")
  assert.equal(attachmentKind("data.csv", "text/csv; charset=utf-8"), "text")
  assert.equal(attachmentKind("보고서.hwp", "application/x-hwp"), "other")
})

test("자르기 — 상한을 넘으면 앞부분만, 넘지 않으면 그대로", () => {
  const short = prepareAttachmentText("짧은 글", 100)
  assert.deepEqual(short, { text: "짧은 글", chars: 4, clipped: false, redacted: 0 })
  const long = prepareAttachmentText("가".repeat(500), 100)
  assert.equal(long.text.length, 100)
  assert.equal(long.clipped, true)
  assert.equal(long.chars, 500)
})

test("비밀 가리기 — 비밀번호 · API 키 · 주민번호 값은 모델에 가지 않는다", () => {
  const raw = "공용 PC 비밀번호: hadd1234!\nOPENAI 키 sk-proj-abcdefghijklmnopqrstuvwxyz123456\n주민번호 900101-1234567"
  const p = prepareAttachmentText(raw, 10_000)
  assert.ok(p.redacted >= 3, `가린 수 ${p.redacted}`)
  assert.ok(!p.text.includes("hadd1234!"))
  assert.ok(!p.text.includes("abcdefghijklmnopqrstuvwxyz123456"))
  assert.ok(!p.text.includes("900101-1234567"))
})

test("비밀 가리기는 자르기 전에 — 잘린 자리에 걸친 값도 원문이 남지 않는다", () => {
  const raw = `${"가".repeat(30)} 비밀번호: hadd1234!`
  const p = prepareAttachmentText(raw, 38)
  assert.ok(!p.text.includes("hadd1234"), p.text)
})

test("걸지 말아야 하는 것 — 날짜 · 금액 · 전화는 그대로", () => {
  const raw = "2026-10-30 견적 1,250,000원 담당 010-1234-5678"
  assert.deepEqual(prepareAttachmentText(raw, 1000), { text: raw, chars: raw.length, clipped: false, redacted: 0 })
})

test("질문 + 첨부 — 글 파일은 구분선 안에, 이미지는 file part 로", () => {
  const files: ReadAttachment[] = [
    { name: "표.png", kind: "image", image: { base64: "AAAA", mediaType: "image/jpeg" } },
    { name: "memo.txt", kind: "text", raw: "회의록 본문" },
  ]
  const q = questionWithAttachments("이 파일 내용 요약해 줘", files)
  assert.deepEqual(q.images, [{ type: "file", mediaType: "image/jpeg", data: "AAAA" }])
  assert.ok(q.text.startsWith("이 파일 내용 요약해 줘\n"))
  assert.ok(q.text.includes("[첨부 1] 표.png"))
  assert.ok(q.text.includes("<<<첨부 2\n회의록 본문\n첨부 2>>>"))
})

test("첨부가 없으면 질문 그대로", () => {
  assert.deepEqual(questionWithAttachments("질문", []), { text: "질문", images: [] })
})

test(`글자 상한 — 파일마다 ${ATTACH_TEXT_PER_FILE}, 전체 ${ATTACH_TEXT_TOTAL}`, () => {
  const big = (name: string): ReadAttachment => ({ name, kind: "text", raw: "나".repeat(ATTACH_TEXT_PER_FILE * 2) })
  const q = questionWithAttachments("q", [big("a.txt"), big("b.txt"), big("c.txt")])
  const bodies = [...q.text.matchAll(/<<<첨부 \d\n([^]*?)\n첨부 \d>>>/g)].map((m) => m[1].length)
  assert.deepEqual(bodies, [ATTACH_TEXT_PER_FILE, ATTACH_TEXT_PER_FILE])
  assert.ok(bodies.reduce((a, b) => a + b, 0) <= ATTACH_TEXT_TOTAL)
  assert.ok(q.text.includes("[첨부 3] c.txt — 텍스트: 글자 상한에 닿아"))
  assert.ok(q.text.includes("앞 8,000자만 넣음"))
})

test(`이미지는 ${ATTACH_IMAGE_MAX}장까지 — 넘는 것은 보지 못했다고 적는다`, () => {
  const imgs: ReadAttachment[] = Array.from({ length: ATTACH_IMAGE_MAX + 1 }, (_, i) => ({ name: `${i}.png`, kind: "image", image: { base64: "B", mediaType: "image/jpeg" } }))
  const q = questionWithAttachments("q", imgs)
  assert.equal(q.images.length, ATTACH_IMAGE_MAX)
  assert.ok(q.text.includes("보지 못했습니다"))
})

test("읽지 못한 파일 · 글자 없는 PDF 는 이유를 적는다", () => {
  const q = questionWithAttachments("q", [
    { name: "a.hwp", kind: "other", raw: null, note: "이 형식은 본문을 읽지 못합니다." },
    { name: "scan.pdf", kind: "pdf", raw: "" },
  ])
  assert.ok(q.text.includes("[첨부 1] a.hwp — 파일: 이 형식은 본문을 읽지 못합니다."))
  assert.ok(q.text.includes("스캔한 PDF"))
})

test("앞 질문의 첨부는 다음 문맥에 이름만", () => {
  assert.equal(historyWithAttachmentNames("요약해 줘", []), "요약해 줘")
  assert.ok(historyWithAttachmentNames("요약해 줘", ["a.png", "b.pdf"]).includes("(첨부: a.png · b.pdf"))
})

test("Zod — 묻기에 fileIds 를 받는다(없어도 된다)", () => {
  assert.equal(AgentTurnSchema.safeParse({ content: "요약해 줘" }).success, true)
  assert.equal(AgentTurnSchema.safeParse({ content: "요약해 줘", fileIds: [UUID] }).success, true)
  assert.equal(StartAgentRoomSchema.safeParse({ content: "요약해 줘", fileIds: [UUID, UUID2] }).success, true)
  assert.equal(AgentTurnSchema.safeParse({ retryOf: "m1" }).success, true)
})

test("Zod 거부 — id 모양 · 개수 · 중복 · 빈 글", () => {
  assert.equal(AgentTurnSchema.safeParse({ content: "요약해 줘", fileIds: ["../etc/passwd"] }).success, false)
  assert.equal(AgentTurnSchema.safeParse({ content: "요약해 줘", fileIds: [UUID, UUID] }).success, false)
  assert.equal(AgentTurnSchema.safeParse({ content: "요약해 줘", fileIds: Array(6).fill(0).map((_, i) => UUID.replace(/.$/, String(i))) }).success, false)
  assert.equal(StartAgentRoomSchema.safeParse({ content: "", fileIds: [UUID] }).success, false)
  assert.equal(StartAgentRoomSchema.safeParse({ content: "요약", fileIds: "x" }).success, false)
})
