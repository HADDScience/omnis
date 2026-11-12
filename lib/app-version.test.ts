import { test } from "node:test"
import assert from "node:assert/strict"
import { appVersion } from "./app-version"

test("버전 · 커밋 짧은 해시 · 서울 기준 배포 날짜", () => {
  assert.deepEqual(appVersion({ version: "0.0.1", sha: "331D592584701ce22a327824bff6c82af5958ebd", builtAt: "2026-11-11T16:30:00Z" }), {
    version: "0.0.1",
    commit: "331d592",
    // 서울은 UTC+9 — 16:30Z 는 다음 날
    builtOn: "2026-11-12",
  })
})

test("로컬 빌드처럼 커밋 · 시각을 모르면 비운다", () => {
  assert.deepEqual(appVersion({ version: "0.0.1", sha: "", builtAt: undefined }), { version: "0.0.1", commit: null, builtOn: null })
  assert.deepEqual(appVersion({ sha: "dev", builtAt: "not a date" }), { version: "0.0.0", commit: null, builtOn: null })
})
