/**
 * 채용 지원서함(HR 1단계) — 홈페이지가 여는 지원서 → 조각 업로드 → 접수 → 채용 담당만 보기.
 *
 * 지키는 것
 * - 홈페이지 계약(~/work/omnis-reports/omnis-hr-api-contract-261124.md)대로 열고 · 올리고 · 확정하면 지원서함에 뜬다
 * - 관리자라도 채용 담당이 아니면 목록 · 상세 · 파일이 모두 막힌다(거부되어야 하는 경우)
 * - 관리자가 운영 탭에서 담당을 고르면 그 사람(구성원이어도)이 마이 입구 · 목록 · 상세 · 파일을 본다
 * - 내려받은 파일이 올린 파일과 같다(이력서 9MB · 포트폴리오 12MB — 포트폴리오는 이력서 상한 10MB 를 넘어도 받는다)
 * - 홈페이지가 보낸 「관심 있는 일」 이 목록 · 상세에 라벨로 보인다
 *
 * 가짜 NAS(scripts/e2e-fake-nas.mjs)와 지원서 비밀(WEBSITE_CAREER_SECRET · WEBSITE_CAREER_UPLOAD_KEY)이 있을 때만 돈다 — CI 는 둘 다 넣는다.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { expect, request, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const NAS = process.env.E2E_FAKE_NAS_URL
const SECRET = process.env.WEBSITE_CAREER_SECRET
const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex")

test.describe("채용 지원서함 @hr", () => {
  test.skip(!NAS || !SECRET || !process.env.WEBSITE_CAREER_UPLOAD_KEY, "가짜 NAS 또는 지원서 비밀이 없다")
  test.describe.configure({ mode: "serial" })
  // 화면 셋(지원서함 · 상세 · 마이)을 처음 여는 테스트라 dev 서버(로컬 e2e)의 첫 컴파일이 길다 — CI(next start)는 금방이다
  test.slow()

  const prisma = new PrismaClient()
  // 9MB — 조각 셋(4,000,000 · 4,000,000 · 나머지)
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n% e2e\n"), Buffer.alloc(9_000_000, 7), Buffer.from("\n%%EOF\n")])
  // 12MB 포트폴리오 — 이력서 상한(10MB)은 넘고 포트폴리오 상한(30MB) 안이다. 조각 넷
  const portfolio = Buffer.concat([Buffer.from("%PDF-1.4\n% portfolio\n"), Buffer.alloc(12_000_000, 9)])
  const email = `hr-e2e-${Date.now()}@example.com`
  let id = ""
  let code = ""

  test.afterAll(async () => {
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: "hr_" } } })
    if (id) await prisma.jobApplication.deleteMany({ where: { id } })
    await prisma.$disconnect()
  })

  test("홈페이지 계약대로 열고 · 조각 셋을 올리고 · 확정한다", async ({ baseURL }) => {
    const api = await request.newContext({ baseURL })
    const auth = { authorization: `Bearer ${SECRET}` }

    expect((await api.post("/api/website/applications", { data: {} })).status(), "비밀 없이").toBe(401)

    const open = await api.post("/api/website/applications", {
      headers: auth,
      data: {
        job: "suwon-anchor-practicum-intern-2026-winter",
        jobTitle: "[수원대 앵커사업단x현장실습] Intern",
        lang: "ko",
        name: "시험 지원자",
        department: "데이터과학부",
        studentId: "20231234",
        grade: "3",
        graduation: "2028년 2월",
        phone: "010-0000-0000",
        email,
        portfolioUrl: "",
        interests: ["ai-bio", "grants"],
        motivation: "e2e 시험 지원서입니다.",
        consent: true,
        consentVersion: "career-consent-e2e",
        resume: { name: "이력서.pdf", size: pdf.length, type: "application/pdf" },
        portfolioFile: { name: "포트폴리오.pdf", size: portfolio.length, type: "application/pdf" },
      },
    })
    expect(open.status()).toBe(201)
    const body = (await open.json()) as { id: string; uploads: { url: string; ticket: string; partBytes: number; parts: number }[] }
    id = body.id
    const [slip, pfSlip] = body.uploads
    expect(slip.parts).toBe(3)
    expect(pfSlip.parts).toBe(4)

    const path = new URL(slip.url).pathname
    // 거부 — 차례를 건너뛴 조각
    expect((await api.put(`${path}?part=1`, { headers: { authorization: `Ticket ${slip.ticket}` }, data: pdf.subarray(slip.partBytes, 2 * slip.partBytes) })).status()).toBe(400)
    for (let n = 0; n < slip.parts; n++) {
      const res = await api.put(`${path}?part=${n}`, {
        headers: { authorization: `Ticket ${slip.ticket}`, "content-type": "application/octet-stream" },
        data: pdf.subarray(n * slip.partBytes, Math.min(pdf.length, (n + 1) * slip.partBytes)),
      })
      expect(res.status(), `조각 ${n}`).toBe(204)
    }
    const pfPath = new URL(pfSlip.url).pathname
    for (let n = 0; n < pfSlip.parts; n++) {
      const res = await api.put(`${pfPath}?part=${n}`, {
        headers: { authorization: `Ticket ${pfSlip.ticket}`, "content-type": "application/octet-stream" },
        data: portfolio.subarray(n * pfSlip.partBytes, Math.min(portfolio.length, (n + 1) * pfSlip.partBytes)),
      })
      expect(res.status(), `포트폴리오 조각 ${n}`).toBe(204)
    }
    const done = await api.post(`/api/website/applications/${id}/complete`, { headers: auth })
    expect(done.status()).toBe(201)
    code = ((await done.json()) as { code: string }).code
    expect(code).toMatch(/^APP\d{6}-\d{3}$/)
    // 다시 불러도 같은 번호
    const again = await api.post(`/api/website/applications/${id}/complete`, { headers: auth })
    expect(again.status()).toBe(200)
    expect(((await again.json()) as { code: string }).code).toBe(code)
    await api.dispose()
  })

  test("관리자라도 채용 담당이 아니면 못 본다", async ({ page }) => {
    await prisma.appSetting.deleteMany({ where: { key: "hr_reviewers" } })
    await login(page, "팀장")
    await page.goto("/hr/applications")
    await expect(page.locator("[data-hr-denied]")).toBeVisible()
    await expect(page.locator("[data-hr-application]")).toHaveCount(0)
    await page.goto(`/hr/applications/${id}`)
    await expect(page.locator("[data-hr-denied]")).toBeVisible()
    expect((await page.request.get(`/api/hr/applications/${id}/files/resume`)).status()).toBe(403)
    await page.goto("/settings")
    await expect(page.locator("[data-hr-entry]")).toHaveCount(0)
  })

  test("운영 탭에서 담당을 고르면 그 사람이 지원서와 파일을 본다", async ({ browser }) => {
    const adminCtx = await browser.newContext()
    const admin = await adminCtx.newPage()
    await login(admin, "팀장")
    await admin.goto("/admin/operations")
    const form = admin.locator("[data-hr-reviewers-form]")
    await form.locator('[data-hr-reviewer="사원1"]').click()
    await expect(form.locator('[data-hr-reviewer="사원1"]')).toHaveAttribute("aria-pressed", "true")
    const saved = admin.waitForResponse((r) => r.url().endsWith("/api/hr/reviewers") && r.request().method() === "PUT")
    await form.getByRole("button", { name: "저장" }).click()
    expect((await saved).status()).toBe(200)
    await adminCtx.close()

    const ctx = await browser.newContext({ acceptDownloads: true })
    const page = await ctx.newPage()
    await login(page, "사원1")
    await page.goto("/settings")
    await expect(page.locator("[data-hr-entry]")).toBeVisible()
    await page.locator("[data-hr-entry]").click()
    await expect(page).toHaveURL(/\/hr\/applications$/)
    await expect(page.locator(`[data-hr-application="${code}"] [data-hr-interests]`)).toContainText("AI 기반 바이오 연구")
    await page.locator(`[data-hr-application="${code}"]`).click()
    await expect(page.locator(`[data-hr-application-detail="${code}"]`)).toBeVisible()
    await expect(page.getByText("시험 지원자").first()).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    // 관심 있는 일 — 홈페이지가 보낸 value 가 라벨로 보인다(목록 · 상세)
    await expect(page.getByText("AI 기반 바이오 연구 · 국가과제 · TIPS 같은 지원 서류 작성")).toBeVisible()

    const download = page.waitForEvent("download")
    await page.locator('[data-hr-file="resume"]').click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`${code}_이력서.pdf`)
    expect(md5(readFileSync((await file.path())!))).toBe(md5(pdf))
    const pfDownload = page.waitForEvent("download")
    await page.locator('[data-hr-file="portfolio"]').click()
    expect(md5(readFileSync((await (await pfDownload).path())!))).toBe(md5(portfolio))

    const logs = await prisma.activityLog.findMany({ where: { entityId: id }, select: { action: true } })
    expect(logs.map((l) => l.action).sort()).toEqual(expect.arrayContaining(["hr.application.file_downloaded", "hr.application.viewed"]))
    await ctx.close()
  })
})
