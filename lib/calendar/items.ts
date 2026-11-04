/**
 * 캘린더 읽기 모델 — 옴니스 안에 흩어진 날짜와 웍스에서 들여온 일정을 한 창(from~until)의 목록으로.
 *
 * 옴니스가 원본인 날짜는 복사하지 않고 여기서 읽는다(파생 층). 새 테이블은 웍스 미러 하나뿐이다.
 * mydocs/tech/calendar.md 3장.
 *
 * 누가 무엇을 보는가 — 기존 화면의 권한을 넓히지 않는다:
 * - 업무: 기본은 내가 담당이거나 지시한 것. 「전체」를 고르면 보관 안 된 업무 전부(업무 화면과 같다)
 * - 주간보고: 내 것만 (주간보고 API 가 그렇다)
 * - 회사 기록 · CRM · 세금계산서: 구성원 전체 (각 화면이 그렇다)
 * - 웍스 캘린더: 관리자가 연 캘린더만. 관리자는 전부
 */

import { prisma } from "@/lib/db"
import { configuredCalendarNames, davConfigFromEnv } from "@/lib/caldav/client"
import { PROVIDER } from "@/lib/caldav/sync"
import { SEOUL, fromWall, toWall } from "@/lib/calendar/time"
import { worksItems } from "@/lib/calendar/works"
import type { CalendarGroup, CalendarItem, CalendarResponse, CalendarSource } from "@/lib/calendar/types"
import { RECORD_KIND_LABEL } from "@/lib/schemas/company"

const DAY_MS = 86_400_000

type Ymd = { year: number; month: number; day: number }

/**
 * 날짜 칸이 가리키는 달력 날짜. 칸마다 저장 꼴이 다르다(2026-10-28 로컬 스냅샷 실측):
 * 업무 마감은 서울 자정(15:00Z), 회사 기록 · CRM · 세금계산서는 UTC 자정, 일부는 실제 시각.
 * UTC 자정이면 UTC 날짜, 아니면 서울 날짜 — 세 꼴 모두 맞는 날이 나온다.
 */
export function calendarDate(d: Date): Ymd {
  const utcMidnight =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  if (utcMidnight) return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
  const w = toWall(d, SEOUL)
  return { year: w.year, month: w.month, day: w.day }
}

const seoulMidnightOf = (ymd: Ymd) => fromWall({ ...ymd, hour: 0, minute: 0, second: 0 }, SEOUL)

/** 종일 칸. 끝 날짜가 있으면 그날까지 포함한다 */
export function allDaySpan(first: Date, last?: Date | null): { start: Date; end: Date } {
  const start = seoulMidnightOf(calendarDate(first))
  const lastStart = last ? seoulMidnightOf(calendarDate(last)) : start
  const end = new Date(Math.max(lastStart.getTime(), start.getTime()) + DAY_MS)
  return { start, end }
}

function allDayItem(
  base: Omit<CalendarItem, "start" | "end" | "allDay">,
  first: Date,
  last?: Date | null
): CalendarItem {
  const { start, end } = allDaySpan(first, last)
  return { ...base, start: start.toISOString(), end: end.toISOString(), allDay: true }
}

/** 날짜 칸을 거를 때 쓰는 넉넉한 창 — 저장 꼴(UTC/서울 자정) 차이로 하루가 어긋나는 것을 덮는다 */
const widen = (from: Date, until: Date) => ({ gte: new Date(from.getTime() - DAY_MS), lt: new Date(until.getTime() + DAY_MS) })

const inWindow = (item: CalendarItem, from: Date, until: Date) =>
  new Date(item.start) < until && new Date(item.end) > from

export type CalendarQuery = {
  from: Date
  until: Date
  groups: CalendarGroup[]
  viewer: { id: string; isAdmin: boolean }
  /** 업무: 내 것만(기본) · 전체 */
  taskScope?: "mine" | "all"
}

export async function getCalendarItems(q: CalendarQuery): Promise<CalendarResponse> {
  const want = new Set(q.groups)
  const range = widen(q.from, q.until)
  const jobs: Promise<CalendarItem[]>[] = []

  if (want.has("tasks")) jobs.push(taskItems(q, range))
  if (want.has("projects")) jobs.push(projectItems(q))
  if (want.has("records")) jobs.push(recordItems(q))
  if (want.has("crm")) jobs.push(crmItems(range))
  if (want.has("finance")) jobs.push(financeItems(range))
  if (want.has("reports")) jobs.push(reportItems(q, range))

  const [calendars, works] = await worksPart(q, want.has("works"))
  const lists = await Promise.all(jobs)
  const items = [...lists.flat().filter((i) => inWindow(i, q.from, q.until)), ...works]
  items.sort((a, b) => a.start.localeCompare(b.start) || Number(b.allDay) - Number(a.allDay))

  return { items, calendars, worksConfigured: davConfigFromEnv() !== null && configuredCalendarNames().length > 0 }
}

type Range = ReturnType<typeof widen>

async function taskItems(q: CalendarQuery, range: Range): Promise<CalendarItem[]> {
  const tasks = await prisma.task.findMany({
    where: {
      archived: false,
      deadline: range,
      ...(q.taskScope === "all"
        ? {}
        : { OR: [{ instructorId: q.viewer.id }, { assignees: { some: { userId: q.viewer.id } } }] }),
    },
    select: { id: true, name: true, deadline: true, status: true },
  })
  // workStart · workEnd 는 쓰지 않는다 — workEnd 는 계획이 아니라 완료한 시각이다(DONE 으로 바꿀 때 찍힌다)
  return tasks.map((t) =>
    allDayItem(
      { id: `task:${t.id}`, group: "tasks", tag: "마감", title: t.name, href: `/tasks/${t.id}`, muted: t.status === "DONE" },
      t.deadline!
    )
  )
}

async function projectItems(q: CalendarQuery): Promise<CalendarItem[]> {
  // 기간이 창과 겹치는 프로젝트. 시작만 · 마감만 있는 것도 그 하루로 그린다 —
  // 첫날은 startDate ?? deadline, 끝날은 deadline ?? startDate. 둘 다 비면 어느 조건도 맞지 않아 빠진다
  const before = new Date(q.until.getTime() + DAY_MS)
  const after = new Date(q.from.getTime() - DAY_MS)
  const projects = await prisma.project.findMany({
    where: {
      archived: false,
      AND: [
        { OR: [{ startDate: { lt: before } }, { startDate: null, deadline: { lt: before } }] },
        { OR: [{ deadline: { gte: after } }, { deadline: null, startDate: { gte: after } }] },
      ],
    },
    select: { id: true, name: true, startDate: true, deadline: true, status: true },
  })
  return projects.map((p) =>
    allDayItem(
      { id: `project:${p.id}`, group: "projects", tag: "프로젝트", title: p.name, href: "/tasks/projects", muted: p.status === "완료" },
      (p.startDate ?? p.deadline)!,
      p.deadline ?? p.startDate
    )
  )
}

async function recordItems(q: CalendarQuery): Promise<CalendarItem[]> {
  const records = await prisma.companyRecord.findMany({
    where: {
      startsOn: { not: null, lt: new Date(q.until.getTime() + DAY_MS) },
      OR: [{ endsOn: { gte: new Date(q.from.getTime() - DAY_MS) } }, { endsOn: null, startsOn: { gte: new Date(q.from.getTime() - DAY_MS) } }],
    },
    select: { id: true, title: true, kind: true, startsOn: true, endsOn: true, venue: true },
  })
  return records.map((r) =>
    allDayItem(
      {
        id: `record:${r.id}`,
        group: "records",
        tag: RECORD_KIND_LABEL[r.kind] ?? "기록",
        title: r.title,
        href: "/omnis/records",
        location: r.venue,
      },
      r.startsOn!,
      r.endsOn
    )
  )
}

async function crmItems(range: Range): Promise<CalendarItem[]> {
  const [quotes, samples, sent, shipments, productions] = await Promise.all([
    prisma.crmQuote.findMany({
      where: { quotedAt: range },
      select: { id: true, code: true, quotedAt: true, status: true, org: { select: { name: true } } },
    }),
    prisma.crmSampleRequest.findMany({
      where: { requestedAt: range },
      select: { id: true, requestedAt: true, org: { select: { name: true } } },
    }),
    prisma.crmSampleRequest.findMany({
      where: { sentAt: range },
      select: { id: true, sentAt: true, org: { select: { name: true } } },
    }),
    prisma.crmShipment.findMany({
      where: { shippedAt: range },
      select: { id: true, shippedAt: true, quantity: true, org: { select: { name: true } }, product: { select: { name: true } } },
    }),
    prisma.crmProduction.findMany({
      where: { producedAt: range },
      select: { id: true, producedAt: true, quantity: true, product: { select: { name: true } } },
    }),
  ])
  return [
    ...quotes.map((x) =>
      allDayItem(
        { id: `quote:${x.id}`, group: "crm", tag: "견적", title: `${x.org.name} · ${x.code}`, href: `/crm/quotes/${x.id}`, muted: x.status === "CANCELLED" },
        x.quotedAt
      )
    ),
    ...samples.map((x) =>
      allDayItem({ id: `sample:${x.id}`, group: "crm", tag: "샘플 신청", title: x.org.name, href: "/crm/samples" }, x.requestedAt)
    ),
    ...sent.map((x) =>
      allDayItem({ id: `sample-sent:${x.id}`, group: "crm", tag: "샘플 발송", title: x.org.name, href: "/crm/samples" }, x.sentAt!)
    ),
    ...shipments.map((x) =>
      allDayItem(
        { id: `shipment:${x.id}`, group: "crm", tag: "출고", title: `${x.org.name} · ${x.product.name} ${x.quantity}`, href: "/crm/inventory" },
        x.shippedAt
      )
    ),
    ...productions.map((x) =>
      allDayItem(
        { id: `production:${x.id}`, group: "crm", tag: "생산", title: `${x.product.name} ${x.quantity}`, href: "/crm/inventory" },
        x.producedAt
      )
    ),
  ]
}

async function financeItems(range: Range): Promise<CalendarItem[]> {
  const [invoices, payments] = await Promise.all([
    prisma.taxInvoice.findMany({
      where: { issuedOn: range },
      select: { id: true, issuedOn: true, direction: true, buyerName: true, supplierName: true },
    }),
    prisma.crmPayment.findMany({
      where: { paidOn: range },
      select: { id: true, paidOn: true, invoice: { select: { buyerName: true } } },
    }),
  ])
  // 금액은 싣지 않는다 — 달력 칸에서 숫자는 읽히지도 않고, 필요한 사람은 원본 화면으로 간다
  return [
    ...invoices.map((x) =>
      allDayItem(
        {
          id: `invoice:${x.id}`,
          group: "finance",
          tag: x.direction === "SALE" ? "매출 계산서" : "매입 계산서",
          title: x.direction === "SALE" ? x.buyerName : x.supplierName,
          href: "/crm/invoices",
        },
        x.issuedOn
      )
    ),
    ...payments.map((x) =>
      allDayItem({ id: `payment:${x.id}`, group: "finance", tag: "입금", title: x.invoice.buyerName, href: "/crm/invoices" }, x.paidOn)
    ),
  ]
}

async function reportItems(q: CalendarQuery, range: Range): Promise<CalendarItem[]> {
  const reports = await prisma.weeklyReport.findMany({
    where: { ownerId: q.viewer.id, submittedAt: range },
    select: { id: true, title: true, submittedAt: true },
  })
  return reports.map((r) =>
    allDayItem({ id: `report:${r.id}`, group: "reports", tag: "주간보고", title: r.title, href: `/reports/${r.id}` }, r.submittedAt!)
  )
}

/** 웍스 캘린더를 누가 보는가 — 관리자는 전부, 나머지는 관리자가 연(ALL) 캘린더만. 에이전트 도구(list_calendar)도 이 함수를 거친다 */
export const visibleCalendarFilter = (viewer: CalendarQuery["viewer"]) => (viewer.isAdmin ? {} : { audience: "ALL" as const })

async function worksPart(q: CalendarQuery, include: boolean): Promise<[CalendarSource[], CalendarItem[]]> {
  const names = configuredCalendarNames()
  if (names.length === 0) return [[], []]

  const calendars = await prisma.externalCalendar.findMany({
    where: {
      provider: PROVIDER,
      displayName: { in: names },
      ...visibleCalendarFilter(q.viewer),
    },
    orderBy: { displayName: "asc" },
  })
  const sources: CalendarSource[] = calendars.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    audience: c.audience,
    syncedAt: c.syncedAt?.toISOString() ?? null,
    ...(q.viewer.isAdmin ? { lastError: c.lastError } : {}),
  }))
  if (!include || calendars.length === 0) return [sources, []]

  const ids = calendars.map((c) => c.id)
  const nameOf = new Map(calendars.map((c) => [c.id, c.displayName]))
  const select = {
    id: true, calendarId: true, uid: true, recurrenceId: true, summary: true, description: true, location: true,
    startAt: true, endAt: true, isAllDay: true, tzid: true, rrule: true, exdates: true, status: true,
  } as const

  // 창과 겹치는 단일 일정 · 예외 회차, 창에 회차가 걸칠 수 있는 반복 마스터
  const inRange = await prisma.externalCalendarEvent.findMany({
    where: {
      calendarId: { in: ids },
      deletedAt: null,
      startAt: { lt: q.until },
      OR: [
        { rrule: null, endAt: { gte: q.from } },
        { rrule: { not: null }, OR: [{ recurUntil: null }, { recurUntil: { gt: q.from } }] },
      ],
    },
    select,
  })
  // 그 마스터들의 예외 회차는 창과 상관없이 전부 — 창 밖으로 옮겨진 회차의 원래 자리를 비우려고
  const masterUids = [...new Set(inRange.filter((r) => r.rrule).map((r) => r.uid))]
  const exceptions = masterUids.length
    ? await prisma.externalCalendarEvent.findMany({
        where: { calendarId: { in: ids }, deletedAt: null, uid: { in: masterUids }, recurrenceId: { not: "" } },
        select,
      })
    : []

  const seen = new Set<string>()
  const rows = [...inRange, ...exceptions]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({ ...r, calendarName: nameOf.get(r.calendarId) ?? "" }))
  return [sources, worksItems(rows, q.from, q.until)]
}
