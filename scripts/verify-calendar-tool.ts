/**
 * 에이전트 도구 list_calendar 가 캘린더 탭(GET /api/calendar)과 같은 일정을 같은 권한으로 내는지 — 로컬 DB · dev 서버로 대조한다.
 * 모델을 부르지 않는다(비용 0). 아무것도 쓰지 않는다.
 *
 *   CALDAV_CALENDARS="Hadd Science,대표님 일정,바이오아이코어 2026" BASE=http://localhost:3120 \
 *     pnpm exec tsx --env-file=.env scripts/verify-calendar-tool.ts
 *
 * dev 서버도 같은 CALDAV_CALENDARS 로 떠 있어야 한다. 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { SYSTEM_USER_ID } from "../lib/system-user"
import { callerFor, runReadTool } from "../lib/agent/tools"
import type { CalendarResponse } from "../lib/calendar/types"
import { seoulMidnight } from "../lib/calendar/time"

const BASE = process.env.BASE ?? "http://localhost:3120"
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

type U = { id: string; name: string; role: string }
async function cookieFor(user: U) {
  const token = await encode({
    token: { sub: user.id, id: user.id, role: user.role, name: user.name },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 600,
  })
  return `authjs.session-token=${token}`
}

async function calendarTab(user: U, from: Date, until: Date): Promise<CalendarResponse> {
  const res = await fetch(`${BASE}/api/calendar?from=${from.toISOString()}&until=${until.toISOString()}&groups=works`, {
    headers: { cookie: await cookieFor(user) },
  })
  if (!res.ok) throw new Error(`/api/calendar ${res.status}`)
  return res.json()
}

async function tool(user: U, args: Record<string, unknown>): Promise<string> {
  const r = await runReadTool("list_calendar", args, await callerFor(user.id), [])
  return r.text
}

const count = (text: string) => Number(/· (\d+)건/.exec(text)?.[1] ?? -1)
const toolLines = (text: string) => text.split("\n").filter((l) => l.startsWith("- "))

async function main() {
  const host = new URL(process.env.DATABASE_URL!).host
  console.log(`대상 DB: ${host} · 서버: ${BASE} · CALDAV_CALENDARS=${process.env.CALDAV_CALENDARS ?? "(없음)"}`)
  if (!/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) throw new Error("로컬 DB 가 아니다 — 멈춘다")

  const admin = await prisma.user.findFirstOrThrow({ where: { name: "정우창", isActive: true }, select: { id: true, name: true, role: true } })
  const member = await prisma.user.findFirstOrThrow({
    where: { role: "MEMBER", isActive: true, id: { not: SYSTEM_USER_ID } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  })
  console.log(`관리자=${admin.name}(${admin.role}) · 구성원=${member.name}(${member.role})`)

  const windows = [
    { label: "다음 주 11/2~11/8", args: { from: "2026-11-02", to: "2026-11-08" }, from: seoulMidnight(2026, 11, 2), until: seoulMidnight(2026, 11, 9) },
    { label: "이번 달 10/1~10/31", args: { from: "2026-10-01", to: "2026-10-31" }, from: seoulMidnight(2026, 10, 1), until: seoulMidnight(2026, 11, 1) },
    { label: "11월 종일만", args: { from: "2026-11-01", to: "2026-11-30", all_day: true }, from: seoulMidnight(2026, 11, 1), until: seoulMidnight(2026, 12, 1), allDay: true },
  ]

  console.log("[1] 관리자 — 캘린더 탭과 같은 일정")
  for (const w of windows) {
    const tab = await calendarTab(admin, w.from, w.until)
    const tabItems = tab.items.filter((i) => i.group === "works" && (!w.allDay || i.allDay))
    const text = await tool(admin, w.args)
    const lines = toolLines(text)
    check(`${w.label}: 건수 탭 ${tabItems.length} = 도구 ${count(text)}`, tabItems.length === count(text) && lines.length === Math.min(tabItems.length, 100))
    const missing = tabItems.filter((i) => !text.includes(i.title))
    check(`${w.label}: 탭의 제목이 도구 결과에 모두 있다`, missing.length === 0, missing.map((i) => i.title))
    const recurring = tabItems.filter((i) => i.recurring).length
    check(`${w.label}: 반복 회차 탭 ${recurring} = 도구 ${lines.filter((l) => l.includes(" · 반복")).length}`, recurring === lines.filter((l) => l.includes(" · 반복")).length)
  }

  console.log("[2] 구성원 — 탭에서 못 보는 캘린더는 도구로도 못 본다")
  const memberTab = await calendarTab(member, windows[0].from, windows[0].until)
  const memberText = await tool(member, windows[0].args)
  console.log(`    구성원 탭: 캘린더 ${memberTab.calendars.length}개 · 일정 ${memberTab.items.length}건`)
  const adminTab = await calendarTab(admin, windows[0].from, windows[0].until)
  const hidden = adminTab.items.filter((i) => !memberTab.calendars.some((c) => c.id === i.calendarId))
  check(`관리자만 보는 일정 ${hidden.length}건이 구성원 도구 결과에 하나도 없다 (거부되어야 하는 경우)`, hidden.every((i) => !memberText.includes(i.title)))
  const hiddenCalendars = adminTab.calendars.filter((c) => !memberTab.calendars.some((m) => m.id === c.id))
  check(`관리자 전용 캘린더 이름 ${hiddenCalendars.length}개도 드러나지 않는다`, hiddenCalendars.every((c) => !memberText.includes(c.displayName)))
  if (memberTab.calendars.length === 0) check("구성원 결과는 「볼 수 있는 웍스 캘린더가 없습니다」", memberText.startsWith("볼 수 있는 웍스 캘린더가 없습니다"))
  else check(`구성원 건수 탭 ${memberTab.items.length} = 도구 ${count(memberText)}`, memberTab.items.length === count(memberText))

  console.log("[3] 입력 검증 — 거부되어야 하는 경우")
  check("없는 날짜는 오류", (await tool(admin, { from: "2026-02-30" })).startsWith("오류:"))
  check("거꾸로 된 기간은 오류", (await tool(admin, { from: "2026-11-05", to: "2026-11-01" })).startsWith("오류:"))

  console.log("\n--- 관리자 · 다음 주 도구 결과 ---\n" + (await tool(admin, windows[0].args)))
  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과")
  await prisma.$disconnect()
  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
