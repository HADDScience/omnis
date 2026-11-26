/**
 * 국가과제 「우리 결정」 — 펼친 결정의 칸을 그 자리에서 고친다(고치기 폼 없음).
 *
 * 지키는 것
 * - 칸을 누르면 그 칸이 입력이 되고, Enter 면 저장된다. 다시 열어도 남아 있고 활동 기록이 남는다
 * - Esc 면 입력을 버리고 저장하지 않는다
 * - 저장이 실패하면 원래 값으로 돌아가고 칸 옆에 실패가 보인다
 * - 그새 다른 사람이 같은 칸을 바꿨으면(409) 알려 주고 새 값을 보인다
 * - 「내리기」 는 펼친 화면의 더보기 메뉴에 있고 확인 창을 거친다. 노션에서 옮겨 온 결정에는 없다
 * - 폰에서도 칸을 눌러 고친다
 * - 상태 v2: 단계 선택지는 준비 · 제출 완료 · 선정됨 · 미선정 · 수행 중 · 완료 · 중단(검토 · 불참 없음).
 *   선정됨이면 선정 통보일 · 확정 지원금이, 수행 중이면 협약일 · 수행 기간이 나타나고, 목록에는 「~ 수행 종료일」
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const prisma = new PrismaClient()
const stamp = Date.now()
const RAISED = `e2e 제자리 편집 과제 ${stamp}`
const IMPORTED = `e2e 노션 과제 ${stamp}`
let raisedId = ""
let importedId = ""

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const raised = await prisma.grantDecision.create({
    data: {
      externalKey: `notice:e2e-inline-${stamp}`,
      title: RAISED,
      stage: "PREPARING",
      note: "처음 메모",
      deadline: new Date("2027-03-02T00:00:00+09:00"),
      owners: { create: [{ userId: owner.id }] },
    },
  })
  const imported = await prisma.grantDecision.create({
    data: {
      externalKey: `notion:e2e-inline-${stamp}`,
      title: IMPORTED,
      stage: "PREPARING",
    },
  })
  raisedId = raised.id
  importedId = imported.id
})

test.afterAll(async () => {
  await prisma.grantDecision.deleteMany({ where: { id: { in: [raisedId, importedId] } } })
  await prisma.activityLog.deleteMany({ where: { entityId: { in: [raisedId, importedId] } } })
  await prisma.$disconnect()
})

async function openDecision(page: Page, title: string) {
  await page.goto("/omnis/grants")
  await page.getByRole("button", { name: `${title} 펼치기` }).click()
  await expect(page.getByLabel(`${title} 칸`)).toBeVisible()
}

/** 펼친 결정의 칸 — 이름은 「칸 이름 + 지금 값」 */
const field = (page: Page, title: string, label: string) =>
  page.getByLabel(`${title} 칸`).getByRole("button", { name: new RegExp(`^${label}`) })

test.describe("국가과제 제자리 편집 @archive", () => {
  test.describe.configure({ mode: "serial" })
  test.slow()

  // 지키는 것: 칸을 눌러 고치고 Enter 로 저장하면 다시 열어도 남고 활동 기록이 남는다
  test("칸 저장 — 마감 · 지원금액 · 담당", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, RAISED)
    await expect(page.getByRole("button", { name: "고치기" })).toHaveCount(0)

    await field(page, RAISED, "마감").click()
    const date = page.getByLabel("마감", { exact: true })
    await date.fill("2027-04-15")
    await date.press("Enter")
    await expect(field(page, RAISED, "마감")).toContainText("2027-04-15")
    await expect(page.getByText("저장됨").first()).toBeVisible()

    await field(page, RAISED, "지원금액").click()
    const amount = page.getByLabel("지원금액", { exact: true })
    await amount.fill("최대 2억 원")
    await amount.press("Enter")
    await expect(field(page, RAISED, "지원금액")).toContainText("최대 2억 원")

    await field(page, RAISED, "담당").click()
    await page.getByRole("button", { name: "부팀장", exact: true }).click()
    await page.keyboard.press("Enter")
    await expect(field(page, RAISED, "담당")).toContainText("부팀장")

    await expect
      .poll(async () => {
        const d = await prisma.grantDecision.findUniqueOrThrow({
          where: { id: raisedId },
          include: { owners: { include: { user: true } } },
        })
        return [d.amount, d.deadline?.toISOString(), d.owners.map((o) => o.user.name).sort().join(",")]
      })
      .toEqual(["최대 2억 원", new Date("2027-04-15T00:00:00+09:00").toISOString(), "부팀장,팀장"])
    expect(
      await prisma.activityLog.count({ where: { entityId: raisedId, action: "grant.decision.updated" } })
    ).toBe(3)

    await openDecision(page, RAISED)
    await expect(field(page, RAISED, "지원금액")).toContainText("최대 2억 원")
  })

  // 지키는 것: Esc 면 입력을 버리고 저장하지 않는다
  test("Esc 는 취소", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, RAISED)
    await field(page, RAISED, "메모").click()
    const note = page.getByLabel("메모", { exact: true })
    await note.fill("버릴 메모")
    await note.press("Escape")
    await expect(field(page, RAISED, "메모")).toContainText("처음 메모")
    const d = await prisma.grantDecision.findUniqueOrThrow({ where: { id: raisedId } })
    expect(d.note).toBe("처음 메모")
  })

  // 지키는 것: 저장이 실패하면 원래 값으로 돌아가고 실패가 보인다
  test("실패하면 되돌린다", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, RAISED)
    await page.route(`**/api/grants/decisions/${raisedId}`, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "시험용 실패" }) })
        : route.continue()
    )
    await field(page, RAISED, "사유").click()
    const reason = page.getByLabel("사유", { exact: true })
    await reason.fill("저장 안 될 사유")
    await reason.press("Enter")
    await expect(page.getByText("저장하지 못했습니다 · 시험용 실패")).toBeVisible()
    await expect(field(page, RAISED, "사유")).not.toContainText("저장 안 될 사유")
  })

  // 지키는 것: 그새 다른 사람이 같은 칸을 바꿨으면 알려 주고 새 값을 보인다
  test("그새 바뀐 칸은 409 로 알려 준다", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, RAISED)
    await field(page, RAISED, "메모").click()
    await prisma.grantDecision.update({ where: { id: raisedId }, data: { note: "다른 사람이 쓴 메모" } })
    const note = page.getByLabel("메모", { exact: true })
    await note.fill("내 메모")
    await note.press("Enter")
    await expect(page.getByText(/그새 다른 사람이 메모을\(를\) 바꿨습니다 — 새 값으로 바꿨습니다/)).toBeVisible()
    await expect(field(page, RAISED, "메모")).toContainText("다른 사람이 쓴 메모")
    const d = await prisma.grantDecision.findUniqueOrThrow({ where: { id: raisedId } })
    expect(d.note).toBe("다른 사람이 쓴 메모")
  })

  // 지키는 것: 상태를 바꾸면 그 상태의 칸이 나타나고 고칠 수 있다. 수행 중이면 목록에 「~ 수행 종료일」
  test("상태별 칸 — 선정됨 · 수행 중", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, RAISED)
    await field(page, RAISED, "단계").click()
    const options = await page.getByLabel("단계", { exact: true }).locator("option").allTextContents()
    expect(options).toEqual(["준비", "제출 완료", "선정됨", "미선정", "수행 중", "완료", "중단"])
    await expect(field(page, RAISED, "선정 통보일")).toHaveCount(0)
    await page.getByLabel("단계", { exact: true }).selectOption("SELECTED")
    await expect(field(page, RAISED, "선정 통보일")).toBeVisible()
    await expect(field(page, RAISED, "협약일")).toHaveCount(0)

    await field(page, RAISED, "확정 지원금").click()
    const money = page.getByLabel("확정 지원금", { exact: true })
    await money.fill("120000000")
    await money.press("Enter")
    await expect(field(page, RAISED, "확정 지원금")).toContainText("120,000,000원")

    await field(page, RAISED, "단계").click()
    await page.getByLabel("단계", { exact: true }).selectOption("IN_PROGRESS")
    await field(page, RAISED, "수행 종료일").click()
    const ends = page.getByLabel("수행 종료일", { exact: true })
    await ends.fill("2027-12-31")
    await ends.press("Enter")
    await expect(page.getByRole("button", { name: `${RAISED} 접기` })).toContainText("~ 2027-12-31")

    await expect
      .poll(async () => {
        const d = await prisma.grantDecision.findUniqueOrThrow({ where: { id: raisedId } })
        return [d.stage, d.awardedAmount?.toString(), d.endsOn?.toISOString()]
      })
      .toEqual(["IN_PROGRESS", "120000000", new Date("2027-12-31T00:00:00+09:00").toISOString()])
  })

  // 지키는 것: 내리기는 더보기 메뉴 → 확인 창. 노션에서 옮겨 온 결정에는 메뉴가 없다
  test("내리기는 더보기 메뉴에서", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, IMPORTED)
    await expect(page.getByRole("button", { name: `${IMPORTED} 더보기` })).toHaveCount(0)

    await openDecision(page, RAISED)
    await page.getByRole("button", { name: `${RAISED} 더보기` }).click()
    await page.getByRole("menuitem", { name: "내리기" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByText("우리 결정에서 내릴까요?")).toBeVisible()
    await dialog.getByRole("button", { name: "그만두기" }).click()
    await expect(dialog).toHaveCount(0)
    expect(await prisma.grantDecision.count({ where: { id: raisedId } })).toBe(1)
  })
})

test.describe("국가과제 제자리 편집 — 폰 @mobile", () => {
  test.slow()
  // 지키는 것: 폰에서도 칸을 눌러 단계를 바꾼다
  test("단계를 눌러 고른다", async ({ page }) => {
    await login(page, "팀장")
    await openDecision(page, IMPORTED)
    await field(page, IMPORTED, "단계").tap()
    await page.getByLabel("단계", { exact: true }).selectOption("SUBMITTED")
    await expect(field(page, IMPORTED, "단계")).toContainText("제출 완료")
    await expect
      .poll(async () => (await prisma.grantDecision.findUniqueOrThrow({ where: { id: importedId } })).stage)
      .toBe("SUBMITTED")
  })
})
