import { test } from "node:test"
import assert from "node:assert/strict"
import JSZip from "jszip"
import { crc32Update, textEntry, zipStream, type ZipEntry } from "./zip-stream"

const bytesStream = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch)
      c.close()
    },
  })

async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const r = s.getReader()
  for (;;) {
    const { done, value } = await r.read()
    if (done) break
    parts.push(value)
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

test("crc32 — 알려진 값", () => {
  assert.equal(crc32Update(0, new TextEncoder().encode("123456789")), 0xcbf43926)
  // 나눠 넣어도 같다
  const a = crc32Update(crc32Update(0, new TextEncoder().encode("12345")), new TextEncoder().encode("6789"))
  assert.equal(a, 0xcbf43926)
})

test("만든 zip 을 jszip 이 그대로 푼다 — 한글 이름 · 여러 조각 · 빠진파일.txt", async () => {
  const date = new Date(2026, 10, 12, 10, 30, 0)
  const big = new Uint8Array(300_000).map((_, i) => i % 251)
  const entries: ZipEntry[] = [
    { name: "전사방_2611/2026-11-11_정우창_사진.jpg", date, open: async () => bytesStream([big.slice(0, 100_000), big.slice(100_000)]) },
    { name: "전사방_2611/2026-11-11_정우창_메모.txt", date, open: async () => bytesStream([new TextEncoder().encode("안녕")]) },
    textEntry("전사방_2611/빠진파일.txt", "목록", date),
  ]
  const progress: number[] = []
  const zip = await collect(zipStream(entries, { onProgress: (p) => progress.push(p.done) }))
  const unzipped = await JSZip.loadAsync(zip)
  const names = Object.keys(unzipped.files).sort()
  assert.deepEqual(names, ["전사방_2611/2026-11-11_정우창_메모.txt", "전사방_2611/2026-11-11_정우창_사진.jpg", "전사방_2611/빠진파일.txt"])
  const photo = await unzipped.file("전사방_2611/2026-11-11_정우창_사진.jpg")!.async("uint8array")
  assert.deepEqual(photo, big)
  assert.equal(await unzipped.file("전사방_2611/2026-11-11_정우창_메모.txt")!.async("string"), "안녕")
  assert.equal(progress.at(-1), 3)
})

test("열지 못한 항목은 건너뛰고 나머지로 zip 을 끝낸다", async () => {
  const date = new Date(2026, 0, 1)
  const skipped: string[] = []
  const zip = await collect(
    zipStream(
      [
        { name: "a.txt", date, open: async () => { throw new Error("404") } },
        { name: "b.txt", date, open: async () => bytesStream([new TextEncoder().encode("b")]) },
      ],
      { onSkip: (n) => skipped.push(n) },
    ),
  )
  assert.deepEqual(skipped, ["a.txt"])
  assert.deepEqual(Object.keys((await JSZip.loadAsync(zip)).files), ["b.txt"])
})

test("취소하면 스트림이 오류로 끝난다", async () => {
  const ac = new AbortController()
  const s = zipStream([{ name: "a", date: new Date(), open: async () => bytesStream([new Uint8Array(10)]) }], { signal: ac.signal })
  ac.abort()
  await assert.rejects(collect(s))
})
