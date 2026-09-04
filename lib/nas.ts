// 사내 NAS(Synology) 탐색.
//
// 채팅에 붙여넣는 `Z:\HADD Science\...` 경로를 옴니스 안에서 열기 위한 것이다.
// 브라우저가 NAS 에 직접 붙을 수는 없다 — 인증서가 자체서명이고 Basic 인증이 걸려 있으며
// DSM 웹 UI 포트(5000·5001)는 외부에 닫혀 있다. 그래서 옴니스가 중계한다.
import { dav, davUrl, type DavResponse } from "./storage"

/** 열람을 허용하는 공유폴더. 여기 밖은 보지 못한다. */
const ALLOWED_SHARES = ["HADD Science"]

export interface NasEntry {
  name: string
  path: string
  isDir: boolean
  size: number | null
  modifiedAt: string | null
}

/**
 * 경로를 안전한 형태로 다듬는다.
 *
 * 채팅에는 여러 모양으로 붙는다 — `Z:\HADD Science\...`(윈도우 매핑),
 * `/HADD Science/...`, `HADD Science\...`. 전부 같은 곳을 가리킨다.
 * `..` 를 걷어내 공유폴더 밖으로 나가지 못하게 한다.
 */
export function normalizeNasPath(input: string): string | null {
  let p = input.trim()
  p = p.replace(/^[A-Za-z]:/, "")        // Z: 드라이브 문자
  p = p.replace(/^\\\\[^\\]+\\/, "/")    // \\서버\공유
  p = p.replace(/\\/g, "/")              // 역슬래시 → 슬래시
  p = p.replace(/\/+/g, "/")
  if (!p.startsWith("/")) p = "/" + p

  const segments = p.split("/").filter((seg) => seg && seg !== ".")
  if (segments.some((seg) => seg === "..")) return null   // 상위 탈출 차단

  if (segments.length === 0) return null
  if (!ALLOWED_SHARES.includes(segments[0])) return null

  return "/" + segments.join("/")
}

/** PROPFIND 응답(XML)에서 항목을 뽑는다. 의존성을 늘리지 않으려 정규식으로 읽는다. */
function parsePropfind(xml: string, basePath: string): NasEntry[] {
  const entries: NasEntry[] = []
  const blocks = xml.split(/<[a-zA-Z]*:?response[\s>]/).slice(1)

  for (const block of blocks) {
    const href = block.match(/<[a-zA-Z]*:?href[^>]*>([^<]*)<\/[a-zA-Z]*:?href>/)?.[1]
    if (!href) continue

    let decoded: string
    try { decoded = decodeURIComponent(href) } catch { continue }
    decoded = decoded.replace(/\/+$/, "")
    if (!decoded.startsWith("/")) decoded = "/" + decoded
    if (decoded === basePath.replace(/\/+$/, "")) continue   // 자기 자신

    const isDir = /<[a-zA-Z]*:?collection\s*\/>/.test(block)
    const sizeRaw = block.match(/<[a-zA-Z]*:?getcontentlength[^>]*>(\d+)</)?.[1]
    const modified = block.match(/<[a-zA-Z]*:?getlastmodified[^>]*>([^<]*)</)?.[1] ?? null

    const name = decoded.split("/").pop() ?? decoded
    // `~$…` 는 한글·오피스가 편집 중에 만드는 잠금 표식이지 문서가 아니다.
    // `.DS_Store`·`@eaDir` 도 사람이 볼 것이 아니다.
    if (name.startsWith("~$") || name === ".DS_Store" || name === "@eaDir") continue

    entries.push({
      name,
      path: decoded,
      isDir,
      size: sizeRaw ? Number(sizeRaw) : null,
      modifiedAt: modified ? new Date(modified).toISOString() : null,
    })
  }

  // 폴더 먼저, 그다음 이름순
  return entries.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, "ko") : a.isDir ? -1 : 1,
  )
}

/**
 * 폴더 목록. 경로가 파일이면 null 을 돌려준다.
 *
 * WebDAV 는 파일에 PROPFIND 해도 207 을 주고 자기 자신 한 건만 돌려준다.
 * 그래서 상태 코드로는 폴더인지 알 수 없다 — **자기 자신이 collection 인지**로 가른다.
 */
export async function listDirectory(path: string): Promise<NasEntry[] | null> {
  // Depth 를 주지 않으면 서버가 무한 깊이로 해석한다. 한 단계만 본다.
  const res = await dav("PROPFIND", davUrl(path), undefined, undefined, { Depth: "1" })
  if (res.status !== 207) { res.body.resume(); return null }

  const chunks: Buffer[] = []
  for await (const c of res.body) chunks.push(Buffer.from(c))
  const xml = Buffer.concat(chunks).toString("utf8")

  if (!selfIsCollection(xml, path)) return null
  return parsePropfind(xml, path)
}

/** 응답의 첫 항목(자기 자신)이 폴더인가. */
function selfIsCollection(xml: string, path: string): boolean {
  const target = path.replace(/\/+$/, "")
  const blocks = xml.split(/<[a-zA-Z]*:?response[\s>]/).slice(1)
  for (const block of blocks) {
    const href = block.match(/<[a-zA-Z]*:?href[^>]*>([^<]*)<\/[a-zA-Z]*:?href>/)?.[1]
    if (!href) continue
    let decoded: string
    try { decoded = decodeURIComponent(href) } catch { continue }
    decoded = decoded.replace(/\/+$/, "")
    if (!decoded.startsWith("/")) decoded = "/" + decoded
    if (decoded === target) return /<[a-zA-Z]*:?collection\s*\/>/.test(block)
  }
  // 자기 자신을 못 찾으면 폴더로 보지 않는다 — 파일로 흘려보내면 GET 이 판정한다.
  return false
}

/** 파일을 그대로 읽어 온다. 옴니스가 중계해 브라우저에 흘려보낸다. */
export async function readFile(path: string): Promise<DavResponse | null> {
  const res = await dav("GET", davUrl(path))
  if (res.status !== 200) { res.body.resume(); return null }
  return res
}

/** 브라우저가 그 자리에서 열 수 있는 형식인가. 아니면 저장으로 넘긴다. */
export function inlineContentType(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? ""
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
    csv: "text/plain; charset=utf-8", json: "application/json",
    mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  }
  return map[ext] ?? null
}
