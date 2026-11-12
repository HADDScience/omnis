import { NextResponse, type NextRequest } from "next/server"
import { maintenancePageHtml } from "@/lib/maintenance/page"
import { BYPASS_COOKIE, BYPASS_FLAG_COOKIE, BYPASS_MAX_AGE, BYPASS_QUERY, RETRY_AFTER_SECONDS, decide } from "@/lib/maintenance/rules"
import { SIMULATE_COOKIE, readMaintenanceState, simulatedState } from "@/lib/maintenance/state"
import { RETURN_HEADER, hasSessionCookie, loginPath, needsLogin } from "@/lib/login-return"

/**
 * 점검이 아닐 때의 화면 요청 — 로그인해야 보이는 화면인데 세션 쿠키가 없으면 로그인 화면으로 307,
 * 원래 주소를 callbackUrl 에 싣는다(2026-11-12 핫픽스, lib/login-return.ts). 서버 컴포넌트는 요청 경로를 모르므로
 * 원래 주소를 요청 헤더에도 실어 넘긴다 — 쿠키는 있는데 세션이 끝난 경우 layout · page 가 그 주소로 보낸다.
 */
function passOrLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl
  const back = `${url.basePath}${url.pathname}${url.search}`
  if (needsLogin(url.pathname) && !hasSessionCookie(request.cookies.getAll().map((c) => c.name))) {
    const [path, query] = loginPath(back).split("?")
    const login = url.clone()
    login.pathname = path
    login.search = query ? `?${query}` : ""
    const res = NextResponse.redirect(login, 307)
    res.headers.set("Cache-Control", "no-store")
    return res
  }
  const headers = new Headers(request.headers)
  headers.set(RETURN_HEADER, back)
  return NextResponse.next({ request: { headers } })
}

/**
 * 점검 스위치(lib/maintenance) — mode 가 maintenance 일 때만 일한다. 그 밖에는 그대로 넘긴다.
 * 스위치 값은 인스턴스마다 30초 메모리 캐시라, 이 함수가 요청마다 스토어를 읽지는 않는다.
 * 화면 요청만 받는다(API 는 matcher 밖 — 이유는 lib/maintenance/rules.ts).
 * 켜고 끄는 법: mydocs/manual/maintenance-switch.md
 */
export async function proxy(request: NextRequest) {
  const state =
    simulatedState(request.cookies.get(SIMULATE_COOKIE)?.value) ?? (await readMaintenanceState())
  if (state.mode !== "maintenance") return passOrLogin(request)

  const url = request.nextUrl
  const decision = decide({
    pathname: url.pathname,
    bypassCookie: request.cookies.get(BYPASS_COOKIE)?.value,
    bypassQuery: url.searchParams.get(BYPASS_QUERY),
    bypassToken: process.env.MAINTENANCE_BYPASS_TOKEN,
  })

  switch (decision.action) {
    case "pass":
      return passOrLogin(request)
    case "grant-bypass": {
      const clean = url.clone()
      clean.searchParams.delete(BYPASS_QUERY)
      const res = NextResponse.redirect(clean)
      res.cookies.set(BYPASS_COOKIE, process.env.MAINTENANCE_BYPASS_TOKEN!, {
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: BYPASS_MAX_AGE,
      })
      res.cookies.set(BYPASS_FLAG_COOKIE, "1", { sameSite: "lax", path: "/", maxAge: BYPASS_MAX_AGE })
      res.headers.set("Cache-Control", "no-store")
      return res
    }
    case "page":
      return new NextResponse(
        maintenancePageHtml({ message: state.message, updatedAt: state.updatedAt, retryAfterSeconds: RETRY_AFTER_SECONDS }),
        {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Retry-After": String(RETRY_AFTER_SECONDS),
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
          },
        },
      )
  }
}

export const config = {
  /*
   * API · Workflow · Next 의 정적 자원 · 이미지 최적화 · 확장자가 있는 파일(아이콘 · sw.js · 영상)은
   * 아예 들르지 않는다. 화면(페이지 · RSC) 요청만 proxy 함수 호출이 하나씩 늘어난다.
   */
  matcher: ["/((?!api/|api$|\\.well-known/|_next/static|_next/image|.*\\.[A-Za-z0-9]+$).*)"],
}
