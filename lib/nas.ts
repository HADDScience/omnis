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
 * 맥에서 복사한 마운트 경로(`/Volumes/HADD Science/...`, `~/NAS/HADD Science/...`,
 * `/Users/이름/NAS/HADD Science/...`)도 받는다 — 공유폴더 이름 앞을 떼어 낸다(2026-09-17).
 * `..` 를 걷어내 공유폴더 밖으로 나가지 못하게 한다.
 */
export function normalizeNasPath(input: string): string | null {
  let p = input.trim()
  p = p.replace(/^[A-Za-z]:/, "")        // Z: 드라이브 문자
  p = p.replace(/^\\\\[^\\]+\\/, "/")    // \\서버\공유
  p = p.replace(/\\/g, "/")              // 역슬래시 → 슬래시
  p = p.replace(/\/+/g, "/")
  if (!p.startsWith("/")) p = "/" + p

  let segments = p.split("/").filter((seg) => seg && seg !== ".")
  if (segments.some((seg) => seg === "..")) return null   // 상위 탈출 차단

  // 맥 마운트 경로. 떼어 내는 것은 마운트 자리로 보이는 앞부분뿐이다 — 다른 공유폴더 안의
  // 같은 이름 폴더(`/다른공유/HADD Science/…`)를 이 공유폴더로 잘못 읽지 않게.
  if (["Volumes", "~", "Users"].includes(segments[0])) {
    const share = segments.findIndex((seg) => ALLOWED_SHARES.includes(seg))
    if (share > 0) segments = segments.slice(share)
  }

  if (segments.length === 0) return null
  if (!ALLOWED_SHARES.includes(segments[0])) return null

  return "/" + segments.join("/")
}

/**
 * PROPFIND 의 href 를 경로로. XML 안이라 `&` 가 `&amp;` 로 온다 — 풀지 않으면
 * `배너&포스터` 같은 폴더를 열 수 없다(2026-09-17 발견).
 */
function decodeHref(href: string): string | null {
  const unescaped = href
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
  try { return decodeURIComponent(unescaped) } catch { return null }
}

/** 한글 파일명의 두 모양. 맥에서 만든 파일은 NFD(자모 분리)로 저장돼 있기도 하다 — 같은 이름으로 본다 */
const sameName = (a: string, b: string) => a.normalize("NFC") === b.normalize("NFC")

/**
 * 파일 하나의 정보. 없거나 폴더면 null.
 * 내용을 읽지 않는다 — 고르는 순간의 확인과 링크 만들기에 쓴다(`readFile` 은 수백 MB 를 흘린다).
 *
 * NAS 는 이름을 바이트로 비교한다. 붙여넣은 경로(NFC)와 맥이 저장한 이름(NFD)이 다르면 404 다.
 * 폴더는 NFC 인데 파일명만 NFD 인 경우가 실제로 있어(족자.ai) 경로 전체를 바꿔 묻지 않고,
 * 부모 폴더 목록에서 같은 이름을 찾는다. 돌려주는 path 는 NAS 에 실제로 있는 모양이다 — 링크에는 그것이 적힌다.
 */
export async function statNasFile(path: string): Promise<NasEntry | null> {
  const exact = await statExact(path)
  if (exact !== undefined) return exact

  const name = path.split("/").pop() ?? ""
  const parent = path.split("/").slice(0, -1).join("/")
  if (!name || !parent) return null
  const match = (await listDirectory(parent))?.find((e) => sameName(e.name, name))
  if (!match || match.isDir) return null
  return (await statExact(match.path)) ?? null
}

/** 그 바이트 그대로의 경로. 없으면 undefined(다른 모양으로 다시 물어볼 수 있다), 폴더면 null */
async function statExact(path: string): Promise<NasEntry | null | undefined> {
  const res = await dav("PROPFIND", davUrl(path), undefined, undefined, { Depth: "0" })
  if (res.status !== 207) { res.body.resume(); return undefined }

  const chunks: Buffer[] = []
  for await (const c of res.body) chunks.push(Buffer.from(c))
  const block = Buffer.concat(chunks).toString("utf8").split(/<[a-zA-Z0-9]*:?response[\s>]/)[1]
  if (!block || /<[a-zA-Z0-9]*:?collection\s*\/>/.test(block)) return null

  const sizeRaw = block.match(/<[a-zA-Z0-9]*:?getcontentlength[^>]*>(\d+)</)?.[1]
  const modified = block.match(/<[a-zA-Z0-9]*:?getlastmodified[^>]*>([^<]*)</)?.[1] ?? null
  return {
    name: (path.split("/").pop() ?? path).normalize("NFC"),
    path,
    isDir: false,
    size: sizeRaw ? Number(sizeRaw) : null,
    modifiedAt: modified ? new Date(modified).toISOString() : null,
  }
}

/** PROPFIND 응답(XML)에서 항목을 뽑는다. 의존성을 늘리지 않으려 정규식으로 읽는다. */
function parsePropfind(xml: string, basePath: string): NasEntry[] {
  const entries: NasEntry[] = []
  const blocks = xml.split(/<[a-zA-Z0-9]*:?response[\s>]/).slice(1)

  for (const block of blocks) {
    const href = block.match(/<[a-zA-Z0-9]*:?href[^>]*>([^<]*)<\/[a-zA-Z0-9]*:?href>/)?.[1]
    if (!href) continue

    let decoded = decodeHref(href)
    if (decoded === null) continue
    decoded = decoded.replace(/\/+$/, "")
    if (!decoded.startsWith("/")) decoded = "/" + decoded
    if (sameName(decoded, basePath.replace(/\/+$/, ""))) continue   // 자기 자신

    const isDir = /<[a-zA-Z0-9]*:?collection\s*\/>/.test(block)
    const sizeRaw = block.match(/<[a-zA-Z0-9]*:?getcontentlength[^>]*>(\d+)</)?.[1]
    const modified = block.match(/<[a-zA-Z0-9]*:?getlastmodified[^>]*>([^<]*)</)?.[1] ?? null

    // 화면·DB 에 적는 이름은 NFC 로 — 맥이 만든 NFD 이름을 글자 수로 자르면 자모 중간에서 잘린다. 경로는 NAS 에 있는 모양 그대로
    const name = (decoded.split("/").pop() ?? decoded).normalize("NFC")
    // `~$…` 는 한글·오피스가 편집 중에 만드는 잠금 표식이지 문서가 아니다.
    // `.DS_Store`·`@eaDir` 도 사람이 볼 것이 아니다. `~ai-….tmp` 는 일러스트레이터가 저장 중에 만드는 임시파일이다.
    if (name.startsWith("~$") || name.startsWith("~ai-") || name === ".DS_Store" || name === "@eaDir") continue

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
  const blocks = xml.split(/<[a-zA-Z0-9]*:?response[\s>]/).slice(1)
  for (const block of blocks) {
    const href = block.match(/<[a-zA-Z0-9]*:?href[^>]*>([^<]*)<\/[a-zA-Z0-9]*:?href>/)?.[1]
    if (!href) continue
    let decoded = decodeHref(href)
    if (decoded === null) continue
    decoded = decoded.replace(/\/+$/, "")
    if (!decoded.startsWith("/")) decoded = "/" + decoded
    if (sameName(decoded, target)) return /<[a-zA-Z0-9]*:?collection\s*\/>/.test(block)
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
