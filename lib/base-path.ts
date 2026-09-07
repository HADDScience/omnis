// basePath — 옴니스가 한 도메인의 하위 경로(/omnis)로 뜰 때 붙는 접두사.
//
// 켜고 끄는 것은 env 다: NEXT_PUBLIC_BASE_PATH=/omnis. 비어 있으면 지금처럼 루트에 뜬다.
// Next 는 <Link>·router.push·정적 자산에는 basePath 를 스스로 붙이지만 **fetch 와
// <a href>·<img src> 에는 붙이지 않는다.** 그래서 `/api/…` 를 직접 쓰는 자리는 전부
// 여기를 거친다 — 한 곳이라도 빠지면 그 요청은 루트 도메인(홈페이지)으로 가서 404 다.
//
// 서버가 자기 공개 주소를 알아야 할 때(OAuth 콜백·MCP issuer·SSO 되돌림)는 요청의
// origin 을 쓰면 안 된다 — 프록시(rewrite) 뒤에서는 그 값이 내부 호스트(omnis-hadd)다.
// PUBLIC_URL 이 있으면 그것을, 없으면 요청 origin 을 쓴다.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

/** 클라이언트·서버 공통 — `/api/…` 같은 앱 내부 절대경로에 basePath 를 붙인다. */
export function apiUrl(path: string): string {
  if (!BASE_PATH || path.startsWith(BASE_PATH + "/") || path === BASE_PATH) return path
  return `${BASE_PATH}${path}`
}

/** 서버 전용 — 바깥에서 보이는 이 앱의 주소. `/omnis` 까지 포함한다. */
export function publicBase(requestUrl: string | URL): string {
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? new URL(requestUrl).origin
  return `${origin}${BASE_PATH}`
}

/** 서버 전용 — 앱 내부 경로를 바깥에서 보이는 절대 URL 로. 리다이렉트에 쓴다. */
export function publicUrl(path: string, requestUrl: string | URL): string {
  return `${publicBase(requestUrl)}${path}`
}
