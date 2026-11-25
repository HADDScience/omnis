// 공고 첨부 받기 — 기업마당(bizinfo) 첨부는 공고 페이지가 부를 때마다 새 downloadToken 을 붙여 준다.
// 저장해 둔 getImageFile 주소는 403 이라, 받을 때 공고 페이지를 읽어 그 파일의 새 주소를 찾는다.
// 토큰에는 발급 시각 · 파일 id 만 있고 IP · 쿠키에 묶이지 않는다(2026-11-25 확인) — 그래서 그 주소로 보내면 된다.
import { isBizinfoFile, type NoticeAttachment } from "@/lib/grants-import"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

/** 첨부를 받을 주소. 새 토큰을 못 얻으면 공고 페이지로 */
export async function attachmentHref(a: NoticeAttachment): Promise<string> {
  if (!isBizinfoFile(a.url) || !a.page) return a.url
  const u = new URL(a.url)
  const id = u.searchParams.get("atchFileId")
  const sn = u.searchParams.get("fileSn") ?? "0"
  if (!id) return a.page
  try {
    const res = await fetch(a.page, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return a.page
    const html = (await res.text()).replace(/&amp;/g, "&")
    const re = new RegExp(
      `/cmm/fms/fileDown\\.do\\?atchFileId=${id}&fileSn=${sn}&downloadToken=[A-Za-z0-9._-]+`
    )
    const hit = html.match(re)?.[0]
    return hit ? `https://www.bizinfo.go.kr${hit}` : a.page
  } catch {
    return a.page
  }
}
