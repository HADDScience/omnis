/**
 * 네이버 웍스 CalDAV 읽기 클라이언트. 서버에서만 부른다.
 *
 * 2026-10-27 실측(mydocs/tech/calendar.md 1.2)에 맞춘 것:
 * - 서버가 받는 메서드는 OPTIONS · PROPFIND · REPORT 뿐이다. 여기서도 PROPFIND · REPORT 만 보낸다
 * - 변경 감지는 `getctag` 로 한다. `sync-token` 은 캘린더마다 같은 서버 시계라 변경 표시가 아니다
 * - `calendar-query` 는 `calendar-data` 를 요청해도 etag 만 준다. 본문은 `calendar-multiget` 으로
 * - 캘린더 홈에 `sync-collection` 을 보내면 404 다. 캘린더마다 보낸다
 *
 * 자격증명은 환경변수에서만 읽고 로그 · 오류 메시지에 싣지 않는다.
 */

import { find, okProp, parseMultistatus } from "@/lib/caldav/xml"

export type DavConfig = {
  /** 캘린더 홈. …/caldav/{userId}/calendar/ */
  homeUrl: string
  username: string
  password: string
}

type Env = Record<string, string | undefined>

export function davConfigFromEnv(env: Env = process.env): DavConfig | null {
  const homeUrl = env.CALDAV_HOME_URL?.trim()
  const username = env.CALDAV_USERNAME?.trim()
  const password = env.CALDAV_PASSWORD
  if (!homeUrl || !username || !password) return null
  return { homeUrl: homeUrl.endsWith("/") ? homeUrl : `${homeUrl}/`, username, password }
}

/** 옴니스에 들일 캘린더의 표시 이름들. `CALDAV_CALENDARS="Hadd Science,대표님 일정"` */
export function configuredCalendarNames(env: Env = process.env): string[] {
  return (env.CALDAV_CALENDARS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export class CalDavError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "CalDavError"
  }
}

/** 이 클라이언트가 보낼 수 있는 메서드. 쓰기 메서드는 없다 */
const READ_METHODS = new Set(["PROPFIND", "REPORT"])
const TIMEOUT_MS = 30_000

type Fetcher = typeof fetch

async function dav(
  cfg: DavConfig,
  method: "PROPFIND" | "REPORT",
  href: string,
  depth: "0" | "1",
  body: string,
  fetcher: Fetcher
): Promise<string> {
  if (!READ_METHODS.has(method)) throw new Error(`CalDAV: ${method} 은 보내지 않는다`)
  const url = new URL(href, cfg.homeUrl)
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")
  const res = await fetcher(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (res.status !== 207) {
    // 경로만 남긴다. 쿼리스트링·자격증명은 싣지 않는다
    const what = res.status === 401 ? " — 앱 비밀번호가 바뀌었거나 만료됐을 수 있다" : ""
    throw new CalDavError(res.status, `CalDAV ${method} ${url.pathname} → ${res.status}${what}`)
  }
  return text
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export type RemoteCalendar = {
  href: string
  /** 경로의 마지막 칸 */
  externalId: string
  displayName: string
  ctag: string | null
}

const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">
  <D:prop><D:resourcetype/><D:displayname/><CS:getctag/></D:prop>
</D:propfind>`

/** 캘린더 홈 PROPFIND 한 번(요청 1건)으로 캘린더 전부와 ctag 를 받는다 */
export async function listCalendars(cfg: DavConfig, fetcher: Fetcher = fetch): Promise<RemoteCalendar[]> {
  const xml = await dav(cfg, "PROPFIND", cfg.homeUrl, "1", PROPFIND_CALENDARS, fetcher)
  return parseCalendarList(xml)
}

export function parseCalendarList(xml: string): RemoteCalendar[] {
  const out: RemoteCalendar[] = []
  for (const r of parseMultistatus(xml).responses) {
    // 캘린더 홈 자신은 평범한 컬렉션이라 여기서 빠진다
    if (!find(okProp(r, "resourcetype"), "calendar")) continue
    const href = r.href
    out.push({
      href,
      externalId: href.replace(/\/+$/, "").split("/").pop() ?? href,
      displayName: okProp(r, "displayname")?.text.trim() ?? "",
      ctag: okProp(r, "getctag")?.text.trim() || null,
    })
  }
  return out
}

export type SyncResult = {
  token: string | null
  /** 추가·수정된 리소스 */
  changed: { href: string; etag: string | null }[]
  /** 지워진 리소스(404 묘비) */
  deleted: string[]
}

const syncBody = (token: string | null) => `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>${escapeXml(token ?? "")}</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop><D:getetag/></D:prop>
</D:sync-collection>`

/**
 * 토큰 이후의 변경분. 토큰이 비면 전체를 준다.
 * 서버는 상한 토큰에 `valid-sync-token` 오류를 주지 않고 조용히 전체를 준다 — 깨지지는 않는다.
 */
export async function syncCollection(
  cfg: DavConfig,
  calendarHref: string,
  token: string | null,
  fetcher: Fetcher = fetch
): Promise<SyncResult> {
  const xml = await dav(cfg, "REPORT", calendarHref, "0", syncBody(token), fetcher)
  return parseSyncResult(xml)
}

export function parseSyncResult(xml: string): SyncResult {
  const ms = parseMultistatus(xml)
  const changed: SyncResult["changed"] = []
  const deleted: string[] = []
  for (const r of ms.responses) {
    if (r.status === 404) deleted.push(r.href)
    else changed.push({ href: r.href, etag: okProp(r, "getetag")?.text.trim() || null })
  }
  return { token: ms.syncToken, changed, deleted }
}

export type FetchedResource = { href: string; etag: string | null; data: string }

/** 한 번에 보내는 href 수. 10/27 에 100개 묶음으로 809건을 받아 확인했다 */
export const MULTIGET_BATCH = 100

const multigetBody = (hrefs: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
${hrefs.map((h) => `  <D:href>${escapeXml(h)}</D:href>`).join("\n")}
</C:calendar-multiget>`

/** 본문을 받는다. 지워져서 못 받은 href 는 결과에서 빠진다 */
export async function multiget(
  cfg: DavConfig,
  calendarHref: string,
  hrefs: string[],
  fetcher: Fetcher = fetch
): Promise<FetchedResource[]> {
  const out: FetchedResource[] = []
  for (let i = 0; i < hrefs.length; i += MULTIGET_BATCH) {
    const xml = await dav(cfg, "REPORT", calendarHref, "1", multigetBody(hrefs.slice(i, i + MULTIGET_BATCH)), fetcher)
    out.push(...parseMultigetResult(xml))
  }
  return out
}

export function parseMultigetResult(xml: string): FetchedResource[] {
  const out: FetchedResource[] = []
  for (const r of parseMultistatus(xml).responses) {
    const data = okProp(r, "calendar-data")?.text
    if (!data) continue
    out.push({ href: r.href, etag: okProp(r, "getetag")?.text.trim() || null, data })
  }
  return out
}

/**
 * 서버가 주는 sync-token 은 `2026-10-27 17:16:41` 같은 초 단위 평문 시각이다.
 * 같은 초에 두 건이 바뀌고 그 사이에 토큰을 받으면 한 건을 놓친다 — 3초 되돌려 저장하고,
 * 겹쳐 받는 것은 upsert 로 흘린다. 꼴이 다르면(서버가 바뀌면) 그대로 둔다.
 */
export function rewindSyncToken(token: string | null, seconds = 3): string | null {
  if (!token) return token
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(token)
  if (!m) return token
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - seconds * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`
}
