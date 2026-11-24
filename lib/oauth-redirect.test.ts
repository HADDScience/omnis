import { test } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { matchRedirectUri } from "./oauth-redirect"

const CLAUDE_AI = "https://claude.ai/api/mcp/auth_callback"
const CODEX = "http://127.0.0.1:49687/callback/AbCdEf_12345"
const CLAUDE_CODE = "http://localhost:60591/callback"

test("1. claude.ai — 정확히 같으면 통과하고 그 주소 그대로 돌려준다", () => {
  assert.equal(matchRedirectUri([CLAUDE_AI], CLAUDE_AI), CLAUDE_AI)
})

test("2. claude.ai — 경로 · 호스트 · 스킴 · 포트가 하나라도 다르면 거부한다", () => {
  for (const uri of [
    "https://claude.ai/api/mcp/auth_callback/",
    "https://claude.ai/api/mcp/other",
    "https://evil.ai/api/mcp/auth_callback",
    "https://claude.ai.evil.com/api/mcp/auth_callback",
    "http://claude.ai/api/mcp/auth_callback",
    "https://claude.ai:8443/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback?x=1",
  ]) {
    assert.equal(matchRedirectUri([CLAUDE_AI], uri), null, uri)
  }
})

test("3. 루프백 — 127.0.0.1 ↔ localhost ↔ [::1] 는 같은 호스트이고 포트만 다른 것도 통과한다", () => {
  // Next 가 바꿔 넘긴 꼴 — 되돌릴 주소는 등록된 127.0.0.1 로
  assert.equal(matchRedirectUri([CODEX], "http://localhost:49687/callback/AbCdEf_12345"), CODEX)
  // 포트만 다름 — 요청의 포트를 쓴다
  assert.equal(
    matchRedirectUri([CODEX], "http://localhost:50001/callback/AbCdEf_12345"),
    "http://127.0.0.1:50001/callback/AbCdEf_12345"
  )
  assert.equal(
    matchRedirectUri([CODEX], "http://[::1]:49687/callback/AbCdEf_12345"),
    CODEX
  )
  // Claude Code(localhost 등록)는 지금처럼 정확 일치, 포트만 다르면 localhost 그대로
  assert.equal(matchRedirectUri([CLAUDE_CODE], CLAUDE_CODE), CLAUDE_CODE)
  assert.equal(matchRedirectUri([CLAUDE_CODE], "http://127.0.0.1:61000/callback"), "http://localhost:61000/callback")
  // /token — 저장된 주소와 Codex 가 폼으로 보낸 원래 값
  assert.equal(matchRedirectUri([CODEX], CODEX), CODEX)
})

test("4. 루프백 — 경로 · 쿼리가 다르면 거부한다", () => {
  for (const uri of [
    "http://localhost:49687/callback/other",
    "http://localhost:49687/callback/AbCdEf_12345/",
    "http://localhost:49687/callback",
    "http://localhost:49687/callback/AbCdEf_12345?x=1",
    "http://localhost:49687/callback/AbCdEf_12345#frag",
    "http://user@localhost:49687/callback/AbCdEf_12345",
    "https://localhost:49687/callback/AbCdEf_12345",
  ]) {
    assert.equal(matchRedirectUri([CODEX], uri), null, uri)
  }
})

test("5. 루프백처럼 보이는 바깥 호스트는 거부한다", () => {
  for (const uri of [
    "https://127.0.0.1.evil.com/callback/AbCdEf_12345",
    "http://127.0.0.1.evil.com:49687/callback/AbCdEf_12345",
    "http://localhost.evil.com:49687/callback/AbCdEf_12345",
    "http://127.0.0.2:49687/callback/AbCdEf_12345",
  ]) {
    assert.equal(matchRedirectUri([CODEX], uri), null, uri)
  }
})

test("6. 루프백 등록에 원격 http 주소로 요청하면 거부하고, 원격 http 등록은 정확 일치만 된다", () => {
  assert.equal(matchRedirectUri([CODEX], "http://evil.com:49687/callback/AbCdEf_12345"), null)
  assert.equal(matchRedirectUri([CODEX], "http://10.0.0.5:49687/callback/AbCdEf_12345"), null)
  const remote = "http://example.com:8080/cb"
  assert.equal(matchRedirectUri([remote], remote), remote)
  assert.equal(matchRedirectUri([remote], "http://example.com:9090/cb"), null)
  assert.equal(matchRedirectUri([remote], "http://localhost:8080/cb"), null)
})

test("비어 있거나 URL 이 아니면 거부한다", () => {
  assert.equal(matchRedirectUri([CODEX], ""), null)
  assert.equal(matchRedirectUri([CODEX], "not a url"), null)
  assert.equal(matchRedirectUri([], CODEX), null)
  assert.equal(matchRedirectUri(["not a url"], "http://localhost:1/x"), null)
})

test("Next 가 쿼리의 127.0.0.1 을 localhost 로 바꿔 넘겨도 /authorize 비교가 통과한다 (2026-11-24 Codex 실패의 재현)", () => {
  const q = new URLSearchParams({ client_id: "c", redirect_uri: CODEX })
  const seen = new URL(new NextRequest(`https://omnis.example/api/ip-mcp/authorize?${q}`).url).searchParams.get("redirect_uri")!
  // 이 단언이 깨지면 Next 가 정규화를 그만둔 것이다 — 그래도 아래 비교는 통과해야 한다.
  assert.equal(seen, "http://localhost:49687/callback/AbCdEf_12345")
  assert.equal([CODEX].includes(seen), false)
  assert.equal(matchRedirectUri([CODEX], seen), CODEX)
})
