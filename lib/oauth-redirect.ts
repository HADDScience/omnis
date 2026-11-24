// OAuth redirect_uri 비교 — /api/ip-mcp 의 /authorize · /token 이 쓴다.
//
// 왜 정확 일치만으로는 안 되는가 (2026-11-24, Codex 인증 실패)
//  Next.js 의 NextRequest 는 URL 문자열에서 처음 나오는 127.x.x.x · [::1] · localhost 를
//  `localhost` 로 바꾼다(next/dist/server/web/next-url.js 의 REGEX_LOCALHOST_HOSTNAME).
//  쿼리 안의 값도 예외가 아니다. 그래서 /register 에 JSON 본문으로
//  `http://127.0.0.1:PORT/…` 를 등록한 클라이언트(Codex)가 /authorize 쿼리로 같은 값을
//  보내면 route 에는 `http://localhost:PORT/…` 로 닿고, 정확 일치가 실패한다.
//
// 규칙
//  - 정확히 같으면 통과한다(claude.ai 처럼 루프백이 아닌 주소는 이것만 된다).
//  - 둘 다 http 루프백(127.0.0.1 · [::1] · localhost)이면 호스트끼리는 같은 것으로 보고
//    포트도 따지지 않는다(RFC 8252 §7.3 — 네이티브 앱은 실행할 때마다 빈 포트를 고른다).
//    스킴 · 경로 · 쿼리는 정확히 같아야 하고, 사용자 정보 · 조각(#)이 있으면 거부한다.
//  - 되돌려 보낼 주소는 **등록된 항목의 호스트**에 요청의 포트를 붙여 만든다. 바뀐
//    `localhost` 로 보내면 127.0.0.1 에만 열어 둔 리스너에 닿지 못할 수 있다
//    (localhost 가 ::1 로 먼저 풀리는 환경).

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"])

function parse(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

function isLoopback(u: URL): boolean {
  return (
    u.protocol === "http:" &&
    LOOPBACK_HOSTS.has(u.hostname) &&
    u.username === "" &&
    u.password === "" &&
    u.hash === ""
  )
}

/**
 * 요청의 redirect_uri 가 등록된 목록 중 하나와 맞으면 **실제로 되돌려 보낼 주소**를,
 * 맞는 것이 없으면 null 을 돌려준다.
 */
export function matchRedirectUri(registered: readonly string[], requested: string): string | null {
  if (!requested) return null
  if (registered.includes(requested)) return requested

  const req = parse(requested)
  if (!req || !isLoopback(req)) return null

  for (const entry of registered) {
    const reg = parse(entry)
    if (!reg || !isLoopback(reg)) continue
    if (reg.pathname !== req.pathname || reg.search !== req.search) continue
    const target = new URL(entry)
    target.port = req.port
    return target.toString()
  }
  return null
}
