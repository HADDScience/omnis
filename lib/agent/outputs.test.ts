/** 결과물 도구 — 초안 · 기록 제안 입력 규칙 · 옴니스 방 파일 권한 · 비밀 차단 · 확인 없이 실행 불가. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { DraftSchema, RecordItemSchema, draftAsFile, evidenceSnippet, mailCopyText } from "./output-rules"
import { canSeeFile, visibleFileWhere } from "../file-access"
import { secretBlockReason } from "./secrets"
import { checkExecution, type StepForCheck } from "./approval"
import { buildFile, expectOf, verifyOfficeFile } from "./doc-files"

test("메일 회신 초안 — 복사할 글은 제목 + 본문, 파일은 받는 사람 · 제목을 머리에", async () => {
  const d = DraftSchema.parse({ kind: "mail_reply", title: "견적 회신", to: "김연구 (○○대)", subject: "RE: 애드젤 견적", body: "안녕하세요.\n견적서를 첨부합니다." })
  assert.equal(mailCopyText(d), "제목: RE: 애드젤 견적\n\n안녕하세요.\n견적서를 첨부합니다.")
  const f = draftAsFile(d)
  assert.equal(f.format, "docx")
  assert.equal(f.file_name, "메일 회신 초안 - 견적 회신.docx")
  assert.ok(f.format === "docx" && f.body.startsWith("받는 사람: 김연구 (○○대)\n제목: RE: 애드젤 견적\n\n"))
  // 실제로 만들어 다시 열어 본다
  await verifyOfficeFile(await buildFile(f), expectOf(f))
})

test("보고서 초안 — 머리 없이 본문 그대로, 이름은 제목", () => {
  const f = draftAsFile(DraftSchema.parse({ kind: "report", title: "10월 실적 보고", body: "# 요약\n- 완료 3" }))
  assert.equal(f.file_name, "10월 실적 보고.docx")
  assert.ok(f.format === "docx" && f.body === "# 요약\n- 완료 3")
})

test("초안 — 빈 본문 · 모르는 종류는 받지 않는다 (거부되어야 하는 경우)", () => {
  assert.equal(DraftSchema.safeParse({ kind: "report", title: "t", body: "   " }).success, false)
  assert.equal(DraftSchema.safeParse({ kind: "send_mail", title: "t", body: "b" }).success, false)
})

test("기록 제안 항목 — 근거 없는 · 종류가 틀린 항목은 받지 않는다 (거부되어야 하는 경우)", () => {
  const ok = { kind: "AWARD", grade: "MAJOR", title: "○○ 창업경진대회 우수상", evidence: "창업경진대회 우수상 받았어요" }
  assert.equal(RecordItemSchema.safeParse(ok).success, true)
  assert.equal(RecordItemSchema.safeParse({ ...ok, evidence: "" }).success, false)
  assert.equal(RecordItemSchema.safeParse({ ...ok, kind: "PATENT" }).success, false)
  assert.equal(RecordItemSchema.safeParse({ ...ok, grade: "EXCLUDE" }).success, false)
  assert.equal(RecordItemSchema.safeParse({ ...ok, date: "2026/10/20" }).success, false)
})

test("근거 조각 — 따옴표를 떼고 첫 줄 40자. 줄을 이어 붙이지 않는다", () => {
  assert.equal(evidenceSnippet("「GBSA 바이오 지원사업에 최종 선정됐습니다!」"), "GBSA 바이오 지원사업에 최종 선정됐습니다!")
  assert.equal(evidenceSnippet("“\n\n첫 줄은 이것\n둘째 줄”"), "첫 줄은 이것")
  assert.equal(evidenceSnippet("가".repeat(100)).length, 40)
  assert.equal(evidenceSnippet("「」"), "")
})

test("옴니스가 만든 파일(privateToUserId = 방 주인, 옴니스 글에 붙음) — 방 주인만 본다. 남은 못 본다 (거부되어야 하는 경우)", () => {
  // lib/agent/outputs.ts saveFileToRoom 이 만드는 행의 모양 — 판정은 attach 의 canSeeFile 한 곳
  const made = { privateToUserId: "owner", messageId: "omnis-msg", roomMemberIds: ["owner"] }
  assert.equal(canSeeFile(made, "owner"), true)
  assert.equal(canSeeFile(made, "other"), false)
  // 목록 조건도 같은 규칙 — 비공개 파일은 그 방 참여자 조건으로만 보인다
  const where = visibleFileWhere("other") as { OR: Record<string, unknown>[] }
  assert.ok(where.OR.some((c) => c.privateToUserId === null))
  assert.ok(!where.OR.some((c) => c.privateToUserId === "owner"))
})

test("결과물 입력에 비밀이 있으면 막는다 — 표 칸 · 슬라이드 · 메일 본문 깊숙이 있어도 (거부되어야 하는 경우)", () => {
  assert.ok(secretBlockReason({ format: "xlsx", file_name: "장비", sheets: [{ name: "PC", rows: [["자리", "비고"], ["회의실", "비밀번호: hadd!2024"]] }] }))
  assert.ok(secretBlockReason({ format: "pptx", file_name: "p", title: "t", slides: [{ title: "접속", bullets: ["API 키 sk-proj-abcdefghijklmnopqrstuvwx"] }] }))
  assert.ok(secretBlockReason({ kind: "mail_reply", title: "t", body: "주민등록번호 900101-1234567 로 등록했습니다" }))
  assert.ok(secretBlockReason({ markdown: "## 이번 주\n- 게스트 와이파이 비번 haddguest77 공유" }))
  // 값 없는 말은 걸지 않는다
  assert.equal(secretBlockReason({ kind: "report", title: "보안 점검", body: "비밀번호 재설정 안내 메일을 보냈습니다." }), null)
})

test("결과물 도구도 확인 카드 없이 · 확인 전에는 실행하지 않는다 (거부되어야 하는 경우)", () => {
  const input = { format: "docx", file_name: "a", title: "t", body: "b" }
  assert.equal(checkExecution(null, { toolName: "create_file", input }).ok, false)
  const step = (status: StepForCheck["status"]): StepForCheck => ({ status, toolName: "create_file", input, planHash: "h", blockedReason: null })
  assert.equal(checkExecution(step("PENDING"), { toolName: "create_file", input }).ok, false)
  assert.equal(checkExecution(step("EXECUTED"), { toolName: "create_file", input }).ok, false)
  // 확인한 내용과 다른 파일은 만들지 않는다
  assert.equal(checkExecution(step("APPROVED"), { toolName: "create_file", input: { ...input, body: "바뀐 본문" } }).ok, false)
  assert.equal(checkExecution(step("APPROVED"), { toolName: "draft_document", input }).ok, false)
  assert.equal(checkExecution(step("APPROVED"), { toolName: "create_file", input }).ok, true)
})
