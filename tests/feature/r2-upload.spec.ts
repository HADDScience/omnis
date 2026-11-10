/**
 * 큰 첨부 — R2(S3 호환) 직접 올리기 · 열람.
 *
 * R2_E2E=1 일 때만 돈다. 실제 R2 대신 로컬 S3 호환 서버(MinIO)를 띄우고, 서버 · playwright 양쪽에 같은 값을 준다:
 *   LARGE_UPLOAD_ENABLED=1 LARGE_UPLOAD_BACKEND=r2 R2_ENDPOINT=http://127.0.0.1:9200 R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
 * 데모 빌드의 파일 경로를 열려면 가짜 NAS(scripts/e2e-fake-nas.mjs)의 env 도 함께 준다. 절차: mydocs/manual/r2-upload.md §시험
 * 규칙의 단위 시험: lib/r2/rules.test.ts · lib/large-upload/session.test.ts
 */
import { createHash, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { ListMultipartUploadsCommand, S3Client } from "@aws-sdk/client-s3"
import { chromium, devices, expect, request, test, type Browser, type Page, type Request } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const ON = process.env.R2_E2E === "1"
const MiB = 1024 * 1024
const ENDPOINT = process.env.R2_ENDPOINT ?? ""
const BUCKET = process.env.R2_BUCKET ?? ""

test.describe("큰 첨부 R2 — 켜져 있을 때", () => {
  test.skip(!ON, "R2_E2E=1 과 로컬 S3 호환 서버로 돌린다")
  test.setTimeout(15 * 60_000)

  const prisma = new PrismaClient()
  const s3 = ON
    ? new S3Client({ endpoint: ENDPOINT, region: "auto", forcePathStyle: true, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } })
    : (null as unknown as S3Client)
  const dir = ON ? mkdtempSync(join(tmpdir(), "omnis-r2-e2e-")) : ""

  test.afterAll(async () => {
    await prisma.$disconnect()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  /** 디스크에 임의 바이트 파일을 쓰고 해시를 돌려준다 — 300MB 를 메모리에 올리지 않는다 */
  async function synthetic(name: string, bytes: number) {
    const path = join(dir, name)
    const out = createWriteStream(path)
    const h = createHash("sha256")
    for (let left = bytes; left > 0; ) {
      const chunk = randomBytes(Math.min(left, 4 * MiB))
      h.update(chunk)
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r))
      left -= chunk.length
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
    return { path, name, size: bytes, hash: h.digest("hex") }
  }

  async function sliceHash(path: string, start: number, end: number) {
    const h = createHash("sha256")
    for await (const c of createReadStream(path, { start, end })) h.update(c as Buffer)
    return h.digest("hex")
  }

  async function urlHash(url: string, headers: Record<string, string> = {}) {
    const res = await fetch(url, { headers })
    const h = createHash("sha256")
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) h.update(c)
    return { status: res.status, headers: res.headers, hash: h.digest("hex") }
  }

  async function as(browser: Browser, name: DemoUser) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, name)
    return { ctx, page }
  }

  /**
   * 조각 PUT 을 page.route 로 끊거나 붙잡는 시험용 화면. WebKit 은 교차 출처 XHR PUT 이 page.route 를 거치지 않아(2026-11-10 확인)
   * mobile(iPhone 13 · WebKit) 프로젝트에서는 같은 기기 값으로 Chromium 을 띄운다(A-lab 폰 에뮬레이션과 같은 방식).
   */
  async function routablePage(given: Page, browserName: string, baseURL: string | undefined) {
    if (browserName !== "webkit") return { page: given, close: async () => {} }
    const { defaultBrowserType, ...phone } = devices["iPhone 13"]
    void defaultBrowserType // WebKit 대신 Chromium 으로 띄운다
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ ...phone, baseURL })
    return { page: await ctx.newPage(), close: () => browser.close() }
  }

  async function openSelfRoom(page: Page) {
    const { roomId } = (await (await page.request.post("/api/chat/self-room")).json()) as { roomId: string }
    await page.goto(`/chat/${roomId}`)
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: 20_000 })
    return roomId
  }

  async function attach(page: Page, filePath: string) {
    const name = filePath.split("/").pop() as string
    const input = page.locator("[data-composer-file-input]").first()
    await expect(async () => {
      await input.setInputFiles([])
      await input.setInputFiles(filePath)
      await expect(page.getByRole("button", { name: `${name} 빼기` })).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
  }

  async function sendWith(page: Page, filePath: string | null, text: string) {
    if (filePath) await attach(page, filePath)
    const box = page.locator("textarea").first()
    await box.fill(text)
    // 폰(터치)에서는 Enter 가 줄바꿈이다 — 보내기 단추를 누른다
    await page.getByRole("button", { name: "보내기", exact: true }).click()
    await expect(box).toHaveValue("", { timeout: 10_000 })
  }

  type Msg = { id: string; content: string; files: { id: string; name: string; path: string; size: number }[] }
  const messagesOf = async (page: Page, roomId: string) => (await (await page.request.get(`/api/chat/messages?roomId=${roomId}`)).json()) as Msg[]

  async function waitForFile(page: Page, roomId: string, text: string) {
    let found: Msg["files"][number] | undefined
    await expect
      .poll(async () => {
        found = (await messagesOf(page, roomId)).find((m) => m.content === text)?.files[0]
        return Boolean(found)
      }, { timeout: 10 * 60_000, intervals: [1_000] })
      .toBe(true)
    return found!
  }

  const isPartPut = (req: Request) => req.method() === "PUT" && req.url().startsWith(ENDPOINT) && req.url().includes("partNumber=")
  const partOf = (req: Request) => Number(new URL(req.url()).searchParams.get("partNumber"))

  /** 앱 서버로 간 요청 본문의 합 — 파일 바이트가 함수를 지나지 않음을 본다 */
  function watchAppBodies(page: Page, origin: string) {
    const seen = { bytes: 0, largest: 0, partPuts: 0, partPutsOk: 0 }
    page.on("request", (req) => {
      if (req.url().startsWith(origin)) {
        const n = req.postDataBuffer()?.length ?? 0
        seen.bytes += n
        seen.largest = Math.max(seen.largest, n)
      }
      if (isPartPut(req)) seen.partPuts++
    })
    page.on("requestfinished", async (req) => {
      if (isPartPut(req) && (await req.response())?.status() === 200) seen.partPutsOk++
    })
    return seen
  }

  test("300MB — 바이트는 브라우저에서 저장소로 바로 가고, 첨부는 권한을 본 뒤 서명 주소로 열린다", async ({ page, browser, baseURL }, info) => {
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = await synthetic(`큰 자료 ${info.project.name}.bin`, 300 * MiB)
    const seen = watchAppBodies(page, baseURL!)
    const stamp = Date.now()
    const t0 = Date.now()

    await sendWith(page, file.path, `R2 300MB ${stamp}`)
    await expect(page.locator("[data-large-upload-status]")).toBeVisible({ timeout: 15_000 })
    const uploaded = await waitForFile(page, roomId, `R2 300MB ${stamp}`)
    const ms = Date.now() - t0
    console.log(`[r2-e2e] ${info.project.name} 300MB ${ms}ms · 조각 PUT ${seen.partPuts} · 앱으로 간 본문 합 ${seen.bytes}B (가장 큰 것 ${seen.largest}B)`)

    expect(uploaded.size).toBe(file.size)
    expect(seen.partPutsOk).toBe(19)
    expect(seen.largest, "앱 서버로는 서명 요청 JSON 만 간다").toBeLessThan(64 * 1024)

    const row = await prisma.fileR2Object.findUniqueOrThrow({ where: { fileId: uploaded.id }, include: { file: { select: { privateToUserId: true } } } })
    expect(row.key, "저장 키에 파일 이름이 없다").toBe(`uploads/${uploaded.id}/${uploaded.id}`)
    expect(row.partCount).toBe(19)
    expect(row.file.privateToUserId, "참여자 전용 방에 올린 파일").not.toBeNull()
    expect(await prisma.fileTransfer.findUnique({ where: { fileId: uploaded.id } }), "Blob → NAS 복사 표는 없다").toBeNull()

    // 열람 — /raw 는 바이트 없이 302 로 서명 주소를 준다
    const raw = await page.request.get(uploaded.path, { maxRedirects: 0 })
    expect(raw.status()).toBe(302)
    expect(raw.headers()["cache-control"]).toBe("private, no-store")
    const location = raw.headers()["location"]
    expect(location.startsWith(`${ENDPOINT}/${BUCKET}/uploads/${uploaded.id}/`)).toBe(true)
    expect(location).toContain("X-Amz-Expires=1800")
    expect((await raw.body()).length).toBe(0)
    const whole = await urlHash(location)
    expect(whole.status).toBe(200)
    expect(whole.hash).toBe(file.hash)

    // Range — 저장소가 206 으로 답한다
    const start = 123 * MiB + 7
    const part = await urlHash(location, { Range: `bytes=${start}-${start + 999_999}` })
    expect(part.status).toBe(206)
    expect(part.headers.get("content-range")).toBe(`bytes ${start}-${start + 999_999}/${file.size}`)
    expect(part.hash).toBe(await sliceHash(file.path, start, start + 999_999))

    // 서명을 바꾸면 거절된다
    expect((await fetch(location.replace(/X-Amz-Signature=[0-9a-f]{4}/, "X-Amz-Signature=0000"))).status).toBe(403)

    // 권한 — 로그인 없이는 401, 방이 아닌 사람은 없는 파일(404). 서명 주소도 주지 않는다
    const anonymous = await request.newContext({ baseURL })
    expect((await anonymous.get(uploaded.path, { maxRedirects: 0 })).status()).toBe(401)
    await anonymous.dispose()
    const other = await as(browser, "사원2")
    const denied = await other.page.request.get(uploaded.path, { maxRedirects: 0 })
    expect(denied.status()).toBe(404)
    expect(denied.headers()["location"]).toBeUndefined()
    await other.ctx.close()
  })

  test("조각 첫 시도가 끊겨도 다시 보내 끝낸다", async ({ page: given, browserName, baseURL }) => {
    const { page, close } = await routablePage(given, browserName, baseURL)
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = await synthetic("조각 끊김.bin", 50 * MiB)
    const failed: number[] = []
    await page.route((url) => url.href.startsWith(ENDPOINT) && url.searchParams.has("partNumber"), (route) => {
      const n = Number(new URL(route.request().url()).searchParams.get("partNumber"))
      if (route.request().method() === "PUT" && (n === 2 || n === 3) && !failed.includes(n)) {
        failed.push(n)
        return route.abort("connectionreset")
      }
      return route.continue()
    })
    const stamp = Date.now()
    await sendWith(page, file.path, `R2 끊김 ${stamp}`)
    const uploaded = await waitForFile(page, roomId, `R2 끊김 ${stamp}`)
    expect(failed.sort()).toEqual([2, 3])
    const raw = await page.request.get(uploaded.path, { maxRedirects: 0 })
    expect((await urlHash(raw.headers()["location"])).hash).toBe(file.hash)
    await close()
  })

  test("새로 고친 뒤 같은 파일을 다시 고르면 저장소에 남은 조각은 건너뛴다", async ({ page: given, browserName, baseURL }) => {
    const { page, close } = await routablePage(given, browserName, baseURL)
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = await synthetic("이어 올리기 R2.bin", 100 * MiB) // 7조각
    // 앞 두 조각만 보내고 나머지는 붙잡아 둔다 — 그 사이 새로 고친다
    let hold = true
    const sentOk = new Set<number>()
    await page.route((url) => url.href.startsWith(ENDPOINT) && url.searchParams.has("partNumber"), async (route) => {
      const n = Number(new URL(route.request().url()).searchParams.get("partNumber"))
      if (route.request().method() === "PUT" && hold && n > 2) return // 응답하지 않는다(끊긴 연결처럼)
      return route.continue()
    })
    page.on("requestfinished", async (req) => {
      if (isPartPut(req) && (await req.response())?.status() === 200) sentOk.add(partOf(req))
    })
    const stamp = Date.now()
    await sendWith(page, file.path, `R2 이어 ${stamp}`)
    await expect.poll(() => sentOk.size, { timeout: 60_000 }).toBe(2)
    await page.reload()
    hold = false
    await expect(page.getByText(/같은 파일을 다시 첨부하면 이어서 올립니다/)).toBeVisible({ timeout: 20_000 })

    const after: number[] = []
    page.on("request", (req) => {
      if (isPartPut(req)) after.push(partOf(req))
    })
    await sendWith(page, file.path, `R2 이어 ${stamp}`)
    const uploaded = await waitForFile(page, roomId, `R2 이어 ${stamp}`)
    console.log(`[r2-e2e] 새로 고치기 전 끝난 조각 ${[...sentOk].join(",")} · 뒤에 보낸 조각 ${after.sort((a, b) => a - b).join(",")}`)
    expect(after.sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7])
    const raw = await page.request.get(uploaded.path, { maxRedirects: 0 })
    expect((await urlHash(raw.headers()["location"])).hash).toBe(file.hash)
    await expect(page.getByText(/같은 파일을 다시 첨부하면 이어서 올립니다/)).toHaveCount(0)
    await close()
  })

  test("올리는 도중 네트워크가 4초 끊겨도 이어서 끝낸다(회선 PC 50 · 폰 20Mbps 묶음)", async ({ page: given, browserName, baseURL }, info) => {
    const { page, close } = await routablePage(given, browserName, baseURL)
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = await synthetic("끊김 4초.bin", 100 * MiB)
    const cdp = await page.context().newCDPSession(page)
    const upMbps = info.project.name === "mobile" ? 20 : 50
    const throttle = () => cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 30, downloadThroughput: (100 * 1e6) / 8, uploadThroughput: (upMbps * 1e6) / 8 })
    await cdp.send("Network.enable")
    await throttle()
    let ok = 0
    page.on("requestfinished", async (req) => {
      if (isPartPut(req) && (await req.response())?.status() === 200) ok++
    })
    const stamp = Date.now()
    const t0 = Date.now()
    await sendWith(page, file.path, `R2 4초 ${stamp}`)
    await expect.poll(() => ok, { timeout: 120_000 }).toBeGreaterThanOrEqual(2)
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await page.waitForTimeout(4_000)
    await throttle()
    const uploaded = await waitForFile(page, roomId, `R2 4초 ${stamp}`)
    console.log(`[r2-e2e] ${info.project.name} 100MB ${upMbps}Mbps · 4초 끊김 포함 ${Date.now() - t0}ms`)
    const raw = await page.request.get(uploaded.path, { maxRedirects: 0 })
    expect((await urlHash(raw.headers()["location"])).hash).toBe(file.hash)
    await close()
  })

  test("멈추고 버리면 저장소의 조각도 지운다", async ({ page: given, browserName, baseURL }) => {
    const { page, close } = await routablePage(given, browserName, baseURL)
    await login(page, "팀장")
    await openSelfRoom(page)
    const file = await synthetic("버리기 R2.bin", 60 * MiB)
    await page.route((url) => url.href.startsWith(ENDPOINT) && url.searchParams.has("partNumber"), async (route) => {
      const n = Number(new URL(route.request().url()).searchParams.get("partNumber"))
      if (route.request().method() === "PUT" && n > 1) return
      return route.continue()
    })
    const created = page.waitForResponse((r) => r.url().endsWith("/api/uploads") && r.status() === 201)
    await sendWith(page, file.path, "멈출 R2 글")
    const { pathname } = (await (await created).json()) as { pathname: string }
    await expect.poll(async () => (await s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: pathname }))).Uploads?.length ?? 0).toBe(1)
    await page.getByRole("button", { name: /버리기 R2.bin 올리기 멈추기/ }).click()
    await expect(page.locator("textarea").first()).toHaveValue("멈출 R2 글", { timeout: 15_000 })
    await page.getByRole("button", { name: "버리기", exact: true }).click()
    await expect.poll(async () => (await s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: pathname }))).Uploads?.length ?? 0, { timeout: 15_000 }).toBe(0)
    await close()
  })

  test("영상 — 서명 주소로 재생하고 탐색은 범위 요청(206)으로 간다", async ({ page }) => {
    test.skip(!process.env.FFMPEG && !hasFfmpeg(), "ffmpeg 가 없다")
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const path = join(dir, "탐색 시험.mp4")
    // 1080p 60초 8Mbps — 4MB 를 넘어 큰 첨부로 간다. faststart 로 앞에 목차를 둔다
    execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30", "-t", "60", "-c:v", "libx264", "-b:v", "8M", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path])
    const stamp = Date.now()
    await sendWith(page, path, `R2 영상 ${stamp}`)
    const uploaded = await waitForFile(page, roomId, `R2 영상 ${stamp}`)

    const ranges: { status: number; range: string | null }[] = []
    page.on("response", (res) => {
      if (res.url().startsWith(`${ENDPOINT}/${BUCKET}/uploads/${uploaded.id}/`)) ranges.push({ status: res.status(), range: res.request().headers()["range"] ?? null })
    })
    const seek = await page.evaluate(async (src) => {
      const v = document.createElement("video")
      v.muted = true
      v.preload = "metadata"
      v.src = src
      document.body.append(v)
      await new Promise((r, j) => {
        v.onloadedmetadata = r
        v.onerror = () => j(new Error(`video error ${v.error?.code}`))
      })
      const t = performance.now()
      v.currentTime = 45
      await new Promise((r) => (v.onseeked = r))
      return { duration: Math.round(v.duration), at: Math.round(v.currentTime), ms: Math.round(performance.now() - t) }
    }, uploaded.path)
    console.log(`[r2-e2e] 영상 탐색 ${JSON.stringify(seek)} · 응답 ${JSON.stringify(ranges.slice(0, 6))}`)
    expect(seek.duration).toBe(60)
    expect(seek.at).toBe(45)
    expect(ranges.some((r) => r.status === 206), "범위 응답").toBe(true)
    // 형식은 서명에 넣은 값(우리 표)으로 답한다
    const raw = await page.request.get(uploaded.path, { maxRedirects: 0 })
    const head = await fetch(raw.headers()["location"], { headers: { Range: "bytes=0-0" } })
    expect(head.headers.get("content-type")).toBe("video/mp4")
    expect(head.headers.get("content-disposition")).toMatch(/^inline; filename\*=UTF-8''/)
  })

  test("HTML 을 올려도 내려받기로 나간다(#155) — 저장소가 우리 형식으로 답한다", async ({ page }) => {
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = await synthetic("문서 R2.html", 5 * MiB)
    const stamp = Date.now()
    await sendWith(page, file.path, `R2 html ${stamp}`)
    const uploaded = await waitForFile(page, roomId, `R2 html ${stamp}`)
    const raw = await page.request.get(uploaded.path, { maxRedirects: 0 })
    expect(raw.headers()["x-content-type-options"]).toBe("nosniff")
    const res = await fetch(raw.headers()["location"])
    expect(res.headers.get("content-type")).toBe("application/octet-stream")
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/)
    await res.body?.cancel()
  })

  test("거부: 크기 · 남의 세션 · 위조 · 조각 번호", async ({ page, browser }) => {
    await login(page, "팀장")
    const open = (size: number) => page.request.post("/api/uploads", { data: { name: "a.bin", size, mimeType: "" } })
    expect((await open(4 * MiB)).status(), "4MB 이하는 일반 첨부").toBe(400)
    expect((await open(300 * MiB + 1)).status(), "300MB 초과").toBe(413)

    const opened = (await (await open(40 * MiB)).json()) as { backend: string; session: string; pathname: string; partBytes: number }
    expect(opened.backend).toBe("r2")
    expect(opened.partBytes).toBe(16 * MiB)
    const sign = (data: unknown, p: Page = page) => p.request.post("/api/uploads/r2/sign", { data })
    expect((await sign({ session: opened.session, parts: [1, 2, 3] })).status()).toBe(200)
    expect((await sign({ session: opened.session, parts: [4] })).status(), "40MB 는 3조각").toBe(400)
    expect((await sign({ session: opened.session, parts: [] })).status()).toBe(400)

    const [payload, mac] = opened.session.split(".")
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString())
    const forged = `${Buffer.from(JSON.stringify({ ...raw, s: 300 * MiB })).toString("base64url")}.${mac}`
    for (const path of ["/api/uploads/r2/sign", "/api/uploads/r2/state", "/api/uploads/r2/abort", "/api/uploads/complete", "/api/uploads/token"])
      expect((await page.request.post(path, { data: { session: forged, parts: [1] } })).status(), path).toBe(410)
    // R2 세션으로 Blob 토큰은 받지 못한다
    expect((await page.request.post("/api/uploads/token", { data: { session: opened.session } })).status()).toBe(410)

    const other = await as(browser, "사원2")
    for (const path of ["/api/uploads/r2/sign", "/api/uploads/r2/state", "/api/uploads/r2/abort", "/api/uploads/complete"])
      expect((await other.page.request.post(path, { data: { session: opened.session, parts: [1] } })).status(), `남의 세션 ${path}`).toBe(410)
    await other.ctx.close()

    // 아무것도 안 올렸다 — 완료는 409, 남은 조각은 전부
    expect((await page.request.post("/api/uploads/complete", { data: { session: opened.session } })).status()).toBe(409)
    const state = (await (await page.request.post("/api/uploads/r2/state", { data: { session: opened.session } })).json()) as { done: number[]; missing: number[] }
    expect(state).toEqual({ done: [], missing: [1, 2, 3] })
    // 크기가 틀린 조각만 올리고 완료를 부르면 첨부를 만들지 않는다
    const { urls } = (await (await sign({ session: opened.session, parts: [1, 2, 3] })).json()) as { urls: Record<string, string> }
    for (const n of [1, 2]) expect((await fetch(urls[n], { method: "PUT", body: new Uint8Array(16 * MiB) })).status).toBe(200)
    expect((await fetch(urls[3], { method: "PUT", body: new Uint8Array(5) })).status).toBe(200)
    expect((await page.request.post("/api/uploads/complete", { data: { session: opened.session } })).status()).toBe(409)
    const after = (await (await page.request.post("/api/uploads/r2/state", { data: { session: opened.session } })).json()) as { missing: number[] }
    expect(after.missing, "크기가 틀린 마지막 조각은 다시 보낼 것으로 본다").toEqual([3])
    // 버리면 저장소의 업로드가 없어진다 — 다시 물으면 410(처음부터)
    expect((await page.request.post("/api/uploads/r2/abort", { data: { session: opened.session } })).status()).toBe(204)
    expect((await page.request.post("/api/uploads/r2/state", { data: { session: opened.session } })).status()).toBe(410)
  })
})

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
