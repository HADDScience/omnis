/**
 * 파일을 내보내는 경로의 응답 헤더 · 미리보기 · 권한. 규칙의 단위 시험: lib/file-serving.test.ts
 * 가짜 NAS(scripts/e2e-fake-nas.mjs)가 떠 있을 때만 돈다 — CI 는 띄운다.
 */
import { expect, request, test, type APIRequestContext, type APIResponse, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { signDownloadLink } from "../../lib/omnis-mcp"
import { login, type DemoUser } from "./_setup"

const NAS = process.env.E2E_FAKE_NAS_URL
const BASE_PATH = process.env.SYNOLOGY_WEBDAV_BASE_PATH ?? "/e2e-files"
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
)
const PLAIN_HTML = Buffer.from("<!doctype html><title>시험</title><p>시험 문서</p>")
const PLAIN_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')

function expectServed(res: APIResponse, want: { type: string; disposition: "inline" | "attachment"; name?: string }) {
  const h = res.headers()
  expect(res.status(), "상태").toBe(200)
  expect(h["x-content-type-options"], "nosniff").toBe("nosniff")
  expect(h["content-type"], "형식").toBe(want.type)
  expect(h["content-disposition"], "열기 방식").toMatch(new RegExp(`^${want.disposition}; filename\\*=UTF-8''`))
  if (want.name) expect(decodeURIComponent(h["content-disposition"].split("''")[1]), "파일명").toBe(want.name)
}

async function as(browser: Browser, name: DemoUser) {
  const ctx = await browser.newContext({ acceptDownloads: true })
  const page = await ctx.newPage()
  await login(page, name)
  return { ctx, page }
}

test.describe("파일 응답 헤더", () => {
  test.skip(!NAS, "가짜 NAS 가 없다(E2E_FAKE_NAS_URL)")

  const prisma = new PrismaClient()
  let nas: APIRequestContext
  const fileIds: string[] = []

  async function upload(page: Page, name: string, mimeType: string, buffer: Buffer, scope?: "private") {
    const res = await page.request.post("/api/files", {
      multipart: { file: { name, mimeType, buffer }, ...(scope ? { scope } : {}) },
    })
    expect(res.status(), `${name} 올리기`).toBe(201)
    const record = (await res.json()) as { id: string; path: string }
    fileIds.push(record.id)
    return record
  }

  const seed = (path: string, data: Buffer) =>
    nas.put(`${NAS}${path.split("/").map(encodeURIComponent).join("/")}`, { data })

  test.beforeAll(async () => {
    nas = await request.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await prisma.file.deleteMany({ where: { id: { in: fileIds } } })
    await nas.dispose()
    await prisma.$disconnect()
  })

  test("올린 파일 — 안전 목록만 그 자리에서 열고, 저장된 형식을 그대로 돌려주지 않는다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const cases: [string, string, Buffer, string, "inline" | "attachment"][] = [
        ["사진 (최종)'안.png", "image/png", PNG, "image/png", "inline"],
        ["a.jpg", "image/jpeg", PNG, "image/jpeg", "inline"],
        ["a.gif", "image/gif", PNG, "image/gif", "inline"],
        ["a.webp", "image/webp", PNG, "image/webp", "inline"],
        ["회의 자료.pdf", "application/pdf", PNG, "application/pdf", "inline"],
        ["영상.mp4", "video/mp4", PNG, "video/mp4", "inline"],
        ["녹음.mp3", "audio/mpeg", PNG, "audio/mpeg", "inline"],
        ["이름으로_찾기.png", "application/octet-stream", PNG, "image/png", "inline"],
        // 거부되어야 하는 경우
        ["문서.html", "text/html", PLAIN_HTML, "application/octet-stream", "attachment"],
        ["그림.svg", "image/svg+xml", PLAIN_SVG, "application/octet-stream", "attachment"],
        ["자료.xml", "text/xml", PLAIN_SVG, "application/octet-stream", "attachment"],
        ["코드.js", "text/javascript", PLAIN_HTML, "application/octet-stream", "attachment"],
        ["메모.txt", "text/plain", PLAIN_HTML, "application/octet-stream", "attachment"],
        ["형식_불명.html", "application/octet-stream", PLAIN_HTML, "application/octet-stream", "attachment"],
        ["확장자만_안전.png", "text/html", PLAIN_HTML, "application/octet-stream", "attachment"],
        // 형식을 안전하다고 적어도 응답 형식이 고정되고 nosniff 라 문서로 열리지 않는다
        ["형식만_안전.html", "image/png", PLAIN_HTML, "image/png", "inline"],
      ]
      for (const [name, mimeType, buffer, type, disposition] of cases) {
        const file = await upload(page, name, mimeType, buffer)
        expectServed(await page.request.get(file.path), { type, disposition, name })
      }
    } finally {
      await ctx.close()
    }
  })

  test("브라우저 — HTML · SVG 는 문서로 열리지 않고 내려받기가 되며 한글 이름을 유지한다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      for (const [name, mimeType, buffer] of [
        ["한글 문서.html", "text/html", PLAIN_HTML],
        ["한글 그림.svg", "image/svg+xml", PLAIN_SVG],
      ] as const) {
        const file = await upload(page, name, mimeType, buffer)
        const tab = await ctx.newPage()
        const download = tab.waitForEvent("download")
        await tab.goto(file.path).catch(() => {}) // 내려받기로 넘어가면 goto 는 실패로 끝난다
        expect((await download).suggestedFilename(), name).toBe(name)
        await tab.close()
      }
    } finally {
      await ctx.close()
    }
  })

  test("썸네일 — 이미지는 webp + nosniff, SVG 는 썸네일을 만들지 않는다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const png = await upload(page, "썸네일.png", "image/png", PNG)
      const thumb = await page.request.get(`${png.path}?w=96`)
      expect(thumb.status()).toBe(200)
      expect(thumb.headers()["content-type"]).toBe("image/webp")
      expect(thumb.headers()["x-content-type-options"]).toBe("nosniff")

      const svg = await upload(page, "썸네일.svg", "image/svg+xml", PLAIN_SVG)
      expectServed(await page.request.get(`${svg.path}?w=96`), { type: "application/octet-stream", disposition: "attachment" })
    } finally {
      await ctx.close()
    }
  })

  test("채팅 — 이미지 미리보기가 그려지고, SVG 는 깨진 이미지 대신 파일 카드로 나온다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const { roomId } = await (await page.request.post("/api/chat/self-room")).json()
      const me = ((await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]).find((u) => u.name === "팀장")!.id
      const png = await upload(page, "미리보기.png", "image/png", PNG)
      const svg = await upload(page, "카드.svg", "image/svg+xml", PLAIN_SVG)
      const message = await prisma.chatMessage.create({ data: { roomId, authorId: me, content: "첨부 미리보기 시험" } })
      await prisma.file.updateMany({ where: { id: { in: [png.id, svg.id] } }, data: { messageId: message.id } })

      await page.goto(`/chat/${roomId}`)
      const image = page.locator('img[alt="미리보기.png"]')
      await expect(image).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
      await expect(page.locator('img[alt="카드.svg"]')).toHaveCount(0)
      await expect(page.getByRole("link", { name: /카드\.svg/ })).toBeVisible()
      await prisma.file.updateMany({ where: { messageId: message.id }, data: { messageId: null } })
      await prisma.chatMessage.delete({ where: { id: message.id } })
    } finally {
      await ctx.close()
    }
  })

  test("동영상 — 올린 영상이 <video> 로 재생된다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      // 시험용 영상을 저장소에 두지 않으려고 이 자리에서 녹화한다
      const bytes = await page.evaluate(async () => {
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = 16
        const draw = canvas.getContext("2d")!
        const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: "video/webm" })
        const chunks: Blob[] = []
        recorder.ondataavailable = (e) => chunks.push(e.data)
        const stopped = new Promise((resolve) => (recorder.onstop = resolve))
        recorder.start()
        for (let i = 0; i < 5; i++) {
          draw.fillStyle = i % 2 ? "#00f" : "#f00"
          draw.fillRect(0, 0, 16, 16)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        recorder.stop()
        await stopped
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
      })
      const file = await upload(page, "재생.webm", "video/webm", Buffer.from(bytes))
      expectServed(await page.request.get(file.path), { type: "video/webm", disposition: "inline", name: "재생.webm" })
      const played = await page.evaluate(async (src) => {
        const video = document.createElement("video")
        video.muted = true
        video.src = src
        return await new Promise<boolean>((resolve) => {
          video.onloadeddata = () => resolve(true)
          video.onerror = () => resolve(false)
        })
      }, file.path)
      expect(played, "영상을 읽었다").toBe(true)
    } finally {
      await ctx.close()
    }
  })

  test("권한 — 비공개 파일은 올린 사람만, 로그인 없이는 아무도 받지 못한다", async ({ browser }) => {
    const owner = await as(browser, "팀장")
    const other = await as(browser, "사원2")
    const anonymous = await request.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const file = await upload(owner.page, "비공개.png", "image/png", PNG, "private")
      const mine = await owner.page.request.get(file.path)
      expectServed(mine, { type: "image/png", disposition: "inline" })
      expect(mine.headers()["cache-control"]).toBe("private, no-store")
      expect((await other.page.request.get(file.path)).status()).toBe(404)
      expect((await anonymous.get(file.path)).status()).toBe(401)
    } finally {
      await anonymous.dispose()
      await owner.ctx.close()
      await other.ctx.close()
    }
  })

  test("NAS 열람 — 안전 목록만 그 자리에서 열고 SVG · 글 파일은 내려받는다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "사원2")
    try {
      for (const [name, data, type, disposition] of [
        ["그림.png", PNG, "image/png", "inline"],
        ["자료.pdf", PNG, "application/pdf", "inline"],
        ["그림.svg", PLAIN_SVG, "application/octet-stream", "attachment"],
        ["문서.html", PLAIN_HTML, "application/octet-stream", "attachment"],
        ["메모.txt", PLAIN_HTML, "application/octet-stream", "attachment"],
      ] as const) {
        const path = `/HADD Science/e2e/${name}`
        expect((await seed(path, data)).status()).toBe(201)
        expectServed(await page.request.get(`/api/nas?path=${encodeURIComponent(path)}`), { type, disposition, name })
      }
    } finally {
      await ctx.close()
    }
  })

  test("셸 내려받기 링크 — 항상 내려받기이고 저장된 형식을 돌려주지 않는다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    try {
      const me = ((await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]).find((u) => u.name === "팀장")!.id
      const html = await upload(page, "링크.html", "text/html", PLAIN_HTML)
      const png = await upload(page, "링크.png", "image/png", PNG)
      expectServed(await page.request.get(`/api/ip-mcp/download?t=${signDownloadLink(me, html.id)}`), {
        type: "application/octet-stream", disposition: "attachment", name: "링크.html",
      })
      expectServed(await page.request.get(`/api/ip-mcp/download?t=${signDownloadLink(me, png.id)}`), {
        type: "image/png", disposition: "attachment", name: "링크.png",
      })
    } finally {
      await ctx.close()
    }
  })

  test("세금계산서 · 서명 · 사이트 사진 — 같은 규칙을 따른다", async ({ browser }) => {
    const { ctx, page } = await as(browser, "팀장")
    const suffix = Date.now()
    const invoice = (objectKey: string, n: number) => prisma.taxInvoice.create({
      data: {
        approvalNo: `e2e-${suffix}-${n}`, direction: "SALE", issuedOn: new Date(), supplierBizNo: "1", supplierName: "시험",
        buyerBizNo: "2", buyerName: "시험", supplyKrw: 1, taxKrw: 0, totalKrw: 1, objectKey, fileName: `계산서${n}`, readBy: "text", checks: {},
      },
    })
    const staff = await prisma.staffProfile.create({ data: { name: `e2e-헤더-${suffix}`, affiliation: "시험" } })
    try {
      // 세금계산서
      await seed(`${BASE_PATH}/e2e/invoice.pdf`, PNG)
      await seed(`${BASE_PATH}/e2e/invoice.html`, PLAIN_HTML)
      const pdf = await invoice("e2e/invoice.pdf", 1)
      const html = await invoice("e2e/invoice.html", 2)
      expectServed(await page.request.get(`/api/crm/invoices/${pdf.id}/file`), { type: "application/pdf", disposition: "inline" })
      expectServed(await page.request.get(`/api/crm/invoices/${html.id}/file`), { type: "application/octet-stream", disposition: "attachment" })

      // 서명 — 복사는 inline(클립보드에 넣으려고 이미지 형식이 살아 있어야 한다), 내려받기는 attachment
      await seed(`${BASE_PATH}/staff/e2e.png`, PNG)
      const asset = await prisma.staffAsset.create({
        data: { staffId: staff.id, kind: "SIGNATURE", objectKey: "staff/e2e.png", fileName: "e2e.png", mimeType: "image/png", size: PNG.length },
      })
      expectServed(await page.request.get(`/api/company/staff-assets/${asset.id}?purpose=copy`), { type: "image/png", disposition: "inline" })
      expectServed(await page.request.get(`/api/company/staff-assets/${asset.id}?purpose=download`), { type: "image/png", disposition: "attachment" })

      // 사이트 사진 — 로그인 없이 열리는 공개 경로. 긴 캐시를 유지한다
      const postId = String(suffix)
      await seed(`${BASE_PATH}/website/${postId}/a.webp`, PNG)
      await seed(`${BASE_PATH}/website/${postId}/a.svg`, PLAIN_SVG)
      await prisma.websiteMedia.createMany({
        data: [
          { postId, key: `website/${postId}/a.webp`, contentType: "image/webp", size: PNG.length },
          { postId, key: `website/${postId}/a.svg`, contentType: "image/svg+xml", size: PLAIN_SVG.length },
        ],
      })
      const photo = await page.request.get(`/api/website/media/${postId}/a.webp`)
      expectServed(photo, { type: "image/webp", disposition: "inline", name: "a.webp" })
      expect(photo.headers()["cache-control"]).toContain("immutable")
      expectServed(await page.request.get(`/api/website/media/${postId}/a.svg`), { type: "application/octet-stream", disposition: "attachment" })
    } finally {
      await prisma.taxInvoice.deleteMany({ where: { approvalNo: { startsWith: `e2e-${suffix}-` } } })
      await prisma.websiteMedia.deleteMany({ where: { postId: String(suffix) } })
      await prisma.staffProfile.delete({ where: { id: staff.id } })
      await ctx.close()
    }
  })
})
