/**
 * 큰 첨부(4MB 초과).
 *
 * - 꺼져 있을 때(CI 포함): 새 경로가 없다. 지금과 같다.
 * - 켜져 있을 때(LARGE_UPLOAD_E2E=1): 실제 Blob dev 스토어 · NAS _dev 시험 폴더로 끝까지 돈다. CI 에는 스토어가 없어 로컬에서만 돌린다.
 *   규칙의 단위 시험: lib/large-upload/*.test.ts
 */
import { createHash, randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { put } from "@vercel/blob/client"
import { head } from "@vercel/blob"
import { expect, request, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const ON = process.env.LARGE_UPLOAD_E2E === "1"
const MiB = 1024 * 1024
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex")

test.describe("큰 첨부 — 꺼져 있을 때", () => {
  test.skip(ON, "LARGE_UPLOAD_E2E 가 켜져 있다")

  test("새 경로가 없다", async ({ page }) => {
    await login(page, "팀장")
    for (const path of ["/api/uploads", "/api/uploads/token", "/api/uploads/complete", "/api/uploads/webhook"]) {
      const res = await page.request.post(path, { data: {} })
      expect(res.status(), path).toBe(404)
    }
  })

  test("4MB 를 넘는 파일을 일반 경로로 보내면 지금처럼 거절한다", async ({ page }) => {
    test.skip(!process.env.E2E_FAKE_NAS_URL, "가짜 NAS 가 없다(E2E_FAKE_NAS_URL)")
    await login(page, "팀장")
    const res = await page.request.post("/api/files", {
      multipart: { file: { name: "큰파일.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4 * MiB + 1) } },
    })
    expect(res.status()).toBe(413)
  })
})

test.describe("큰 첨부 — 켜져 있을 때", () => {
  test.skip(!ON, "LARGE_UPLOAD_E2E=1 로 로컬에서 돌린다")
  // 올리기 · 복사 · 15분 대기까지 본다
  test.setTimeout(30 * 60_000)

  const prisma = new PrismaClient()
  const dir = ON ? mkdtempSync(join(tmpdir(), "omnis-large-e2e-")) : ""
  const fileIds: string[] = []
  const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN as string

  function synthetic(name: string, bytes: number) {
    const data = randomBytes(bytes)
    const path = join(dir, name)
    writeFileSync(path, data)
    return { path, name, data, hash: sha(data) }
  }

  async function as(browser: Browser, name: DemoUser) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, name)
    return { ctx, page }
  }

  async function openSelfRoom(page: Page) {
    const { roomId } = (await (await page.request.post("/api/chat/self-room")).json()) as { roomId: string }
    await page.goto(`/chat/${roomId}`)
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: 20_000 })
    return roomId
  }

  async function sendWith(page: Page, filePath: string | null, text: string) {
    const box = page.locator("textarea").first()
    if (filePath) {
      // 화면이 준비되기 전에 넣은 파일은 사라진다 — 칩이 뜰 때까지 다시 넣는다.
      // 같은 파일을 그대로 넣으면 change 가 오지 않아 먼저 비운다
      const name = filePath.split("/").pop() as string
      const input = page.locator("[data-composer-file-input]").first()
      await expect(async () => {
        await input.setInputFiles([])
        await input.setInputFiles(filePath)
        await expect(page.getByRole("button", { name: `${name} 빼기` })).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
    }
    await box.fill(text)
    await box.press("Enter")
    await expect(box).toHaveValue("", { timeout: 10_000 })
  }

  async function messagesOf(page: Page, roomId: string) {
    return (await (await page.request.get(`/api/chat/messages?roomId=${roomId}`)).json()) as { id: string; content: string; files: { id: string; name: string; path: string; size: number }[] }[]
  }

  async function waitForFile(page: Page, roomId: string, text: string, timeout = 10 * 60_000) {
    let found: { id: string; path: string; size: number } | undefined
    await expect
      .poll(async () => {
        found = (await messagesOf(page, roomId)).find((m) => m.content === text)?.files[0]
        return Boolean(found)
      }, { timeout, intervals: [2_000] })
      .toBe(true)
    fileIds.push(found!.id)
    return found!
  }

  const stateOf = async (fileId: string) => (await prisma.fileTransfer.findUnique({ where: { fileId } }))?.state

  async function waitForState(fileId: string, want: string, timeout: number) {
    await expect.poll(() => stateOf(fileId), { timeout, intervals: [3_000] }).toBe(want)
  }

  test.afterAll(async () => {
    await prisma.$disconnect()
    if (dir) rmSync(dir, { recursive: true, force: true })
    // 남은 파일 id — 정리는 실행하는 쪽이 경로를 지정해 한다
    console.log(`[large-upload-e2e] files: ${fileIds.join(" ")}`)
  })

  test("올리는 동안 글을 보내고, 올라가면 곧바로 받고, NAS 로 옮겨 임시본을 지운다", async ({ page, browser }) => {
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = synthetic("큰 자료 (시험).bin", 33 * MiB + 123)
    const stamp = Date.now()

    await sendWith(page, file.path, `큰 첨부 ${stamp}`)
    // 진행 표시가 뜨고, 올리는 중에 다음 글이 먼저 서버에 닿는다
    await expect(page.locator("[data-large-upload-status]")).toBeVisible({ timeout: 15_000 })
    await sendWith(page, null, `먼저 가는 글 ${stamp}`)
    await expect.poll(async () => (await messagesOf(page, roomId)).map((m) => m.content), { timeout: 15_000 }).toContain(`먼저 가는 글 ${stamp}`)
    expect((await messagesOf(page, roomId)).map((m) => m.content), "큰 첨부 글은 아직 나가지 않았다").not.toContain(`큰 첨부 ${stamp}`)

    const uploaded = await waitForFile(page, roomId, `큰 첨부 ${stamp}`)
    await expect(page.locator("[data-large-upload-status]")).toHaveCount(0, { timeout: 15_000 })
    expect(uploaded.path).toBe(`/api/files/${uploaded.id}/raw`)
    expect(uploaded.size).toBe(file.data.length)

    // 복사 전에도 /raw 로 곧바로 열린다
    const first = await page.request.get(uploaded.path)
    expect(first.status()).toBe(200)
    expect(first.headers()["content-length"]).toBe(String(file.data.length))
    expect(first.headers()["accept-ranges"]).toBe("bytes")
    expect(sha(await first.body())).toBe(file.hash)

    const row = await prisma.fileTransfer.findUniqueOrThrow({ where: { fileId: uploaded.id } })
    expect(row.blobPathname, "임시 저장소 경로에 이름이 없다").toBe(`uploads/${uploaded.id}/${uploaded.id}`)

    // 범위 읽기 — 복사 중
    const part = await page.request.get(uploaded.path, { headers: { Range: `bytes=${20 * MiB}-${20 * MiB + 999}` } })
    expect(part.status()).toBe(206)
    expect(part.headers()["content-range"]).toBe(`bytes ${20 * MiB}-${20 * MiB + 999}/${file.data.length}`)
    expect(sha(await part.body())).toBe(sha(file.data.subarray(20 * MiB, 20 * MiB + 1000)))
    expect((await page.request.get(uploaded.path, { headers: { Range: `bytes=${file.data.length}-` } })).status()).toBe(416)

    // 권한 — 로그인 없이는 못 받고, 방이 아닌 사람은 없는 파일이다
    const anonymous = await request.newContext({ baseURL: test.info().project.use.baseURL })
    expect((await anonymous.get(uploaded.path)).status()).toBe(401)
    await anonymous.dispose()
    const other = await as(browser, "사원2")
    expect((await other.page.request.get(uploaded.path)).status()).toBe(404)
    await other.ctx.close()

    // 복사 → 대조 → VERIFIED. 읽기가 NAS 로 넘어가도 같다
    await waitForState(uploaded.id, "VERIFIED", 10 * 60_000)
    const verified = await prisma.fileTransfer.findUniqueOrThrow({ where: { fileId: uploaded.id } })
    expect(verified.segmentsDone).toBe(2)
    expect(verified.manifestSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(verified.blobDeletedAt, "VERIFIED 뒤에도 15분은 남겨 둔다").toBeNull()
    expect((await head(verified.blobPathname, { token: blobToken() })).size).toBe(file.data.length)
    const fromNas = await page.request.get(uploaded.path)
    expect(sha(await fromNas.body())).toBe(file.hash)
    const nasPart = await page.request.get(uploaded.path, { headers: { Range: `bytes=${file.data.length - 500}-` } })
    expect(nasPart.status()).toBe(206)
    expect(sha(await nasPart.body())).toBe(sha(file.data.subarray(file.data.length - 500)))

    // 15분 뒤 재대조 → 임시본 삭제. 파일은 그대로 열린다
    await waitForState(uploaded.id, "TEMP_DELETED", 20 * 60_000)
    await expect(head(verified.blobPathname, { token: blobToken() })).rejects.toThrow()
    expect(sha(await (await page.request.get(uploaded.path)).body())).toBe(file.hash)
  })

  test("끊겨도 같은 파일을 다시 고르면 남은 조각만 보낸다", async ({ page }) => {
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = synthetic("이어 올리기.bin", 40 * MiB)
    const stamp = Date.now()

    // 동시 3개 — 첫 조각들이 끝나 표에 적히면 새로 고친다
    const parts: string[] = []
    page.on("requestfinished", (req) => {
      // 사전 요청(OPTIONS)은 세지 않는다
      const number = req.headers()["x-mpu-part-number"]
      if (number && req.method() !== "OPTIONS") parts.push(number)
    })
    await sendWith(page, file.path, `이어 올리기 ${stamp}`)
    await expect.poll(() => parts.length, { timeout: 10 * 60_000, intervals: [500] }).toBeGreaterThan(0)
    const before = parts.length
    await page.reload()

    await expect(page.getByText(/같은 파일을 다시 첨부하면 이어서 올립니다/)).toBeVisible({ timeout: 20_000 })
    parts.length = 0
    await sendWith(page, file.path, `이어 올리기 ${stamp}`)
    const uploaded = await waitForFile(page, roomId, `이어 올리기 ${stamp}`)
    console.log(`[large-upload-e2e] 끊기 전 끝난 조각 ${before}, 이어서 보낸 조각 ${parts.length}`)
    expect(parts.length, "남은 조각만").toBeLessThan(3)
    expect(sha(await (await page.request.get(uploaded.path)).body())).toBe(file.hash)
    await expect(page.getByText(/같은 파일을 다시 첨부하면 이어서 올립니다/)).toHaveCount(0)
  })

  test("멈추면 말풍선을 걷고 글과 파일을 입력창에 되돌린다", async ({ page }) => {
    await login(page, "팀장")
    await openSelfRoom(page)
    const file = synthetic("멈추기.bin", 20 * MiB)
    await sendWith(page, file.path, "멈출 글")
    await page.getByRole("button", { name: /멈추기.bin 올리기 멈추기/ }).click()
    await expect(page.locator("textarea").first()).toHaveValue("멈출 글", { timeout: 15_000 })
    await expect(page.getByRole("button", { name: /멈추기.bin 빼기/ })).toBeVisible()
    await page.getByRole("button", { name: "버리기" }).first().click()
  })

  test("HTML 을 올려도 #155 규칙 그대로 내려받기로 나간다", async ({ page }) => {
    await login(page, "팀장")
    const roomId = await openSelfRoom(page)
    const file = synthetic("문서.html", 5 * MiB)
    const stamp = Date.now()
    await sendWith(page, file.path, `html ${stamp}`)
    const uploaded = await waitForFile(page, roomId, `html ${stamp}`)
    const res = await page.request.get(uploaded.path)
    const h = res.headers()
    expect(h["content-type"]).toBe("application/octet-stream")
    expect(h["content-disposition"]).toMatch(/^attachment; filename\*=UTF-8''/)
    expect(h["x-content-type-options"]).toBe("nosniff")
    expect(sha(await res.body())).toBe(file.hash)
  })

  test("거부: 크기 · 세션이 맞지 않는 요청", async ({ page, browser }) => {
    await login(page, "팀장")
    const open = (size: number) => page.request.post("/api/uploads", { data: { name: "a.bin", size, mimeType: "" } })
    expect((await open(4 * MiB)).status(), "4MB 이하는 일반 첨부").toBe(400)
    expect((await open(300 * MiB + 1)).status(), "300MB 초과").toBe(413)

    const opened = (await (await open(5 * MiB)).json()) as { session: string; pathname: string; token: string }
    // 위조 · 남의 세션
    const [payload, mac] = opened.session.split(".")
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), s: 6 * MiB })).toString("base64url")}.${mac}`
    expect((await page.request.post("/api/uploads/complete", { data: { session: forged } })).status()).toBe(410)
    expect((await page.request.post("/api/uploads/token", { data: { session: forged } })).status()).toBe(410)
    const other = await as(browser, "사원2")
    expect((await other.page.request.post("/api/uploads/complete", { data: { session: opened.session } })).status()).toBe(410)
    await other.ctx.close()
    // 아무것도 올리지 않았다
    expect((await page.request.post("/api/uploads/complete", { data: { session: opened.session } })).status()).toBe(409)
    // 올라간 크기가 다르면 첨부로 만들지 않고 임시본을 지운다
    await put(opened.pathname, Buffer.from("작은 내용"), { access: "private", token: opened.token, contentType: "application/octet-stream" } as Parameters<typeof put>[2])
    expect((await page.request.post("/api/uploads/complete", { data: { session: opened.session } })).status()).toBe(422)
    await expect(head(opened.pathname, { token: blobToken() })).rejects.toThrow()
    // 웹훅은 서명 없이 받지 않는다
    const hook = await page.request.post("/api/uploads/webhook", { data: { type: "blob.upload-completed", payload: { blob: {}, tokenPayload: opened.session } } })
    expect(hook.status()).toBe(400)
  })
})
