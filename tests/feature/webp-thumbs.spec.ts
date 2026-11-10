/**
 * 사진 미리보기(WebP) — /api/files/{id}/thumb 가 처음 요청 때 만들어 NAS 에 두고, 원본은 /raw 그대로다.
 * 규칙의 단위 시험: lib/thumb.test.ts. 가짜 NAS(scripts/e2e-fake-nas.mjs)가 떠 있을 때만 돈다 — CI 는 띄운다.
 */
import sharp from "sharp"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const NAS = process.env.E2E_FAKE_NAS_URL
const WEBP_ACCEPT = { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" }
const OLD_ACCEPT = { Accept: "image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5" }

async function as(browser: Browser, name: DemoUser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, name)
  return { ctx, page }
}

test.describe("사진 미리보기", () => {
  test.skip(!NAS, "가짜 NAS 가 없다(E2E_FAKE_NAS_URL)")

  const prisma = new PrismaClient()
  const fileIds: string[] = []
  let photo: Buffer

  test.beforeAll(async () => {
    // 폰 사진처럼 — 세로로 보라는 회전 표시 · 위치 정보가 달린 JPEG
    photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 30 } } })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 30/1 0/1" } })
      .toBuffer()
  })

  test.afterAll(async () => {
    await prisma.file.deleteMany({ where: { id: { in: fileIds } } })
    await prisma.$disconnect()
  })

  async function upload(page: Page, name: string, mimeType: string, buffer: Buffer, scope?: "private") {
    const res = await page.request.post("/api/files", { multipart: { file: { name, mimeType, buffer }, ...(scope ? { scope } : {}) } })
    expect(res.status(), `${name} 올리기`).toBe(201)
    const record = (await res.json()) as { id: string; path: string }
    fileIds.push(record.id)
    return record
  }

  test("JPEG — 회전을 바로잡은 작은 WebP, 메타데이터 없음, 다음엔 캐시에서 준다. 원본은 그대로다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const file = await upload(page, "현장.jpg", "image/jpeg", photo)
      const first = await page.request.get(`/api/files/${file.id}/thumb?w=480`, { headers: WEBP_ACCEPT })
      expect(first.status()).toBe(200)
      const h = first.headers()
      expect(h["content-type"]).toBe("image/webp")
      expect(h["x-content-type-options"]).toBe("nosniff")
      expect(h["content-disposition"]).toBe("inline; filename*=UTF-8''%ED%98%84%EC%9E%A5.webp")
      expect(h["vary"]).toContain("Accept")
      expect(h["x-thumb-cache"]).toBe("miss")
      const body = await first.body()
      const meta = await sharp(body).metadata()
      expect([meta.width, meta.height]).toEqual([480, 640])
      expect(meta.exif).toBeUndefined()
      expect(body.length).toBeLessThan(photo.length / 4)

      // 저장은 응답 뒤에 끝난다
      await expect
        .poll(async () => (await page.request.get(`/api/files/${file.id}/thumb?w=480`, { headers: WEBP_ACCEPT })).headers()["x-thumb-cache"], { timeout: 10_000 })
        .toBe("hit")
      // 요청 폭은 단계로 올린다 — 300 은 480 과 같은 사본
      expect((await page.request.get(`/api/files/${file.id}/thumb?w=300`, { headers: WEBP_ACCEPT })).headers()["x-thumb-cache"]).toBe("hit")

      const raw = await page.request.get(file.path)
      expect(raw.headers()["content-type"]).toBe("image/jpeg")
      expect((await raw.body()).equals(photo)).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  test("같은 사진을 동시에 여러 번 불러도 모두 같은 미리보기를 받는다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const file = await upload(page, "동시.jpg", "image/jpeg", photo)
      const all = await Promise.all(Array.from({ length: 6 }, () => page.request.get(`/api/files/${file.id}/thumb?w=240`, { headers: WEBP_ACCEPT })))
      expect(all.map((r) => r.status())).toEqual([200, 200, 200, 200, 200, 200])
      const bodies = await Promise.all(all.map((r) => r.body()))
      for (const b of bodies) expect(b.equals(bodies[0])).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  test("WebP 를 못 받는 브라우저 · GIF 는 원본으로, SVG 는 미리보기가 없다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const jpg = await upload(page, "옛.jpg", "image/jpeg", photo)
      const old = await page.request.get(`/api/files/${jpg.id}/thumb?w=480`, { headers: OLD_ACCEPT, maxRedirects: 0 })
      expect(old.status()).toBe(302)
      expect(new URL(old.headers()["location"]).pathname).toBe(`/api/files/${jpg.id}/raw`)

      const gif = await upload(page, "움짤.gif", "image/gif", await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } }).gif().toBuffer())
      const g = await page.request.get(`/api/files/${gif.id}/thumb?w=480`, { headers: WEBP_ACCEPT, maxRedirects: 0 })
      expect(g.status()).toBe(302)
      expect(new URL(g.headers()["location"]).pathname).toBe(`/api/files/${gif.id}/raw`)

      const svg = await upload(page, "그림.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'))
      const s = await page.request.get(`/api/files/${svg.id}/thumb?w=480`, { headers: WEBP_ACCEPT, maxRedirects: 0 })
      expect(s.status()).toBe(415)
      expect(s.headers()["x-content-type-options"]).toBe("nosniff")

      // 깨진 JPEG — 만들지 못하면 원본으로
      const broken = await upload(page, "깨짐.jpg", "image/jpeg", Buffer.from("not really a jpeg"))
      const b = await page.request.get(`/api/files/${broken.id}/thumb?w=480`, { headers: WEBP_ACCEPT, maxRedirects: 0 })
      expect(b.status()).toBe(302)
    } finally {
      await ctx.close()
    }
  })

  test("거부 — 남의 비공개 첨부 미리보기는 raw 와 같이 404, 로그인 없이는 401", async ({ browser }) => {
    const owner = await as(browser, "팀장")
    const other = await as(browser, "사원1")
    try {
      const file = await upload(owner.page, "비공개.jpg", "image/jpeg", photo, "private")
      expect((await owner.page.request.get(`/api/files/${file.id}/thumb?w=240`, { headers: WEBP_ACCEPT })).headers()["cache-control"]).toBe("private, no-store")
      expect((await other.page.request.get(`/api/files/${file.id}/thumb?w=240`, { headers: WEBP_ACCEPT })).status()).toBe(404)
      expect((await other.page.request.get(file.path)).status()).toBe(404)
      const anon = await browser.newContext()
      expect((await anon.request.get(`/api/files/${file.id}/thumb?w=240`, { headers: WEBP_ACCEPT, maxRedirects: 0 })).status()).toBe(401)
      await anon.close()
    } finally {
      await owner.ctx.close()
      await other.ctx.close()
    }
  })

  for (const [name, use] of [
    ["PC", { viewport: { width: 1440, height: 900 } }],
    ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ] as const) {
    test.describe(name, () => {
      test.use(use)

      test("말풍선은 WebP 미리보기를 srcset 으로 그리고, 누르면 원본을 연다. 미리보기가 실패하면 원본으로 그린다", async ({ browser }) => {
        const { ctx, page } = await as(browser, "팀장")
        try {
          const { roomId } = await (await page.request.post("/api/chat/self-room")).json()
          const me = ((await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]).find((u) => u.name === "팀장")!.id
          const ok = await upload(page, `미리보기-${name}.jpg`, "image/jpeg", photo)
          const fail = await upload(page, `실패-${name}.jpg`, "image/jpeg", photo)
          const message = await prisma.chatMessage.create({ data: { roomId, authorId: me, content: "미리보기 시험" } })
          await prisma.file.updateMany({ where: { id: { in: [ok.id, fail.id] } }, data: { messageId: message.id } })
          await page.route(`**/api/files/${fail.id}/thumb*`, (route) => route.fulfill({ status: 500, body: "" }))

          const thumbs: string[] = []
          page.on("response", (r) => {
            if (r.url().includes(`/api/files/${ok.id}/`)) thumbs.push(`${new URL(r.url()).pathname}${new URL(r.url()).search} ${r.headers()["content-type"]}`)
          })
          await page.goto(`/chat/${roomId}`)
          const image = page.locator(`img[alt="미리보기-${name}.jpg"]`)
          await expect(image).toBeVisible({ timeout: 15_000 })
          await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
          expect(await image.getAttribute("srcset")).toContain(`/api/files/${ok.id}/thumb?w=480 480w`)
          expect(await image.evaluate((el: HTMLImageElement) => new URL(el.currentSrc).pathname)).toBe(`/api/files/${ok.id}/thumb`)
          expect(thumbs.every((t) => t.startsWith(`/api/files/${ok.id}/thumb?w=`) && t.endsWith("image/webp"))).toBe(true)
          await expect(image.locator("xpath=ancestor::a[1]")).toHaveAttribute("href", ok.path)

          const fallback = page.locator(`img[alt="실패-${name}.jpg"]`)
          await expect(fallback).toHaveAttribute("src", fail.path)
          await expect.poll(() => fallback.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)

          await prisma.file.updateMany({ where: { messageId: message.id }, data: { messageId: null } })
          await prisma.chatMessage.delete({ where: { id: message.id } })
        } finally {
          await ctx.close()
        }
      })
    })
  }
})
