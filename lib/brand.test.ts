import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { BRAND_ASSETS, resolveBrand } from "./brand"
import { BRAND_STATIC_PATHS, brandRewrites } from "./brand-static.mjs"

const PUBLIC = path.join(process.cwd(), "public")
const file = (url: string) => path.join(PUBLIC, url)

/** PNG 머리(IHDR)의 너비 · 높이 */
function pngSize(url: string): [number, number] {
  const b = readFileSync(file(url))
  assert.equal(b.toString("ascii", 1, 4), "PNG", url)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

test("NEXT_PUBLIC_BRAND — v2(앞뒤 공백 · 대문자 허용)만 새 로고, 빈 값 · 오타는 지금 로고", () => {
  assert.equal(resolveBrand(undefined), "v1")
  assert.equal(resolveBrand(""), "v1")
  assert.equal(resolveBrand("v1"), "v1")
  assert.equal(resolveBrand("v3"), "v1")
  assert.equal(resolveBrand("2"), "v1")
  assert.equal(resolveBrand("v2"), "v2")
  assert.equal(resolveBrand(" V2 "), "v2")
})

test("v1 은 정적 주소를 돌리지 않는다 — 지금 동작 그대로", () => {
  assert.deepEqual(brandRewrites("v1"), [])
})

test("v2 rewrite 는 같은 이름의 v2 파일로 가고, 그 파일이 있다", () => {
  const rules = brandRewrites("v2")
  assert.equal(rules.length, BRAND_STATIC_PATHS.length)
  for (const { source, destination } of rules) {
    assert.equal(destination, `/brand/v2${source}`)
    assert.ok(existsSync(file(destination)), destination)
    // v1 쪽 원래 파일도 그대로 남아 있어야 한다(v1 은 이것을 그대로 낸다)
    assert.ok(existsSync(file(source)), source)
  }
})

test("두 판의 자산이 전부 public 에 있다", () => {
  for (const [v, a] of Object.entries(BRAND_ASSETS)) {
    const urls = [a.tileMark, a.markOnDark, a.apple.url, ...a.icon.map((i) => i.url), ...a.manifestIcons.map((i) => i.src)]
    if (a.mark) urls.push(a.mark)
    for (const u of urls) assert.ok(existsSync(file(u)), `${v}: ${u}`)
  }
})

test("PNG 아이콘의 실제 크기가 선언한 크기와 같다", () => {
  for (const a of Object.values(BRAND_ASSETS)) {
    const pngs = [
      ...a.manifestIcons.map((i) => ({ url: i.src, sizes: i.sizes })),
      ...a.icon.filter((i) => i.type === "image/png"),
      a.apple,
    ]
    for (const { url, sizes } of pngs) {
      const [w, h] = pngSize(url)
      assert.equal(`${w}x${h}`, sizes, url)
    }
  }
})

test("v2 는 manifest 아이콘 주소가 v1 과 다르다 — 설치한 앱이 바뀐 아이콘을 알아채게", () => {
  const v1 = new Set(BRAND_ASSETS.v1.manifestIcons.map((i) => i.src))
  for (const i of BRAND_ASSETS.v2.manifestIcons) assert.ok(!v1.has(i.src), i.src)
  assert.ok(BRAND_ASSETS.v2.manifestIcons.some((i) => i.purpose === "maskable"))
  assert.notEqual(BRAND_ASSETS.v2.apple.url, BRAND_ASSETS.v1.apple.url)
})

test("v2 favicon.ico 는 16 · 32 · 48 을 담는다", () => {
  const b = readFileSync(file("/brand/v2/favicon.ico"))
  assert.equal(b.readUInt16LE(2), 1) // ICO
  const n = b.readUInt16LE(4)
  const sizes = Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256)
  assert.deepEqual(sizes.sort((x, y) => x - y), [16, 32, 48])
})
