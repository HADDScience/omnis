/**
 * 칼럼 초안의 근거 기사 본문을 읽는다.
 *
 * Google 뉴스 RSS 의 링크(news.google.com/rss/articles/…)는 리다이렉트가 아니라 자바스크립트로
 * 원문에 보내는 중간 페이지다. 중간 페이지의 서명값(data-n-a-sg · data-n-a-ts)으로 Google 뉴스
 * 내부 API(batchexecute, rpc "Fbv4je")에 원문 주소를 묻는다. **문서화되지 않은 경로**라 언제든
 * 막힐 수 있다 — 실패하면 그 근거는 헤드라인만으로 쓰고 초안에 그렇게 표시한다.
 *
 * 본문 추출은 국내 언론사 CMS(ndsoft 계열 `article-view-content-div`)를 먼저 보고, 없으면
 * 30자 넘는 <p> 를 모은다. 근거당 4,000자에서 자른다.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const TIMEOUT_MS = 15_000
export const MAX_CHARS = 4_000

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** Google 뉴스 중간 링크면 원문 주소로 바꾼다. 아니면 그대로. 실패하면 null. */
export async function resolveSourceUrl(url: string): Promise<string | null> {
  if (!/^https:\/\/news\.google\.com\/(rss\/)?articles\//.test(url)) return url
  try {
    const html = await get(url)
    const id = html.match(/data-n-a-id="([^"]+)"/)?.[1]
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1]
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1]
    if (!id || !ts || !sg) return null
    const inner = [
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id,
      Number(ts),
      sg,
    ]
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA },
      body: new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", JSON.stringify(inner), null, "generic"]]]) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    // 응답은 ")]}'" 다음 줄부터 JSON. [["wrb.fr","Fbv4je","[\"garturlres\",\"https://…\",1]",…]]
    const body = await res.text()
    for (const line of body.split("\n")) {
      if (!line.startsWith("[[")) continue
      const outer = JSON.parse(line) as unknown[][]
      const payload = outer.find((r) => r[1] === "Fbv4je")?.[2]
      if (typeof payload !== "string") continue
      const parsed = JSON.parse(payload) as unknown[]
      if (parsed[0] === "garturlres" && typeof parsed[1] === "string") return parsed[1]
    }
    return null
  } catch {
    return null
  }
}

/**
 * HTML 에서 기사 본문 글자만. 못 찾으면 빈 문자열.
 *
 * 본문 시작점: ndsoft CMS 의 `article-view-content-div` → `itemprop="articleBody"`(아시아경제·전자신문 등)
 * → `<article>` → 문서 전체. 정규식으로 짝 맞는 닫는 태그를 찾을 수 없어, 시작점부터 30,000자를 잘라
 * 그 안의 <p> 를 모은다(<p> 가 두 개 미만이면 <br> 줄바꿈 기준으로 태그를 벗긴다).
 */
export function extractArticleText(html: string): string {
  const clean = html.replace(/<(script|style|noscript|iframe|figure|figcaption|aside|nav|footer)[\s\S]*?<\/\1>/gi, "")
  const at =
    clean.search(/<[^>]+id="article-view-content-div"/i) >= 0
      ? clean.search(/<[^>]+id="article-view-content-div"/i)
      : clean.search(/<[^>]+itemprop="articleBody"/i) >= 0
        ? clean.search(/<[^>]+itemprop="articleBody"/i)
        : clean.search(/<article[\s>]/i)
  const scope = at >= 0 ? clean.slice(at, at + 30_000) : clean
  const ps = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")))
  const lines = decode(scope.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")).split("\n")
  // 기사 문장만 남긴다: 40자 넘고 문장으로 끝나는 줄. 주가 위젯·메뉴·관련기사 제목이 여기서 빠진다
  const keep = (arr: string[]) =>
    arr
      // 아시아경제는 종목명 옆 주가 위젯이 문단 안에 섞인다
      .map((p) => p.replace(/\s+/g, " ").replace(/\S+ close 증권정보 [\s\S]*?기준 (관련기사 )?/g, "").trim())
      .filter((p) => p.length > 40 && /(다|요|음|함)\.?["'”’)]*$|[.!?]["'”’)]*$/.test(p))
      .filter((p) => !/무단\s*전재|재배포\s*금지|저작권자|[\w.-]+@[\w-]+\.[\w.]+/.test(p))
  const a = keep(ps)
  const b = keep(lines)
  const size = (x: string[]) => x.reduce((n, p) => n + p.length, 0)
  return [...new Set(size(a) >= size(b) ? a : b)]
    .join("\n")
    .slice(0, MAX_CHARS)
}

export interface ArticleText {
  /** 원문 주소(풀었으면). 못 풀었으면 받은 주소 */
  url: string
  resolved: boolean
  text: string
}

export async function readArticle(url: string): Promise<ArticleText> {
  const real = await resolveSourceUrl(url)
  if (!real) return { url, resolved: false, text: "" }
  try {
    return { url: real, resolved: true, text: extractArticleText(await get(real)) }
  } catch {
    return { url: real, resolved: true, text: "" }
  }
}
