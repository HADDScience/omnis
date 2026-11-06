import test from "node:test"
import assert from "node:assert/strict"
import sharp from "sharp"
import { acceptsWebp, thumbCacheKey, thumbPlan, thumbSrcSet, thumbWidth } from "@/lib/thumb"
import { makeThumb } from "@/lib/thumb-server"

test("폭은 단계로 올리고 960 을 넘지 않는다", () => {
  assert.equal(thumbWidth(1), 120)
  assert.equal(thumbWidth(120), 120)
  assert.equal(thumbWidth(121), 240)
  assert.equal(thumbWidth(520), 960)
  assert.equal(thumbWidth(5000), 960)
  assert.equal(thumbCacheKey("f1", 480), "_thumbs/f1-w480.webp")
})

test("srcset 은 그릴 폭의 1배 · 2배 단계를 덮는다", () => {
  assert.equal(thumbSrcSet("f", 260), "/api/files/f/thumb?w=480 480w, /api/files/f/thumb?w=960 960w")
  assert.equal(thumbSrcSet("f", 44), "/api/files/f/thumb?w=120 120w")
  assert.equal(thumbSrcSet("f", 120), "/api/files/f/thumb?w=120 120w, /api/files/f/thumb?w=240 240w")
})

test("형식별 처리 — PNG · JPEG · WebP 는 WebP, GIF 는 원본(움직임), SVG · HEIC 는 미리보기 없음", () => {
  const f = (mimeType: string, name: string, size = 1000) => thumbPlan({ mimeType, name, size })
  assert.equal(f("image/jpeg", "a.jpg"), "webp")
  assert.equal(f("image/png", "a.png"), "webp")
  assert.equal(f("image/webp", "a.webp"), "webp")
  assert.equal(f("", "a.JPG"), "webp")
  assert.equal(f("image/gif", "a.gif"), "original")
  assert.equal(f("image/svg+xml", "a.svg"), "none")
  assert.equal(f("image/heic", "a.heic"), "none")
  assert.equal(f("application/pdf", "a.pdf"), "none")
  assert.equal(f("image/jpeg", "big.jpg", 20 * 1024 * 1024 + 1), "original")
})

test("WebP 를 받겠다고 적힌 Accept 만 믿는다", () => {
  assert.equal(acceptsWebp("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"), true)
  assert.equal(acceptsWebp("image/webp,*/*"), true)
  assert.equal(acceptsWebp("image/png,image/svg+xml,image/*;q=0.8,video/*;q=0.8,*/*;q=0.5"), false)
  assert.equal(acceptsWebp("*/*"), false)
  assert.equal(acceptsWebp(null), false)
  assert.equal(acceptsWebp("image/webp;q=0, */*"), false)
})

test("미리보기 — 회전을 바로잡고, 긴 변을 줄이고, 위치 · 촬영 정보를 싣지 않는다", async () => {
  // 가로 1600×1200 사진을 「오른쪽으로 90° 돌려 보라」(orientation 6) 표시와 위치 정보로 저장
  const input = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: "시험카메라" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 30/1 0/1" } })
    .toBuffer()
  assert.ok((await sharp(input).metadata()).exif)

  const out = await makeThumb(input, 480)
  const meta = await sharp(out).metadata()
  assert.equal(meta.format, "webp")
  assert.equal(meta.width, 480)
  assert.equal(meta.height, 640)
  assert.equal(meta.exif, undefined)
  assert.equal(meta.orientation, undefined)
  assert.ok(out.length < input.length)
})

test("미리보기 — 작은 사진은 키우지 않고, 아주 긴 사진은 높이 2배 폭에서 자른다", async () => {
  const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: "#fff" } }).png().toBuffer()
  assert.equal((await sharp(await makeThumb(small, 960)).metadata()).width, 100)
  const tall = await sharp({ create: { width: 400, height: 4000, channels: 3, background: "#000" } }).png().toBuffer()
  const meta = await sharp(await makeThumb(tall, 240)).metadata()
  assert.equal(meta.height, 480)
  assert.equal(meta.width, 48)
})

test("거부 — 이미지가 아닌 바이트는 만들지 않고 던진다(라우트가 원본으로 돌린다)", async () => {
  await assert.rejects(makeThumb(Buffer.from("not an image"), 240))
})
