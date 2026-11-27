/**
 * 채용 지원서함(HR 1단계) — 홈페이지가 여는 지원서 → 조각 업로드 → 접수 → 채용 담당만 보기.
 *
 * 지키는 것
 * - 홈페이지 계약(~/work/omnis-reports/omnis-hr-api-contract-261124.md)대로 열고 · 올리고 · 확정하면 지원서함에 뜬다
 * - 관리자라도 채용 담당이 아니면 목록 · 상세 · 파일이 모두 막힌다(거부되어야 하는 경우)
 * - 관리자가 운영 탭에서 담당을 고르면 그 사람(구성원이어도)이 마이 입구 · 목록 · 상세 · 파일을 본다
 * - 내려받은 파일이 올린 파일과 같다(이력서 9MB · 포트폴리오 12MB — 포트폴리오는 이력서 상한 10MB 를 넘어도 받는다)
 * - 홈페이지가 보낸 「관심 있는 일」 이 상세에 라벨로 보인다
 * - 면접자료 PDF — 채용 담당만, 서류 합격 뒤에만(접수 단계는 403). 받은 PDF 는 요약 장 + 책갈피, 서류 합격 묶음은 표지가 앞에 붙는다
 * - 지원서함은 공고 목록 → 공고 보드(접수 · 서류 합격 · 최종 합격). 카드 메뉴로 단계를 바꾸면 이벤트 · 활동 기록이 남는다. 담당이 아니면 단계 API 도 403
 * - 공고 보드 머리에서 면접 일시 · 장소 · 방식을 그 자리에서 고치면 저장되고(활동 기록), 고치기 전에 본 값이 낡았으면 409 · 담당이 아니면 403
 *
 * 가짜 NAS(scripts/e2e-fake-nas.mjs)와 지원서 비밀(WEBSITE_CAREER_SECRET · WEBSITE_CAREER_UPLOAD_KEY)이 있을 때만 돈다 — CI 는 둘 다 넣는다.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, request, test } from "@playwright/test"
import { PDFDocument } from "pdf-lib"
import { PrismaClient } from "../../generated/prisma/client"
import { readOutline } from "../../lib/hr/interview-pack"
import { login } from "./_setup"

const NAS = process.env.E2E_FAKE_NAS_URL
const SECRET = process.env.WEBSITE_CAREER_SECRET
const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex")
const JOB = "suwon-anchor-practicum-intern-2026-winter"
// HR_SHOTS 에 절대 경로를 주면 보드 머리 · 묶음 PDF 를 남긴다(보고서 캡처용)
const shots = process.env.HR_SHOTS

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
    await prisma.jobPostingMeta.deleteMany({ where: { jobSlug: JOB } })
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
    await expect(page.locator("[data-hr-job]")).toHaveCount(0)
    expect((await page.request.patch(`/api/hr/applications/${id}`, { data: { stage: "INTERVIEW" } })).status()).toBe(403)
    expect((await page.request.get(`/api/hr/applications/${id}/interview-pack`)).status()).toBe(403)
    expect((await page.request.get(`/api/hr/jobs/suwon-anchor-practicum-intern-2026-winter/interview-pack`)).status()).toBe(403)
    expect((await page.request.patch(`/api/hr/jobs/${JOB}`, { data: { place: "막혀야 하는 값" } })).status()).toBe(403)
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
    // 공고 목록 → 보드. 마감이 지난 뒤에는 공고가 접힌 「마감된 공고」 안에 있다
    // 마감(2026-11-27 17:00 KST)이 지나면 열린 공고가 하나도 없을 수 있다 — 열린 공고나 「마감된 공고」 접힌 칸 중 하나가 뜰 때까지 기다린다
    // (2026-11-27 CI 45963968609: 마감 뒤 첫 공고가 접힌 칸 안에 숨어 실패)
    const job = page.locator('[data-hr-job="suwon-anchor-practicum-intern-2026-winter"]')
    const closedJobs = page.locator("[data-hr-closed-jobs] summary")
    await expect(job.or(closedJobs).first()).toBeVisible()
    if (!(await job.isVisible())) await closedJobs.click()
    await job.click()
    const card = page.locator(`[data-hr-column="received"] [data-hr-card="${code}"]`)
    await expect(card).toBeVisible()
    // 접수 단계에서는 면접자료를 받지 못한다
    expect((await page.request.get(`/api/hr/applications/${id}/interview-pack`)).status()).toBe(403)
    // 카드 메뉴로 서류 합격 — 열이 옮겨지고 기록이 남는다(지원자 메일은 접수 때만 나간다)
    await card.getByRole("button", { name: /단계 바꾸기$/ }).click()
    await page.getByRole("menuitem", { name: "서류 합격" }).click()
    const moved = page.locator(`[data-hr-column="passed"] [data-hr-card="${code}"]`)
    await expect(moved).toBeVisible()
    await expect.poll(async () => (await prisma.jobApplication.findUniqueOrThrow({ where: { id } })).stage).toBe("INTERVIEW")
    expect(await prisma.jobApplicationEvent.count({ where: { applicationId: id, fromStage: "RECEIVED", toStage: "INTERVIEW" } })).toBe(1)
    // 공고 보드 머리 — 면접 장소 · 방식 · 일시를 그 자리에서 고친다(가짜 값)
    const head = page.locator(`[data-hr-job-meta="${JOB}"]`)
    await expect(head).toBeVisible()
    const patched = () => page.waitForResponse((r) => r.url().endsWith(`/api/hr/jobs/${JOB}`) && r.request().method() === "PATCH")
    await head.getByRole("button", { name: /^면접 장소/ }).click()
    await head.getByLabel("면접 장소").fill("가상시 시험로 1 시험센터 9층")
    let res = patched()
    await head.getByLabel("면접 장소").press("Enter")
    expect((await res).status()).toBe(200)
    await expect(head.getByText("가상시 시험로 1 시험센터 9층")).toBeVisible()
    await head.getByRole("button", { name: /^면접 방식/ }).click()
    res = patched()
    await head.getByLabel("면접 방식").selectOption("VIDEO")
    expect((await res).status()).toBe(200)
    await expect(head.getByRole("button", { name: /^화상 링크/ })).toBeVisible()
    await head.getByRole("button", { name: /^면접 일시/ }).click()
    await head.getByLabel("1번째 날짜").fill("2099-01-05")
    await head.getByLabel("1번째 시작 시각").fill("11:00")
    await head.getByLabel("1번째 한 사람 시간(분)").fill("10")
    res = patched()
    await head.getByLabel("1번째 한 사람 시간(분)").press("Enter")
    expect((await res).status()).toBe(200)
    await expect(head.locator("[data-hr-meta-slots]")).toHaveText("2099-01-05(월) 11:00 · 10분씩")
    if (shots) {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.screenshot({ path: path.join(shots, "01-board-head-pc.png") })
      await head.getByRole("button", { name: /^면접 일시/ }).click()
      await head.getByRole("button", { name: "일시 더하기" }).click()
      await page.screenshot({ path: path.join(shots, "02-board-head-pc-editing.png") })
      await head.getByLabel("2번째 날짜").press("Escape")
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: path.join(shots, "03-board-head-phone.png"), fullPage: true })
      await head.getByRole("button", { name: /^면접 장소/ }).click()
      await page.screenshot({ path: path.join(shots, "04-board-head-phone-editing.png") })
      await head.getByLabel("면접 장소").press("Escape")
      await page.setViewportSize({ width: 1280, height: 720 })
    }
    await expect
      .poll(async () => prisma.jobPostingMeta.findUnique({ where: { jobSlug: JOB }, select: { interviewPlace: true, interviewMode: true, interviewSlots: true } }))
      .toEqual({ interviewPlace: "가상시 시험로 1 시험센터 9층", interviewMode: "VIDEO", interviewSlots: [{ date: "2099-01-05", time: "11:00", minutesEach: 10 }] })
    expect(await prisma.activityLog.count({ where: { action: "hr.job.meta", entityId: JOB } })).toBe(3)
    // 고치기 전에 본 값이 낡았으면 덮지 않는다(거부되어야 하는 경우) · 모양이 틀린 값은 400
    expect((await page.request.patch(`/api/hr/jobs/${JOB}`, { data: { place: "덮으면 안 되는 값", expect: { place: "옛 값" } } })).status()).toBe(409)
    expect((await page.request.patch(`/api/hr/jobs/${JOB}`, { data: { videoUrl: "http://plain.example.invalid" } })).status()).toBe(400)
    expect((await prisma.jobPostingMeta.findUniqueOrThrow({ where: { jobSlug: JOB } })).interviewPlace).toBe("가상시 시험로 1 시험센터 9층")
    // 면접자료 PDF — 지원자 한 명(시험 파일은 PDF 모양이 아니라 「못 넣음」 으로 요약 장에만 적힌다) · 서류 합격 묶음(표지 + 지원자)
    const one = await page.request.get(`/api/hr/applications/${id}/interview-pack`)
    expect(one.status()).toBe(200)
    expect(one.headers()["cache-control"]).toContain("no-store")
    const onePdf = await PDFDocument.load(await one.body())
    expect(onePdf.getPageCount()).toBe(1)
    expect(readOutline(onePdf)).toEqual([{ title: "지원서 요약", page: 0 }])
    const all = await page.request.get(`/api/hr/jobs/suwon-anchor-practicum-intern-2026-winter/interview-pack`)
    expect(all.status()).toBe(200)
    if (shots) writeFileSync(path.join(shots, "05-bundle.pdf"), await all.body())
    const allPdf = await PDFDocument.load(await all.body())
    const outline = readOutline(allPdf)
    expect(outline[0]).toEqual({ title: "표지", page: 0 })
    expect(outline.some((b) => b.title === `시험 지원자 (${code})`)).toBe(true)
    expect(allPdf.getPageCount()).toBe(outline.length)
    await expect(page.locator("[data-hr-column=passed] [data-hr-bundle]")).toBeVisible()
    await moved.locator("a").click()
    await expect(page.locator("[data-hr-interview-pack]")).toBeVisible()
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
    expect(logs.map((l) => l.action).sort()).toEqual(expect.arrayContaining(["hr.application.file_downloaded", "hr.application.viewed", "hr.application.stage", "hr.application.interview_pack"]))
    await ctx.close()
  })
})
