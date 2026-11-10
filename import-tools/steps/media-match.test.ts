// npx tsx --test import-tools/steps/media-match.test.ts — DB · NAS 없이 돈다. 이름은 지어낸 값이다.
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileResponseHeaders } from "../../lib/file-serving"
import { CHUNK_BYTES, IMPORT_MAX_BYTES, pickNamed, stampOfNamedDir, stripAttachmentPlaceholder, uploadInChunks, type Candidate } from "./media-match"

test("첨부가 붙은 글에서 자리표시 줄만 뺀다", () => {
  assert.equal(stripAttachmentPlaceholder("Photo"), "")
  assert.equal(stripAttachmentPlaceholder("3 photos"), "")
  assert.equal(stripAttachmentPlaceholder("Video"), "")
  assert.equal(stripAttachmentPlaceholder("File: 보고서 v2 (최종).pdf"), "")
  // 사람이 쓴 줄 · 삭제 표시는 남는다
  assert.equal(stripAttachmentPlaceholder("Photo\nThe message has been deleted."), "The message has been deleted.")
  assert.equal(stripAttachmentPlaceholder("보내드립니다\nFile: 견적서.xlsx"), "보내드립니다")
  // 자리표시가 아닌 글은 그대로 — 첫머리가 닮아도
  for (const s of ["Photo 다시 보내주세요", "Photos", "사진", "File:", "Emoticon", "Voice Call", "3 photos 보냈어요"]) assert.equal(stripAttachmentPlaceholder(s), s)
})

const named = (dir: string, name: string): Candidate => ({ path: `${dir}/${name}`, name, size: 1, stamp: stampOfNamedDir(dir), named: true })
const at = (s: string) => new Date(`${s}+09:00`)

test("media/files/<보낸 시각> 폴더에서만 시각을 읽는다", () => {
  assert.equal(stampOfNamedDir("/x/media/files/20261105_102954")?.getTime(), at("2026-11-05T10:29:54").getTime())
  assert.equal(stampOfNamedDir("/x/media/files/20261105_102954_2")?.getTime(), at("2026-11-05T10:29:54").getTime())
  assert.equal(stampOfNamedDir("/x/media"), null)
  assert.equal(stampOfNamedDir("/x/media/20261105_102954"), null)
})

test("같은 이름은 보낸 시각으로 가른다", () => {
  const a = named("/m/files/20261103_100000", "같은.pdf"), b = named("/m/files/20261105_100000", "같은.pdf")
  assert.equal(pickNamed("같은.pdf", at("2026-11-05T10:00:00"), [a, b], new Set()), b)
  assert.equal(pickNamed("같은.pdf", at("2026-11-03T10:00:00"), [a, b], new Set()), a)
})

test("이름이 다르거나 3분 밖이거나 이미 쓴 파일은 고르지 않는다", () => {
  const f = named("/m/files/20261105_100000", "가.pdf"), t = at("2026-11-05T10:00:00")
  assert.equal(pickNamed("나.pdf", t, [f], new Set()), undefined)
  assert.equal(pickNamed("가.pdf", at("2026-11-05T10:04:00"), [f], new Set()), undefined)
  assert.equal(pickNamed("가.pdf", t, [f], new Set([f.path])), undefined)
  assert.equal(pickNamed("가.pdf", t, [{ ...f, named: false }], new Set()), undefined)
})

test("이름의 / 는 저장할 때처럼 : 로 본다", () => {
  const f = named("/m/files/20261105_100000", "가:나.pdf")
  assert.equal(pickNamed("가/나.pdf", at("2026-11-05T10:00:00"), [f], new Set()), f)
})

test("상한은 앱의 큰 첨부 상한과 같고 조각은 그보다 작다", () => {
  assert.equal(IMPORT_MAX_BYTES, 300 * 1024 * 1024)
  assert.ok(CHUNK_BYTES < IMPORT_MAX_BYTES)
})

const source = (size: number) => Buffer.alloc(size, 7)

test("나눠 올린 조각이 빈틈없이 이어지고 끝에서 크기를 잰다", async () => {
  const body = source(25), seen: [number, number, number][] = []
  await uploadInChunks({
    size: 25, chunkBytes: 10,
    read: async (s, l) => body.subarray(s, s + l),
    putRange: async (b, s, t) => { seen.push([s, b.length, t]); return 204 },
    stat: async () => 25,
  })
  assert.deepEqual(seen, [[0, 10, 25], [10, 10, 25], [20, 5, 25]])
})

test("조각 하나는 세 번까지 다시 보낸다", async () => {
  let calls = 0
  await uploadInChunks({
    size: 5, chunkBytes: 10, read: async (_, l) => source(l),
    putRange: async () => { calls++; if (calls === 1) throw new Error("끊김"); return calls === 2 ? 500 : 201 },
    stat: async () => 5,
  })
  assert.equal(calls, 3)
})

test("계속 실패하면 멈춘다 — 다음 조각을 보내지 않는다", async () => {
  let calls = 0
  await assert.rejects(uploadInChunks({ size: 25, chunkBytes: 10, read: async (_, l) => source(l), putRange: async () => { calls++; return 507 }, stat: async () => 25 }), /HTTP 507/)
  assert.equal(calls, 3)
})

test("NAS 크기가 다르면 실패다", async () => {
  await assert.rejects(uploadInChunks({ size: 5, chunkBytes: 10, read: async (_, l) => source(l), putRange: async () => 201, stat: async () => 4 }), /크기가 다름/)
})

test("이식 파일의 응답은 안전 목록(#155)을 따른다", async () => {
  process.env.DATABASE_URL ??= "postgresql://x/y"
  const { MIME } = await import("./media")
  for (const [ext, mimeType] of Object.entries(MIME)) {
    const h = fileResponseHeaders({ mimeType, name: `가${ext}` })
    assert.equal(h["X-Content-Type-Options"], "nosniff")
    if (h["Content-Disposition"].startsWith("inline")) assert.match(h["Content-Type"], /^(image\/(png|jpeg|gif)|application\/pdf|video\/(mp4|quicktime))$/, ext)
  }
  // 표에 없는 확장자는 octet-stream 으로 저장되고 내려받기로만 나간다
  for (const name of ["가.html", "가.svg", "가.js", "가.pptx", "가.hwp"]) {
    const stored = MIME[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream"
    assert.ok(fileResponseHeaders({ mimeType: stored, name })["Content-Disposition"].startsWith("attachment"), name)
  }
})
