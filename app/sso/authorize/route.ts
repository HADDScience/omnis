import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { buildReturnUrl, issueGrant, resolveApp, safeReturnPath, ssoEnabled } from "@/lib/sso"

/**
 * SSO 진입점. 사내 도구가 사람을 여기로 보내면, 로그인 여부를 확인해
 * 짧은 수명의 1회용 표(grant)를 프래그먼트에 달아 돌려보낸다.
 *
 *   GET /sso/authorize?app=hub&next=/hub/
 *     ↳ 미로그인 → /login?callbackUrl=<이 주소> → 로그인 후 여기로 복귀
 *     ↳ 로그인   → 302 https://haddscience.github.io/hub/#sso=<grant>
 *
 * 순서가 중요하다: **앱과 경로를 먼저 검증하고 그 다음에 세션을 본다.**
 * 반대로 하면 등록되지 않은 오리진으로 사람을 보내고 나서야 거절하게 된다.
 */
export const dynamic = "force-dynamic"

/**
 * 오류는 리다이렉트 없이 여기서 끝낸다.
 * 사람이 브라우저로 직접 도달하는 화면이라 JSON 대신 짧은 HTML 을 준다.
 */
function fail(status: number, title: string, detail: string): NextResponse {
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Omnis</title>
<style>
  body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0b1020;color:#e2e8f0;
       font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
  main{max-width:420px}
  h1{margin:0 0 8px;font-size:17px;font-weight:600}
  p{margin:0;color:#94a3b8}
  a{color:#a5b4fc}
</style>
<main><h1>${title}</h1><p>${detail}</p>
<p style="margin-top:16px"><a href="/dashboard">Omnis 로 이동</a></p></main>`
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}

export async function GET(req: NextRequest) {
  if (!ssoEnabled()) {
    return fail(503, "SSO 가 설정되지 않았습니다", "서버에 SSO_SIGNING_KEY 가 없습니다. 관리자에게 알려주세요.")
  }

  const url = new URL(req.url)

  const app = resolveApp(url.searchParams.get("app"))
  if (!app) {
    return fail(400, "등록되지 않은 앱입니다", "이 주소로는 로그인할 수 없습니다. 사내 도구 목록에 등록된 앱만 Omnis 로그인을 쓸 수 있습니다.")
  }

  const next = safeReturnPath(app, url.searchParams.get("next"))
  if (next === null) {
    return fail(400, "돌아갈 경로가 올바르지 않습니다", `${app.label} 안쪽 경로만 허용합니다. 다른 사이트로 보내는 주소는 거부합니다.`)
  }

  const session = await auth()
  if (!session?.user?.id) {
    // 로그인 화면으로 보냈다가 이 요청을 그대로 다시 태운다.
    // callbackUrl 은 같은 오리진의 상대 경로라 NextAuth 의 기본 검사를 통과한다.
    const back = `/sso/authorize?app=${encodeURIComponent(app.id)}&next=${encodeURIComponent(next)}`
    const login = new URL(`/login?callbackUrl=${encodeURIComponent(back)}`, url.origin)
    return NextResponse.redirect(login, { headers: { "cache-control": "no-store" } })
  }

  const token = await issueGrant(app, session.user.id)
  return NextResponse.redirect(buildReturnUrl(app, next, token), {
    headers: { "cache-control": "no-store" },
  })
}
