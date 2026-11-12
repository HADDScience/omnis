import { test } from "node:test"
import assert from "node:assert/strict"
import { largeUploadGuide, partBatches } from "./mcp-large-upload"

test("조각 서명은 한 번에 보낼 수 있는 만큼씩 — 빠짐 · 겹침 없이 1..n", () => {
  assert.deepEqual(partBatches(1, 8), [[1]])
  assert.deepEqual(partBatches(8, 8), [[1, 2, 3, 4, 5, 6, 7, 8]])
  const b = partBatches(19, 8)
  assert.deepEqual(b.map((x) => x.length), [8, 8, 3])
  assert.deepEqual(b.flat(), Array.from({ length: 19 }, (_, i) => i + 1))
})

test("큰 파일 절차: 링크 · 세 단계 주소가 들어 있고, 꺼져 있으면 올릴 수 없다고만 말한다", () => {
  const on = largeUploadGuide("https://example.test/api/ip-mcp", "TOKEN.SIG", true).join("\n")
  assert.match(on, /\/upload\/large\?t=\{T\}/)
  assert.match(on, /\/upload\/large\/complete\?t=\{T\}/)
  assert.match(on, /"TOKEN\.SIG"/)
  assert.match(on, /method="PUT"/)
  const off = largeUploadGuide("https://example.test/api/ip-mcp", "TOKEN.SIG", false).join("\n")
  assert.match(off, /꺼져 있어/)
  assert.doesNotMatch(off, /TOKEN/)
})
