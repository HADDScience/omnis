/** 비밀 옮김 막기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { findSecrets, findSecretsInText, redactSecrets, secretBlockReason } from "./secrets"

const kinds = (t: string) => findSecretsInText(t).map((h) => h.kind)

// ─── 막아야 하는 것 (거부 사례) ───────────────────────────────

test("비밀번호 — 조사 · 구분자 여러 모양", () => {
  for (const t of [
    "공용 PC 비밀번호는 hadd2024! 입니다",
    "게스트 와이파이 비번: haddguest5G",
    "PW: 1234abcd",
    "password=Qwer!234",
    "회의실 PC 암호 0000a",
    "와이파이 비밀번호 hadd_guest_2026",
    "비밀번호 1234",
  ]) {
    assert.ok(kinds(t).includes("password"), t)
  }
})

test("인증 정보 — API 키 · 토큰 · 인증번호 · 카드번호", () => {
  assert.ok(kinds("키는 sk-proj-abcdefghijklmnopqrstuvwx1234 입니다").includes("credential"))
  assert.ok(kinds("AIzaSyA1234567890abcdefghijklmnopqrstuv").includes("credential"))
  assert.ok(kinds("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123").includes("credential"))
  assert.ok(kinds("인증번호 482913 입력").includes("credential"))
  assert.ok(kinds("법인카드 4111 1111 1111 1111").includes("credential"))
  assert.ok(kinds("postgres://omnis:s3cret@db.example.com/omnis").includes("credential"))
  assert.ok(kinds("hadd_AbCdEfGhIjKlMnOpQrSt").includes("credential"))
})

test("개인 식별번호 — 주민 · 외국인등록 · 운전면허 · 여권", () => {
  assert.ok(kinds("주민번호 900101-1234567").includes("personal_id"))
  assert.ok(kinds("9001011234567").includes("personal_id"))
  assert.ok(kinds("외국인등록번호 850315-5123456").includes("personal_id"))
  assert.ok(kinds("면허 11-22-333333-44").includes("personal_id"))
  assert.ok(kinds("여권번호 M12345678").includes("personal_id"))
})

test("중첩 입력(체크리스트 배열 · 카드 본문)까지 훑는다", () => {
  const input = { name: "공용 PC 정리", checklist: ["모니터 교체", "PC 비밀번호: hadd!0423 공유"], assignees: ["윤훈"] }
  assert.equal(findSecrets(input).length, 1)
  const reason = secretBlockReason({ card: "사무실 안내", markdown: "## 와이파이\n- 이름: HADD-Guest\n- 비번 haddguest5G" })
  assert.ok(reason && reason.includes("비밀번호"), reason ?? "")
  assert.ok(reason && !reason.includes("haddguest5G"), "이유 문장에 값을 그대로 싣지 않는다")
})

// ─── 걸지 말아야 하는 것 ───────────────────────────────────────

test("값이 없는 말은 걸지 않는다", () => {
  for (const t of [
    "비밀번호 재설정 안내 업무",
    "와이파이 비밀번호 변경 요청 처리",
    "PC 암호 정책 정리",
    "비밀번호는 담당자에게 직접 물어보세요",
    "API 키 발급 절차 문서화",
  ]) {
    assert.deepEqual(findSecretsInText(t), [], t)
  }
})

test("날짜 · 금액 · 전화 · 슬러그 · 과제번호는 걸지 않는다", () => {
  for (const t of [
    "마감 2026-11-05 까지 견적 1,234,000원",
    "연락처 010-1234-5678",
    "#task-14139531 진행 보고",
    "과제번호 RS-2025-00123456",
    "사업자등록번호 123-45-67890",
    "주문 1234 5678 1234 5678",
  ]) {
    assert.deepEqual(findSecretsInText(t), [], t)
  }
})

test("막힌 카드에 보일 글은 값을 가린다", () => {
  const out = redactSecrets("- 이름: HADD-Guest\n- 비번: haddguest5G\n주민번호 900101-1234567")
  assert.ok(!out.includes("haddguest5G"), out)
  assert.ok(!out.includes("900101-1234567"), out)
  assert.ok(out.includes("HADD-Guest"), "비밀이 아닌 글은 그대로")
  assert.equal(redactSecrets("비밀번호 재설정 안내"), "비밀번호 재설정 안내")
})
