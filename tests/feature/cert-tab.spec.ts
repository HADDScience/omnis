/**
 * 아카이브 › 인증 탭 — 국가과제 「우리 결정」 과 같은 목록 · 보드 전환, 제자리 편집, 준비물 · 근거, 공고 가점 거꾸로.
 *
 * 지키는 것
 * - 아카이브 띠에 국가과제 다음 「인증」 이 있고, 회사 정보의 인증 구역은 이 탭으로 가는 링크다
 * - 목록: 단계 칩으로 거르고, 줄을 펼쳐 칸 하나씩 고친다(PATCH 에 expect — 그새 바뀌었으면 409 로 새 값)
 * - 접수 마감은 시각까지(서울), 준비물은 끝냄 · 더하기, 근거 링크를 더한다
 * - 「이 인증을 따면」: 같은 인증 키의 가점 항목이 있는 접수 중 공고와 점수
 * - 보드: 여덟 열, 끌어 놓으면 단계가 바뀌고 활동 기록이 남는다(「상태 후보 → 준비」 — 이식의 사람 손질 보호가 읽는 말머리)
 * - 공고 가점표에서 우리 상태가 없음인 항목을 누르면 인증 탭 후보로 올라간다
 * - 폰: 목록이 화면 밖으로 넘치지 않고, 보드는 카드 메뉴로 단계를 바꾼다
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const prisma = new PrismaClient()
const stamp = Date.now()
const NAME = `e2e 신제품 인증(NEP) ${stamp}`
const PHONE = `e2e 폰 인증 ${stamp}`
const NOTICE = `e2e 인증 가점 공고 ${stamp}`
const NEW_FROM_BONUS = `e2e 고용우수 ${stamp}`
const keys = [`cert:e2e-tab-${stamp}`, `cert:e2e-tab-phone-${stamp}`]
/** 접수 마감 — 오늘부터 30일 뒤 16:00(서울). 날짜가 지나도 시험이 서게 고정 날짜를 쓰지 않는다 */
const DUE_DAY = new Date(Date.now() + 30 * 86_400_000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)
const DUE_UTC = new Date(`${DUE_DAY}T16:00:00+09:00`).toISOString()
let certId = ""
let phoneId = ""
let noticeId = ""

test.beforeAll(async () => {
  const c = await prisma.companyCertification.create({
    data: { externalKey: keys[0], name: NAME, issuer: "KOAT", status: "CANDIDATE", checklist: [{ id: "a", text: "공인시험성적서", done: false }] },
  })
  certId = c.id
  phoneId = (await prisma.companyCertification.create({ data: { externalKey: keys[1], name: PHONE, status: "CANDIDATE" } })).id
  noticeId = (
    await prisma.grantNotice.create({
      data: {
        externalKey: `notice:e2e:cert-tab-${stamp}`,
        title: NOTICE,
        deadlineAt: new Date(Date.now() + 20 * 86_400_000),
        verdictSole: "해당",
        verdictCorp: "해당",
        judgedBy: "rules",
        regionDetail: [],
        fields: [],
        bonusStatus: "ok",
        bonusItems: [
          { label: "신제품인증(NEP) 보유 기업", points: 3, pointsText: "3점", condition: null, quote: "신제품인증(NEP) 보유 기업 3점", source: "본문(e2e)" },
          { label: NEW_FROM_BONUS, points: 1, pointsText: "1점", condition: null, quote: `${NEW_FROM_BONUS} 1점`, source: "본문(e2e)" },
        ],
      },
    })
  ).id
})

test.afterAll(async () => {
  const made = await prisma.companyCertification.findMany({ where: { OR: [{ externalKey: { in: keys } }, { name: { contains: String(stamp) } }] } })
  const ids = made.map((m) => m.id)
  await prisma.activityLog.deleteMany({ where: { entityId: { in: ids } } })
  await prisma.companyCertification.deleteMany({ where: { id: { in: ids } } })
  await prisma.grantNotice.deleteMany({ where: { id: noticeId } })
  await prisma.$disconnect()
})

const row = (page: Page, name: string) => page.locator("[data-certs-row]").filter({ hasText: name })
const open = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `${name} 펼치기` }).click()
  return page.locator(`[data-certs-detail]`)
}
const column = (page: Page, stage: string) => page.locator(`[data-certs-column="${stage}"]`)
const card = (page: Page, stage: string, name: string) => column(page, stage).locator("[data-certs-card]").filter({ hasText: name })
const patchOf = (page: Page, id: string) =>
  page.waitForResponse((r) => r.url().includes(`/api/company/certifications/${id}`) && r.request().method() === "PATCH")
const cert = (id: string) => prisma.companyCertification.findUniqueOrThrow({ where: { id } })

async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + 30, a.y + 40)
  await page.mouse.down()
  await page.mouse.move(a.x + 40, a.y + 50, { steps: 4 })
  await to.scrollIntoViewIfNeeded()
  const b = (await to.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120), { steps: 12 })
  await page.mouse.up()
}

test.describe("인증 탭 @archive", () => {
  test.describe.configure({ mode: "serial" })
  test.slow()

  // 지키는 것: 아카이브 띠의 자리 · 회사 정보 링크 · 단계 칩
  test("탭 자리 · 회사 정보 링크 · 단계 칩", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/company")
    const link = page.locator("[data-company-certs-link]")
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/omnis\/certs$/)
    const tabs = page.getByRole("navigation", { name: "아카이브" }).first().getByRole("link")
    const labels = await tabs.allTextContents()
    expect(labels.indexOf("인증")).toBe(labels.indexOf("국가과제") + 1)
    await expect(tabs.filter({ hasText: "인증" })).toHaveAttribute("aria-current", "page")
    await expect(row(page, NAME)).toBeVisible()
    await page.getByRole("link", { name: /^보유 \d+/ }).click()
    await expect(page).toHaveURL(/stage=HELD/)
    await expect(row(page, NAME)).toHaveCount(0)
  })

  // 지키는 것: 칸 하나씩 저장(expect) · 접수 마감 시각 · 그새 바뀌면 409
  test("제자리 편집 — 발급 기관 · 접수 마감 · 충돌", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/certs")
    const d = await open(page, NAME)
    await d.getByRole("button", { name: /발급 기관/ }).click()
    const issuer = d.getByLabel("발급 기관")
    await issuer.fill("KOAT · 산업통상부")
    let res = patchOf(page, certId)
    await issuer.press("Enter")
    expect((await res).request().postDataJSON()).toEqual({ issuer: "KOAT · 산업통상부", expect: { issuer: "KOAT" } })
    await expect(d.getByText("저장됨")).toBeVisible()
    expect((await cert(certId)).issuer).toBe("KOAT · 산업통상부")

    await d.getByRole("button", { name: /접수 마감/ }).click()
    const due = d.getByLabel("접수 마감")
    await due.fill(`${DUE_DAY}T16:00`)
    res = patchOf(page, certId)
    await due.press("Enter")
    expect((await res).request().postDataJSON()).toEqual({ deadline: `${DUE_DAY} 16:00`, expect: { deadline: "" } })
    expect((await cert(certId)).deadline?.toISOString()).toBe(DUE_UTC)
    await expect(d).toContainText(`${DUE_DAY} 16:00`)

    // 그새 다른 사람이 메모를 바꿨다
    await prisma.companyCertification.update({ where: { id: certId }, data: { note: "다른 사람 메모" } })
    await d.getByRole("button", { name: /메모/ }).click()
    await d.getByLabel("메모").fill("내 메모")
    res = patchOf(page, certId)
    await d.getByLabel("메모").blur()
    expect((await res).status()).toBe(409)
    await expect(d.getByText(/그새 다른 사람이 메모/)).toBeVisible()
    expect((await cert(certId)).note).toBe("다른 사람 메모")
  })

  // 지키는 것: 준비물 끝냄 · 더하기, 근거 링크
  test("준비물 · 근거", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/omnis/certs?cert=${certId}`)
    const d = page.locator(`[data-certs-detail="${certId}"]`)
    await expect(d).toBeVisible()
    const list = d.locator("[data-certs-checklist]")
    let res = patchOf(page, certId)
    await list.getByRole("checkbox", { name: "공인시험성적서" }).check()
    expect((await res).status()).toBe(200)
    await list.getByLabel("준비물 더하기").fill("모델명 있는 세금계산서")
    res = patchOf(page, certId)
    await list.getByRole("button", { name: "더하기" }).click()
    expect((await res).status()).toBe(200)
    await expect(list.getByRole("heading", { name: /준비물/ })).toContainText("1/2")
    const c = await cert(certId)
    expect((c.checklist as { text: string; done: boolean }[]).map((x) => [x.text, x.done])).toEqual([
      ["공인시험성적서", true],
      ["모델명 있는 세금계산서", false],
    ])
    const ev = d.locator("[data-certs-evidence]")
    await ev.getByLabel("근거 링크 더하기").fill("https://www.koat.or.kr/")
    res = patchOf(page, certId)
    await ev.getByRole("button", { name: "더하기" }).click()
    expect((await res).status()).toBe(200)
    await expect(ev.getByRole("link", { name: /www\.koat\.or\.kr/ })).toHaveAttribute("href", "https://www.koat.or.kr/")
  })

  // 지키는 것: 공고 가점을 거꾸로 — 이 인증을 따면 어느 공고에서 몇 점
  test("이 인증을 따면 — 공고와 점수", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/omnis/certs?cert=${certId}`)
    const box = page.locator(`[data-certs-detail="${certId}"] [data-certs-bonus-for]`)
    await expect(box).toContainText("이 인증을 따면 받는 공고 가점")
    const n = box.locator(`[data-certs-bonus-notice="${noticeId}"]`)
    await expect(n).toContainText(NOTICE)
    await expect(n).toContainText("3점")
    await expect(n).not.toContainText(NEW_FROM_BONUS)
    await expect(row(page, NAME)).toContainText("가점 공고 1")
  })

  // 지키는 것: 보드 여덟 열 · 끌어 놓기 · 활동 기록 말머리
  test("보드 — 여덟 열 · 후보 → 준비", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/certs")
    await page.getByRole("group", { name: "보기" }).getByRole("link", { name: "보드" }).click()
    await expect(page).toHaveURL(/view=board/)
    expect(await page.locator("[data-certs-column]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "후보",
      "준비",
      "신청",
      "심사 중",
      "보유",
      "갱신 필요",
      "만료",
      "중단",
    ])
    const c = card(page, "CANDIDATE", NAME)
    await expect(c).toContainText("준비물 1/2")
    await expect(c).toContainText("D-")
    const res = patchOf(page, certId)
    await drag(page, c, column(page, "PREPARING"))
    expect((await res).request().postDataJSON()).toEqual({ status: "PREPARING", expect: { status: "CANDIDATE" } })
    await expect(card(page, "PREPARING", NAME)).toBeVisible()
    expect((await cert(certId)).status).toBe("PREPARING")
    const logs = await prisma.activityLog.findMany({ where: { entityId: certId, action: "company.certification.updated" } })
    expect(logs.some((l) => JSON.stringify(l.metadata).includes("상태 후보 → 준비"))).toBe(true)
  })

  // 지키는 것: 공고 가점표의 없음 → 인증 탭 후보
  test("공고 가점표 — 없음인 항목을 인증 탭 후보로", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/omnis/grants?tab=notices&q=${encodeURIComponent(String(stamp))}`)
    await page.getByRole("button", { name: `${NOTICE} 펼치기` }).click()
    const table = page.locator("[data-grant-bonus]")
    await table.getByRole("button", { name: `${NEW_FROM_BONUS} — 우리 상태 없음, 인증 탭으로` }).click()
    const res = page.waitForResponse((r) => r.url().endsWith("/api/company/certifications") && r.request().method() === "POST")
    await page.getByRole("menuitem", { name: "인증 탭 후보로 올리기" }).click()
    expect((await res).status()).toBe(201)
    await expect(page.getByText(`인증 탭 후보로 올렸습니다 · ${NEW_FROM_BONUS}`)).toBeVisible()
    const made = await prisma.companyCertification.findFirstOrThrow({ where: { name: NEW_FROM_BONUS } })
    expect(made.status).toBe("CANDIDATE")
    expect(made.note).toContain(NOTICE)
    // 우리 인증이 있는 항목(후보 — 아직 없음)은 그 인증으로 간다
    await page.reload()
    await page.getByRole("button", { name: `${NOTICE} 펼치기` }).click()
    await page.locator("[data-grant-bonus]").getByRole("button", { name: /신제품인증\(NEP\) 보유 기업 — 우리 상태 없음/ }).click()
    await expect(page.getByRole("menuitem", { name: "인증 탭에서 보기" })).toHaveAttribute("href", /\/omnis\/certs\?cert=/)
  })
})

test.describe("인증 탭 폰 @archive @mobile", () => {
  // 지키는 것: 목록이 넘치지 않고 · 보드는 카드 메뉴로 단계를 바꾼다
  test("목록 넘침 없음 · 보드 메뉴", async ({ page }) => {
    test.slow()
    await login(page, "팀장")
    await page.goto(`/omnis/certs?cert=${phoneId}`)
    await expect(page.locator(`[data-certs-detail="${phoneId}"]`)).toBeVisible()
    const { pageScroll, pageWidth } = await page.evaluate(() => ({ pageScroll: document.documentElement.scrollWidth, pageWidth: window.innerWidth }))
    expect(pageScroll).toBeLessThanOrEqual(pageWidth)
    await page.goto("/omnis/certs?view=board")
    await card(page, "CANDIDATE", PHONE).getByRole("button", { name: `${PHONE} 단계 바꾸기` }).click()
    const res = patchOf(page, phoneId)
    await page.getByRole("menuitem", { name: "신청" }).click()
    expect((await res).status()).toBe(200)
    await expect(card(page, "APPLIED", PHONE)).toBeAttached()
    expect((await cert(phoneId)).status).toBe("APPLIED")
  })
})
