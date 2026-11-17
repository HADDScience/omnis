// scripts/e2e-gate.mjs — CI 의 e2e 판정. 알려진 실패만 있으면 통과, 그 밖의 실패가 있으면 실패
import assert from "node:assert/strict"
import { test } from "node:test"
import { classify, isKnown } from "../scripts/e2e-gate.mjs"

const spec = (file: string, title: string, tests: { projectName: string; status: string }[]) => ({ file, title, line: 1, tests })
const report = (specs: ReturnType<typeof spec>[], describe?: string) => ({
  suites: [
    {
      title: specs[0]?.file ?? "x.spec.ts",
      file: specs[0]?.file,
      ...(describe ? { suites: [{ title: describe, specs }] } : { specs }),
    },
  ],
})

test("알려진 실패 — 파일 · 프로젝트 · 제목 조건을 모두 본다", () => {
  assert.equal(isKnown({ file: "feature/login-code.spec.ts", project: "feature", title: "아무거나" }), true)
  assert.equal(isKnown({ file: "feature/settings-ai-survey.spec.ts", project: "mobile", title: "폰" }), true)
  assert.equal(isKnown({ file: "feature/settings-ai-survey.spec.ts", project: "feature", title: "앞뒤가 안 맞는 답 (dark)" }), true)
  // 같은 파일이라도 PC · 밝은 화면 시험은 알려진 실패가 아니다
  assert.equal(isKnown({ file: "feature/settings-ai-survey.spec.ts", project: "feature", title: "구성원 — 대화로 답한다" }), false)
  assert.equal(isKnown({ file: "feature/chat-message-edit.spec.ts", project: "feature", title: "x" }), false)
})

test("판정 — 마지막까지 실패한 것만 세고, 알려진 실패는 따로 둔다", () => {
  const r = classify([
    report([
      spec("feature/login-code.spec.ts", "코드 로그인", [{ projectName: "feature", status: "unexpected" }]),
      spec("feature/admin-page.spec.ts", "관리자", [{ projectName: "feature", status: "flaky" }]),
    ]),
    report(
      [
        spec("feature/chat.spec.ts", "보낸다", [{ projectName: "feature", status: "expected" }]),
        spec("feature/chat.spec.ts", "고친다", [{ projectName: "feature", status: "unexpected" }]),
      ],
      "채팅",
    ),
  ])
  assert.equal(r.total, 4)
  assert.equal(r.passed, 1)
  assert.equal(r.flaky.length, 1)
  assert.deepEqual(r.knownFailed.map((t: { file: string }) => t.file), ["feature/login-code.spec.ts"])
  assert.deepEqual(r.newFailed.map((t: { title: string }) => t.title), ["채팅 › 고친다"])
})

test("판정 — 보고서의 경로가 tests/ 를 포함해도 같은 파일로 본다", () => {
  const r = classify([report([spec("tests/feature/brand-logo.spec.ts", "로고", [{ projectName: "feature", status: "unexpected" }])])])
  assert.equal(r.knownFailed.length, 1)
  assert.equal(r.newFailed.length, 0)
})
