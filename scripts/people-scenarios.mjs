// 사람끼리 대화(5단계) 화면 시나리오 — 로컬 dev 서버, 모델을 부르지 않는다(비용 0).
//   A=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts 정우창) B=$(… 윤훈) C=$(… 허찬) \
//   AN=정우창 BN=윤훈 CN=허찬 BASE=http://localhost:3103 node scripts/people-scenarios.mjs
// A 가 B 와 1:1 → B 가 보고 답장 → A 목록에 안읽음 배지 → 같은 사람 다시 고르면 같은 방 →
// 단톡방 만들기 · 초대 · 나가기 → C 는 1:1 주소 404 · 목록에 없음. 스크린샷: mydocs/working/omnis-agent/5-*.png
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3103"
const { A, B, C, AN, BN, CN } = process.env
if (!A || !B || !C || !AN || !BN || !CN) throw new Error("A · B · C 토큰과 AN · BN · CN 이름이 필요하다")
const OUT = "mydocs/working/omnis-agent"
mkdirSync(OUT, { recursive: true })
const TAG = `5단계 ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`

const browser = await chromium.launch()
async function pageAt(token, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 812 }, deviceScaleFactor: width >= 1000 ? 1 : 2, locale: "ko-KR" })
  await ctx.addCookies([{ name: "authjs.session-token", value: token, url: BASE }])
  const page = await ctx.newPage()
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)) })
  return page
}
const shot = async (page, name) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  📷 ${OUT}/${name}.png (가로 넘침 ${overflow}px)`)
}
/** 누르고 주소가 바뀔 때까지 — 하이드레이션 전에 누르면 한 번 놓친다. 세 번까지 다시 누른다 */
async function clickTo(page, locator, url) {
  for (let i = 0; i < 3; i++) {
    await locator.click()
    try {
      await page.waitForURL(url, { waitUntil: "commit", timeout: 12000 })
      await page.waitForTimeout(800)
      return
    } catch {
      /* 다시 */
    }
  }
  throw new Error(`이동하지 못함: ${url}`)
}
let failed = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}
const list = (page) => page.getByRole("navigation", { name: "채팅방" })
/** dev 에서는 폴링 · HMR 연결 때문에 load 가 늦게 오거나 오지 않는 일이 있다 — 문서가 오면 그 뒤 한숨 돌리고 간다 */
async function go(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

async function pickPeople(page, names) {
  for (const n of names) {
    await page.getByLabel("대화할 사람 찾기").fill(n)
    await page.getByRole("checkbox", { name: n, exact: true }).click()
  }
  await page.getByLabel("대화할 사람 찾기").fill("")
}

async function send(page, text) {
  const box = page.getByLabel("메시지 입력")
  await box.fill(text)
  await box.press("Enter")
  await page.getByRole("log").getByText(text).first().waitFor({ timeout: 15000 })
}

// ── PC 1440: A 가 「새 대화」 → 「사람과 대화」 → B 1:1
console.log("[1] 1:1 만들기 (A, 1440)")
const a = await pageAt(A, 1440)
await go(a, `${BASE}/chat`)
await a.getByRole("button", { name: "새 대화" }).click()
await a.getByRole("menuitem", { name: /사람과 대화/ }).waitFor()
await shot(a, "5-1440-1-new-menu")
await clickTo(a, a.getByRole("menuitem", { name: /사람과 대화/ }), "**/chat/new/people")
await pickPeople(a, [BN])
await shot(a, "5-1440-1-pick-one")
await clickTo(a, a.getByRole("button", { name: `${BN}님과 1:1 대화` }), /\/chat\/[0-9a-f-]{36}$/)
const dmUrl = a.url()
await send(a, `${TAG} 안녕하세요 @${BN} 견적 건 확인 부탁드려요`)
await a.waitForTimeout(500)
await shot(a, "5-1440-1-dm-sent")
check("1:1 머리에 상대 이름", (await a.getByRole("heading", { level: 1 }).first().innerText()).includes(BN))

// ── B: 목록에 보이고, 열고, 답장
console.log("[2] B 에게 보이고 답장 (B, 1440)")
const b = await pageAt(B, 1440)
await go(b, `${BASE}/chat`)
const bRow = list(b).getByRole("link", { name: new RegExp(AN) }).first()
await bRow.waitFor({ timeout: 45000 })
check("B 목록에 A 와의 1:1 이 보인다", await bRow.isVisible())
check("B 목록 그 줄에 안읽음 배지", (await bRow.getByLabel(/안 읽은 글/).count()) > 0)
await shot(b, "5-1440-2-b-list-unread")
await clickTo(b, bRow, dmUrl)
await b.getByRole("log").getByText(`${TAG} 안녕하세요`).first().waitFor()
await send(b, `${TAG} 네 확인했습니다`)
await shot(b, "5-1440-2-b-replied")
const bell = await b.evaluate(async () => (await (await fetch("/api/notifications")).json()))
const mention = (bell.notifications ?? bell).find?.((n) => n.type === "chat_mention")
check("B 알림에 멘션(「…님이 1:1 대화에서 불렀어요」)", !!mention, mention?.title)

// ── A: 목록에 안읽음 배지(다른 방에 있다가 목록을 다시 읽는다)
console.log("[3] A 에게 안읽음 배지")
await go(a, `${BASE}/chat/new`)
const aRow = list(a).getByRole("link", { name: new RegExp(BN) }).first()
await aRow.waitFor()
await a.waitForTimeout(500)
check("A 목록 B 줄에 안읽음 배지", (await aRow.getByLabel(/안 읽은 글/).count()) > 0)
await shot(a, "5-1440-3-a-unread")
await a.getByRole("button", { name: /^안읽음/ }).click()
await shot(a, "5-1440-3-a-unread-chip")
check("「안읽음」 칩에 그 방", (await list(a).getByRole("link", { name: new RegExp(BN) }).count()) > 0)
await a.getByRole("button", { name: /^전체/ }).click()

// ── 같은 사람과 다시 → 같은 방
console.log("[4] 같은 사람과 다시 「사람과 대화」")
await go(a, `${BASE}/chat/new/people`)
await pickPeople(a, [BN])
await clickTo(a, a.getByRole("button", { name: `${BN}님과 1:1 대화` }), /\/chat\/[0-9a-f-]{36}$/)
check("같은 방이 열린다", a.url() === dmUrl, { got: a.url(), want: dmUrl })

// ── 단톡방: A 가 B · C → 이름 바꿔서 만들기
console.log("[5] 단톡방 만들기 · 초대 · 나가기")
await go(a, `${BASE}/chat/new/people`)
await pickPeople(a, [BN])
// C 는 처음엔 빼고, 다른 한 명과 만든 뒤 C 를 초대한다
const others = await a.evaluate(async (skip) => (await (await fetch("/api/users")).json()).filter((u) => !skip.includes(u.name)).map((u) => u.name), [AN, BN, CN, "Omnis"])
const D = others[0]
await pickPeople(a, [D])
await shot(a, "5-1440-5-pick-two")
const nameBox = a.getByLabel("단톡방 이름")
check("기본 이름은 참여자 이름을 잇는다", (await nameBox.inputValue()) === `${BN}, ${D}, ${AN}`, await nameBox.inputValue())
await nameBox.fill(`${TAG} 견적 TF`)
await clickTo(a, a.getByRole("button", { name: "3명 단톡방 만들기" }), /\/chat\/[0-9a-f-]{36}$/)
const groupUrl = a.url()
await send(a, `${TAG} 단톡방 첫 글`)
check("머리에 단톡방 이름 · 3명", (await a.getByText("단톡방 · 3명").count()) > 0)
await shot(a, "5-1440-5-group")
await a.getByRole("button", { name: "참여자 3명" }).click()
await a.getByRole("button", { name: "초대하기" }).click()
await pickPeople(a, [CN])
await shot(a, "5-1440-5-invite")
await a.getByRole("button", { name: "1명 초대" }).click()
await a.getByRole("dialog").getByRole("heading", { name: "참여자 4명" }).waitFor({ timeout: 10000 })
check("초대 뒤 4명", true)
await a.keyboard.press("Escape")

// C 가 단톡방을 보고 나간다 — 폰 375
console.log("[6] C 가 단톡방에서 나가기 (375)")
const c = await pageAt(C, 375)
await go(c, `${BASE}/chat`)
const cGroup = list(c).getByRole("link", { name: new RegExp(`${TAG} 견적 TF`) })
await cGroup.waitFor({ timeout: 15000 })
await shot(c, "5-375-6-c-list")
await clickTo(c, cGroup, groupUrl)
await c.getByRole("log").getByText(`${TAG} 단톡방 첫 글`).waitFor()
await shot(c, "5-375-6-c-group")
await c.getByRole("button", { name: "참여자 4명" }).click()
await shot(c, "5-375-6-c-members")
await c.getByRole("button", { name: "나가기" }).click()
await shot(c, "5-375-6-c-leave-confirm")
await c.getByRole("alertdialog").getByRole("button", { name: "나가기" }).click()
await c.waitForURL(`${BASE}/chat`, { waitUntil: "commit" })
await c.waitForTimeout(800)
check("나간 C 의 목록에 단톡방이 없다", (await list(c).getByRole("link", { name: new RegExp(`${TAG} 견적 TF`) }).count()) === 0)
await shot(c, "5-375-6-c-after-leave")

// ── C 는 A·B 1:1 을 못 연다
console.log("[7] 참여자가 아닌 C")
await go(c, dmUrl)
await c.waitForTimeout(1500)
const body = await c.locator("body").innerText()
check("C 가 1:1 주소를 열면 404 화면 · 글 없음", /404|찾을 수 없/.test(body) && !body.includes(`${TAG} 안녕하세요`))
await shot(c, "5-375-7-c-404")
check("C 목록에 A·B 1:1 이 없다", (await c.evaluate(async (id) => JSON.stringify(await (await fetch("/api/chat/rooms")).json()).includes(id), dmUrl.split("/").pop())) === false)

// ── 폰 375 A: 목록 · 1:1 · 사람 고르기
console.log("[8] 폰 375 (A)")
const a375 = await pageAt(A, 375)
await go(a375, `${BASE}/chat`)
await list(a375).getByRole("link", { name: new RegExp(BN) }).first().waitFor()
await shot(a375, "5-375-8-a-list")
await go(a375, dmUrl)
await a375.getByRole("log").getByText(`${TAG} 네 확인했습니다`).waitFor()
await shot(a375, "5-375-8-a-dm")
await go(a375, `${BASE}/chat/new/people`)
await a375.getByLabel("대화할 사람 찾기").waitFor()
await pickPeople(a375, [BN, CN])
await shot(a375, "5-375-8-a-pick")

console.log(failed === 0 ? "전부 통과" : `실패 ${failed}건`)
console.log(`1:1 ${dmUrl}\n단톡 ${groupUrl}`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
