import { type Page, expect } from "@playwright/test"

/**
 * 사용자가 하려는 일 하나 = 함수 하나. spec 은 버튼을 직접 찾지 않고 이 함수를 부른다.
 *
 * 화면 구조가 바뀌면(버튼을 옮기거나 탭을 합치면) 이 파일만 고친다. 2026-10-28 사이드바를 걷을 때
 * 「검색 ⌘K 버튼을 누른다」 같은 위치 묶인 코드가 spec 9개에 흩어져 있어, 하나씩 고치다 테스트의
 * 목적까지 바꿔 버린 일이 있었다(mydocs/plans/2026-10-29-e2e-guard.md).
 *
 * 이름은 동작이 아니라 의도로 짓는다 — 「검색 버튼 클릭」 이 아니라 「검색 열기」.
 */

type Tab = "업무" | "캘린더" | "아카이브"

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768

/** 주 메뉴(떠 있는 nav)의 탭으로 옮긴다 */
export async function gotoTab(page: Page, tab: Tab) {
  const path = { 업무: "/tasks", 캘린더: "/calendar", 아카이브: "/omnis" }[tab]
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .filter({ visible: true })
    .getByRole("link", { name: tab, exact: true })
    .click()
  await page.waitForURL(new RegExp(`${path}(\\?|$)`))
}

/** 마이(계정·설정) 화면으로 — 화면 안에서 옮겨 간다(page.goto 는 작성 중인 상태를 지운다) */
export async function openMy(page: Page) {
  await page.getByRole("link", { name: /^마이/ }).filter({ visible: true }).first().click()
  await page.waitForURL("**/settings")
}

/** 명령 팔레트(검색) 열기. PC 는 ⌘K, 폰은 단축키가 없어 마이 화면의 「검색」 행 */
export async function openSearch(page: Page) {
  if (isPhone(page)) {
    await openMy(page)
    await page.getByRole("button", { name: "검색", exact: true }).click()
  } else {
    await page.keyboard.press("ControlOrMeta+k")
  }
  const input = page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)
  await expect(input).toBeVisible({ timeout: 5_000 })
  return input
}

/** 오른쪽 채팅 패널 열기(이미 열려 있으면 그대로) — 메시지 입력창을 돌려준다 */
export async function openChatPanel(page: Page) {
  const input = page.getByPlaceholder("메시지 입력...  / 명령 · @ 사람 · # 업무")
  if (!(await input.isVisible())) {
    await page.getByRole("button", { name: "채팅 열기", exact: true }).click()
  }
  await expect(input).toBeVisible()
  return input
}

/** 패널의 Omnis AI 에게 묻는 칸 — 질문 입력창을 돌려준다 */
export async function openOmnisAi(page: Page) {
  await openChatPanel(page)
  await page.getByRole("button", { name: "Omnis AI", exact: true }).click()
  const input = page.getByRole("textbox", { name: "옴니스에게 보낼 질문" })
  await expect(input).toBeVisible()
  return input
}

/** 온보딩 튜토리얼을 처음부터 다시 본다(마이 화면) */
export async function replayTutorial(page: Page) {
  await openMy(page)
  await page.getByRole("button", { name: "온보딩 튜토리얼 다시 보기" }).click()
}

/** 업무 보기 바꾸기 */
export async function switchTasksView(page: Page, view: "목록" | "보드" | "관계도") {
  await page.getByRole("button", { name: view, exact: true }).click()
}

/** 업무 현황 띠의 「멈춤」 칩 — 멈춘 업무만 보기를 켜거나 끈다 */
export async function toggleStalledTasks(page: Page) {
  await page.getByRole("link", { name: /^멈춤/ }).click()
}

/** 업무 툴바 필터 메뉴에서 하나 고르기 */
export async function pickTasksFilter(page: Page, label: "전체" | "오늘 마감" | "내가 지시한 업무" | "내가 담당") {
  await page.getByRole("button", { name: /필터/ }).click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
}

/** 업무 현황 「상세」 시트 열기 */
export async function openTasksOverview(page: Page) {
  await page.getByRole("button", { name: "상세", exact: true }).click()
}

/** 지금 목록에 보이는 업무 건수(툴바 「업무 · N」) */
export async function visibleTaskCount(page: Page) {
  const text = await page.getByText(/^업무 · \d+$/).textContent()
  return Number(text?.replace(/\D/g, ""))
}
