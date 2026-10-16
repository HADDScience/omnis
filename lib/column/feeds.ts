/**
 * 칼럼 키워드 후보를 모으는 무료 피드.
 *
 * 2026-10-16 에 주소를 하나씩 열어 확인한 것만 둔다. 부처별 korea.kr RSS(dept_*.xml)는 404 라
 * 정책브리핑은 Google 뉴스의 `site:korea.kr` 검색으로 대신 받는다. 기업마당(bizinfo) 지원사업
 * API 는 무료지만 키가 있어야 해서, BIZINFO_API_KEY 가 있을 때만 읽는다.
 *
 * 출처 URL 은 여기서 읽은 것만 저장된다. 모델은 항목 번호로만 가리킨다(collect.ts).
 */

export interface FeedItem {
  title: string
  url: string
  publisher: string
  /** ISO 문자열. 피드에 날짜가 없으면 null */
  date: string | null
  feed: string
}

export interface FeedResult {
  feed: string
  url: string
  fetched: number
  ok: boolean
  error?: string
}

interface FeedDef {
  id: string
  url: string
  /** 매체 이름이 피드에 없을 때 쓴다 */
  publisher?: string
}

const gnews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:14d`)}&hl=ko&gl=KR&ceid=KR:ko`

/** 질의어는 바이오 전반 + 정부 지원 동향. 특정 질환·치료제로 좁히지 않는다(10/13 회의). */
export const FEEDS: FeedDef[] = [
  { id: "gnews:바이오 산업", url: gnews("바이오 산업") },
  { id: "gnews:신약 개발", url: gnews("신약 개발") },
  { id: "gnews:재생의료", url: gnews("재생의료") },
  { id: "gnews:세포치료제", url: gnews("세포치료제") },
  { id: "gnews:오가노이드", url: gnews("오가노이드") },
  { id: "gnews:동물대체시험", url: gnews("동물대체시험") },
  { id: "gnews:AI 신약", url: gnews("AI 신약") },
  { id: "gnews:바이오 정부지원", url: gnews("바이오 정부 지원") },
  { id: "gnews:바이오 규제", url: gnews("바이오 규제 개선") },
  { id: "gnews:바이오 투자", url: gnews("바이오 벤처 투자") },
  { id: "gnews:정책브리핑 바이오", url: gnews("site:korea.kr 바이오"), publisher: "정책브리핑" },
  { id: "mfds:보도자료", url: "https://www.mfds.go.kr/www/rss/brd.do?brdId=ntc0021", publisher: "식품의약품안전처" },
]

const TIMEOUT_MS = 15_000
/** 피드 하나에서 최대 몇 건. Google 뉴스는 100건까지 주는데 뒤쪽은 오래되고 겹친다 */
const PER_FEED = 25

const unescapeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim()

const tag = (item: string, name: string) => {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? unescapeXml(m[1]) : ""
}

/** RSS 2.0 의 <item> 만 읽는다. 쓰는 피드가 전부 RSS 2.0 이라 XML 파서를 들이지 않는다. */
export function parseRss(xml: string, def: FeedDef): FeedItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  return items.slice(0, PER_FEED).flatMap((item) => {
    let title = tag(item, "title")
    const url = tag(item, "link")
    if (!title || !url) return []
    // Google 뉴스는 제목 끝에 " - 매체명" 을 붙이고 <source> 에도 매체를 준다
    const source = tag(item, "source")
    let publisher = source || def.publisher || ""
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3))
    if (!publisher) publisher = new URL(url).hostname
    const raw = tag(item, "pubDate") || tag(item, "dc:date")
    const d = raw ? new Date(raw) : null
    return [{ title, url, publisher, date: d && !isNaN(d.getTime()) ? d.toISOString() : null, feed: def.id }]
  })
}

async function fetchFeed(def: FeedDef): Promise<{ items: FeedItem[]; result: FeedResult }> {
  try {
    const res = await fetch(def.url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; HADD-Omnis/1.0)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const items = parseRss(await res.text(), def)
    return { items, result: { feed: def.id, url: def.url, fetched: items.length, ok: true } }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { items: [], result: { feed: def.id, url: def.url, fetched: 0, ok: false, error } }
  }
}

/** 기업마당 지원사업 공고. 키가 없으면 건너뛴다(결과에 그렇게 적힌다).
 *  요청 파라미터(crtfcKey · dataType · hashtags)는 키를 받은 뒤 실제 응답으로 확인해야 한다 — 아직 한 번도 불러 보지 않았다. */
async function fetchBizinfo(): Promise<{ items: FeedItem[]; result: FeedResult }> {
  const key = process.env.BIZINFO_API_KEY
  const url = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"
  if (!key) return { items: [], result: { feed: "bizinfo", url, fetched: 0, ok: false, error: "BIZINFO_API_KEY 없음" } }
  const def: FeedDef = { id: "bizinfo", url, publisher: "기업마당" }
  return fetchFeed({ ...def, url: `${url}?crtfcKey=${encodeURIComponent(key)}&dataType=rss&searchCnt=50&hashtags=${encodeURIComponent("바이오")}` })
}

/**
 * 전부 동시에 읽는다. 같은 기사가 여러 질의에 걸리므로 URL·제목으로 한 번 거르고,
 * 2주보다 오래된 것은 뺀다.
 */
export async function fetchAllFeeds(now = new Date()): Promise<{ items: FeedItem[]; results: FeedResult[] }> {
  const all = await Promise.all([...FEEDS.map(fetchFeed), fetchBizinfo()])
  const results = all.map((a) => a.result)
  const cutoff = now.getTime() - 14 * 24 * 3600_000
  const seen = new Set<string>()
  const items: FeedItem[] = []
  for (const it of all.flatMap((a) => a.items)) {
    if (it.date && new Date(it.date).getTime() < cutoff) continue
    const key = it.title.replace(/\s+/g, "")
    if (seen.has(it.url) || seen.has(key)) continue
    seen.add(it.url)
    seen.add(key)
    items.push(it)
  }
  // 키에 쓰인 값은 결과에 남기지 않는다
  for (const r of results) if (r.feed === "bizinfo") r.url = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"
  return { items, results }
}
