/**
 * 웍스 캘린더 → ExternalCalendar / ExternalCalendarEvent 동기화. 서버에서만 부른다.
 *
 * 한 주기는 이렇다 (mydocs/tech/calendar.md 2.1):
 *   ① 캘린더 홈 PROPFIND        요청 1건  → 캘린더마다 getctag
 *   ② ctag 가 바뀐 캘린더만       sync-collection → 바뀐 href + 404 묘비
 *   ③ etag 가 달라진 href 만      calendar-multiget → 본문
 * 아무 일도 없던 주기는 요청 1건으로 끝난다.
 *
 * 웍스 쪽은 읽기만 한다. 옴니스 DB 에만 쓴다.
 */

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import {
  CalDavError,
  type DavConfig,
  type FetchedResource,
  configuredCalendarNames,
  davConfigFromEnv,
  listCalendars,
  multiget,
  rewindSyncToken,
  syncCollection,
} from "@/lib/caldav/client"
import { parseICalendar, type ParsedEvent } from "@/lib/caldav/ical"
import { recurrenceEnd } from "@/lib/calendar/recurrence"

export const PROVIDER = "naver-works"

/** 열람 시 갱신의 최소 간격. 이보다 최근에 시도했으면 당기지 않는다 */
export const SYNC_INTERVAL_MS = 60_000

export type CalendarSyncOutcome = {
  displayName: string
  status: "unchanged" | "synced" | "error"
  changed: number
  deleted: number
  fetched: number
  error?: string
}

export type SyncReport =
  | { configured: false }
  | { configured: true; skipped: true; lastAttemptAt: Date }
  | {
      configured: true
      skipped: false
      /** CalDAV 로 보낸 요청 수 — 변경이 없으면 1 이어야 한다 */
      requests: number
      calendars: CalendarSyncOutcome[]
      /** 설정에 있지만 웍스에서 찾지 못한 이름 */
      missing: string[]
    }

// 같은 인스턴스에서 화면 둘이 동시에 열려도 한 번만 당긴다
let inflight: Promise<SyncReport> | null = null

export async function syncWorksCalendars(opts: { force?: boolean } = {}): Promise<SyncReport> {
  if (inflight) return inflight
  inflight = run(opts).finally(() => {
    inflight = null
  })
  return inflight
}

async function run({ force = false }: { force?: boolean }): Promise<SyncReport> {
  const cfg = davConfigFromEnv()
  const names = configuredCalendarNames()
  if (!cfg || names.length === 0) return { configured: false }

  if (!force) {
    const last = await prisma.externalCalendar.aggregate({
      where: { provider: PROVIDER, displayName: { in: names } },
      _max: { attemptedAt: true },
    })
    const at = last._max.attemptedAt
    if (at && Date.now() - at.getTime() < SYNC_INTERVAL_MS) return { configured: true, skipped: true, lastAttemptAt: at }
  }

  let requests = 0
  const counted: typeof fetch = (input, init) => {
    requests++
    return fetch(input, init)
  }

  const remote = await listCalendars(cfg, counted)
  const wanted = remote.filter((c) => names.includes(c.displayName))
  const missing = names.filter((n) => !wanted.some((c) => c.displayName === n))

  const calendars: CalendarSyncOutcome[] = []
  for (const rc of wanted) {
    const row = await prisma.externalCalendar.upsert({
      where: { provider_externalId: { provider: PROVIDER, externalId: rc.externalId } },
      create: { provider: PROVIDER, externalId: rc.externalId, href: rc.href, displayName: rc.displayName },
      update: { href: rc.href, displayName: rc.displayName },
    })
    const now = new Date()

    if (!force && row.syncToken && row.ctag && row.ctag === rc.ctag) {
      await prisma.externalCalendar.update({ where: { id: row.id }, data: { attemptedAt: now, lastError: null } })
      calendars.push({ displayName: rc.displayName, status: "unchanged", changed: 0, deleted: 0, fetched: 0 })
      continue
    }

    try {
      const outcome = await syncOne(cfg, counted, row.id, rc.href, force ? null : row.syncToken)
      await prisma.externalCalendar.update({
        where: { id: row.id },
        data: {
          ctag: rc.ctag,
          syncToken: rewindSyncToken(outcome.token),
          syncedAt: now,
          attemptedAt: now,
          lastError: null,
        },
      })
      calendars.push({ displayName: rc.displayName, status: "synced", ...outcome.counts })
    } catch (err) {
      const message = err instanceof CalDavError ? err.message : "동기화 중 오류"
      console.error("[caldav:sync]", rc.displayName, err instanceof Error ? err.message : err)
      // 토큰은 그대로 둔다 — 다음 주기가 같은 지점부터 다시 받는다
      await prisma.externalCalendar.update({
        where: { id: row.id },
        data: { attemptedAt: now, lastError: message.slice(0, 500) },
      })
      calendars.push({ displayName: rc.displayName, status: "error", changed: 0, deleted: 0, fetched: 0, error: message })
    }
  }

  return { configured: true, skipped: false, requests, calendars, missing }
}

async function syncOne(
  cfg: DavConfig,
  fetcher: typeof fetch,
  calendarId: string,
  calendarHref: string,
  token: string | null
): Promise<{ token: string | null; counts: Omit<CalendarSyncOutcome, "displayName" | "status"> }> {
  const delta = await syncCollection(cfg, calendarHref, token, fetcher)
  const now = new Date()

  // 묘비부터. 다른 href 로 옮겨 간 일정(…-CMV.ics)은 아래 upsert 가 되살린다
  if (delta.deleted.length > 0) {
    await prisma.externalCalendarEvent.updateMany({
      where: { calendarId, href: { in: delta.deleted }, deletedAt: null },
      data: { deletedAt: now },
    })
  }

  // etag 가 이미 같은 리소스는 다시 받지 않는다. 토큰을 잃어 전체가 다시 와도 본문은 바뀐 것만
  const known = await prisma.externalCalendarEvent.findMany({
    where: { calendarId, href: { in: delta.changed.map((c) => c.href) }, deletedAt: null },
    select: { href: true, etag: true },
  })
  const etagsByHref = new Map<string, Set<string | null>>()
  for (const k of known) etagsByHref.set(k.href, (etagsByHref.get(k.href) ?? new Set()).add(k.etag))
  const toFetch = delta.changed
    .filter((c) => {
      const seen = etagsByHref.get(c.href)
      return !(c.etag && seen && seen.size === 1 && seen.has(c.etag))
    })
    .map((c) => c.href)

  if (token && delta.changed.length >= 50 && delta.changed.length >= known.length * 0.9 && known.length >= 20) {
    // 상한 토큰에 서버는 오류 대신 전체를 준다. 깨지지는 않지만 알아 둔다
    console.warn("[caldav:sync] 토큰이 무시된 것으로 보인다 — 전체가 다시 왔다", { calendarId, changed: delta.changed.length })
  }

  const fetched = toFetch.length > 0 ? await multiget(cfg, calendarHref, toFetch, fetcher) : []
  await upsertResources(calendarId, fetched)

  return {
    token: delta.token,
    counts: { changed: delta.changed.length, deleted: delta.deleted.length, fetched: fetched.length },
  }
}

const keyOf = (uid: string, recurrenceId: string) => `${uid}\u0000${recurrenceId}`

function toRow(calendarId: string, res: FetchedResource, ev: ParsedEvent) {
  return {
    calendarId,
    uid: ev.uid,
    recurrenceId: ev.recurrenceId,
    href: res.href,
    etag: res.etag,
    summary: ev.summary,
    description: ev.description,
    location: ev.location,
    startAt: ev.startAt,
    endAt: ev.endAt,
    isAllDay: ev.isAllDay,
    tzid: ev.tzid,
    rrule: ev.rrule,
    exdates: ev.exdates,
    recurUntil: ev.rrule
      ? recurrenceEnd({
          start: ev.startAt,
          end: ev.endAt,
          isAllDay: ev.isAllDay,
          tzid: ev.tzid,
          rrule: ev.rrule,
          exdates: ev.exdates,
        })
      : null,
    status: ev.status,
    sequence: ev.sequence,
    lastModified: ev.lastModified,
    organizer: ev.organizer,
    attendees: ev.attendees.length > 0 ? (ev.attendees as Prisma.InputJsonValue) : Prisma.DbNull,
    deletedAt: null,
  }
}

/**
 * 받은 리소스를 반영한다. 처음 동기화는 수백 건이라 한 건씩 upsert 하면 DB 왕복이 그만큼 든다 —
 * 새 것은 createMany 한 번, 있던 것만 하나씩 고친다.
 */
async function upsertResources(calendarId: string, resources: FetchedResource[]) {
  if (resources.length === 0) return
  const rows = resources.flatMap((res) => parseICalendar(res.data).map((ev) => toRow(calendarId, res, ev)))

  const existing = await prisma.externalCalendarEvent.findMany({
    where: { calendarId, uid: { in: [...new Set(rows.map((r) => r.uid))] } },
    select: { id: true, uid: true, recurrenceId: true },
  })
  const idByKey = new Map(existing.map((e) => [keyOf(e.uid, e.recurrenceId), e.id]))

  const creates = rows.filter((r) => !idByKey.has(keyOf(r.uid, r.recurrenceId)))
  if (creates.length > 0) {
    await prisma.externalCalendarEvent.createMany({ data: creates, skipDuplicates: true })
  }
  for (const r of rows) {
    const id = idByKey.get(keyOf(r.uid, r.recurrenceId))
    if (id) await prisma.externalCalendarEvent.update({ where: { id }, data: r })
  }

  // 받은 리소스 안에서 사라진 회차(예외 회차를 지웠거나 UID 가 바뀐 것)는 묘비 처리
  const live = new Set(rows.map((r) => keyOf(r.uid, r.recurrenceId)))
  const stale = await prisma.externalCalendarEvent.findMany({
    where: { calendarId, href: { in: resources.map((r) => r.href) }, deletedAt: null },
    select: { id: true, uid: true, recurrenceId: true },
  })
  const goneIds = stale.filter((s) => !live.has(keyOf(s.uid, s.recurrenceId))).map((s) => s.id)
  if (goneIds.length > 0) {
    await prisma.externalCalendarEvent.updateMany({ where: { id: { in: goneIds } }, data: { deletedAt: new Date() } })
  }
}
