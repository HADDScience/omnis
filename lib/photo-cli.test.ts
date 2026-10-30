import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { ClaudePhotoLimitError, describeImageWithClaude } from "../import-tools/photo-describe-cli"

test("Claude 구독 경로 — 키 제거 · 임시 이미지 정리 · 한도/빈 응답 거부", async () => {
  const dir = mkdtempSync(join(tmpdir(), "photo-cli-test-"))
  const before = { ...process.env }
  try {
    const record = join(dir, "call.json")
    writeFileSync(join(dir, "claude"), `#!/usr/bin/env node
const fs = require('node:fs');
const prompt = process.argv.at(-1);
const path = prompt.split('\\n')[0].split(': ').at(-1);
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({path, exists:fs.existsSync(path), apiKey:process.env.ANTHROPIC_API_KEY, nested:process.env.CLAUDECODE}));
console.log(process.env.PHOTO_CLI_TEST_RESPONSE);
process.exit(Number(process.env.PHOTO_CLI_TEST_EXIT || 0));
`, { mode: 0o700 })
    process.env.PATH = `${dir}:${process.env.PATH}`
    process.env.ANTHROPIC_API_KEY = "must-not-reach-child"
    process.env.CLAUDECODE = "must-not-reach-child"
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer()
    const context = { task: null, lines: [] }
    process.env.PHOTO_CLI_TEST_RESPONSE = JSON.stringify({ result: "photo JSON" })
    assert.equal(await describeImageWithClaude(image, context), "photo JSON")
    const call = JSON.parse(readFileSync(record, "utf8"))
    assert.equal(call.exists, true)
    assert.equal(call.apiKey, undefined)
    assert.equal(call.nested, undefined)
    assert.equal(existsSync(call.path), false)

    process.env.PHOTO_CLI_TEST_EXIT = "1"
    process.env.PHOTO_CLI_TEST_RESPONSE = JSON.stringify({ is_error: true, result: "You've hit your 5-hour limit" })
    await assert.rejects(describeImageWithClaude(image, context), ClaudePhotoLimitError)
    assert.equal(existsSync(JSON.parse(readFileSync(record, "utf8")).path), false)

    process.env.PHOTO_CLI_TEST_RESPONSE = JSON.stringify({ result: "partial result" })
    await assert.rejects(describeImageWithClaude(image, context), /실행 실패/)

    process.env.PHOTO_CLI_TEST_EXIT = "0"
    process.env.PHOTO_CLI_TEST_RESPONSE = JSON.stringify({ result: "" })
    await assert.rejects(describeImageWithClaude(image, context), /비어/)
    process.env.PHOTO_CLI_TEST_RESPONSE = JSON.stringify({ is_error: true, result: "failed" })
    await assert.rejects(describeImageWithClaude(image, context), /실패/)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
    Object.assign(process.env, before)
    rmSync(dir, { recursive: true, force: true })
  }
})
