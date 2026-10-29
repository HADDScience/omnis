import { test, expect, type Page } from "@playwright/test"
import { login } from "./_setup"
import { gotoTab, openMy } from "./_actions"

/**
 * 폰(390px 터치) 화면 게이트. `mobile` 프로젝트가 이 파일(@mobile)만 돈다.
 * 2026-10-29 폰에서 업무 현황 칩이 44px 알약으로 부풀고 툴바가 두 줄로 꺾였는데, CI 는 PC 크기만 돌아 놓쳤다.
 */

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, "페이지가 가로로 밀리면 안 된다").toBeLessThanOrEqual(0)
}

test.describe("폰 화면", { tag: "@mobile" }, () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  // 지키는 것: 폰에서는 화면 아래 주 메뉴로 채팅 · 업무 · 캘린더 · 아카이브를 오가고, 어느 탭도 가로로 밀리지 않는다
  test("하단 주 메뉴로 탭을 오가고 가로로 밀리지 않는다", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "주 메뉴" }).filter({ visible: true })
    const box = await nav.boundingBox()
    expect(box!.y, "폰의 주 메뉴는 화면 아래쪽에 있다").toBeGreaterThan(844 / 2)
    for (const name of ["채팅", "업무", "캘린더", "아카이브"]) {
      await expect(nav.getByRole(name === "채팅" ? "button" : "link", { name, exact: true })).toBeVisible()
    }
    await expectNoHorizontalScroll(page)
    for (const tab of ["캘린더", "아카이브", "업무"] as const) {
      await gotoTab(page, tab)
      await expectNoHorizontalScroll(page)
    }
  })

  // 지키는 것: 폰에서도 하단 nav 오른쪽의 마이 원으로 계정 화면에 간다(PC 와 같은 「캡슐 + 내 원」)
  test("마이 동그라미로 계정 화면에 간다", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "주 메뉴" }).filter({ visible: true })
    const me = nav.getByRole("link", { name: /^마이/ })
    const box = await me.boundingBox()
    expect(Math.abs(box!.width - box!.height), "마이는 동그란 원이다").toBeLessThan(2)
    await openMy(page)
    await expect(page.getByRole("button", { name: "온보딩 튜토리얼 다시 보기" })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  // 지키는 것: 업무 현황 칩 · 툴바 버튼은 보이는 모양이 작고(알약으로 부풀지 않고) 누르는 자리는 44px 이며,
  // 업무 툴바는 한 줄에 들어간다
  test("업무 현황 칩·툴바가 부풀지 않고 툴바는 한 줄", async ({ page }) => {
    const controls = [
      page.getByRole("link", { name: /^멈춤/ }),
      page.getByRole("button", { name: /^진행률 기간/ }),
      page.getByRole("button", { name: /필터/ }),
      page.getByRole("button", { name: "보드", exact: true }),
    ]
    for (const control of controls) {
      const size = await control.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = getComputedStyle(el, "::after")
        return {
          height: r.height,
          // .touch-hit 의 보이지 않는 누름 막. 막이 없으면 보이는 크기가 곧 누르는 크기다
          hitHeight: hit.content !== "none" ? parseFloat(hit.height) : r.height,
        }
      })
      expect(size.height, "보이는 높이가 44px 알약으로 부풀면 안 된다").toBeLessThan(40)
      expect(size.hitHeight, "누르는 자리는 44px 이상").toBeGreaterThanOrEqual(44)
    }
    // 툴바 한 줄: 건수와 「보드」 버튼이 같은 줄에 있다
    const count = await page.getByText(/^업무 · \d+$/).boundingBox()
    const board = await page.getByRole("button", { name: "보드", exact: true }).boundingBox()
    expect(Math.abs(count!.y + count!.height / 2 - (board!.y + board!.height / 2))).toBeLessThan(12)
    await expectNoHorizontalScroll(page)
  })
})
