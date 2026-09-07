import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { isAllowedOrigin, resolveApp, ssoEnabled, verifySession } from "@/lib/sso"

/**
 * 홈페이지 관리 화면(website-admin*)이 부르는 API 의 인증.
 *
 * 관리 화면은 정적 앱이라 Omnis 쿠키가 없다. Omnis SSO 세션 토큰을 Bearer 로 들고 오고,
 * 여기서 서명·audience 에 더해 DB 의 isActive 까지 본다(/api/sso/verify 와 같은 순서) —
 * 퇴사 처리가 토큰 수명을 기다리지 않고 다음 요청에 먹힌다.
 *
 * Origin 은 있을 때만 앱의 오리진과 대조한다. 같은 도메인(haddscience.vercel.app/admin →
 * /omnis/api/…)의 GET 은 브라우저가 Origin 을 붙이지 않는다. 자격은 어차피 토큰이 증명하고
 * 쿠키를 쓰지 않아 CSRF 여지가 없으므로, 이 검사는 등록 밖 페이지를 한 번 더 거르는 것이다.
 */

export interface WebsiteUser {
  id: string
  name: string
  email: string | null
}

export function websiteCors(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-sso-app, x-post-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

export function websiteJson(body: unknown, status: number, origin: string | null, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { ...websiteCors(origin), "cache-control": "no-store", ...(extra ?? {}) },
  })
}

export function websiteOptions(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: websiteCors(req.headers.get("origin")) })
}

export async function requireWebsiteUser(
  req: NextRequest
): Promise<{ user: WebsiteUser } | { error: NextResponse }> {
  const origin = req.headers.get("origin")
  if (!ssoEnabled()) return { error: websiteJson({ error: "sso_disabled" }, 503, origin) }

  const app = resolveApp(req.headers.get("x-sso-app"))
  if (!app || !app.id.startsWith("website-admin")) {
    return { error: websiteJson({ error: "unknown_app" }, 400, origin) }
  }
  if (origin !== null && origin !== app.origin) {
    return { error: websiteJson({ error: "origin_not_allowed" }, 403, origin) }
  }

  const auth = req.headers.get("authorization") ?? ""
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : ""
  if (!token) return { error: websiteJson({ error: "invalid_session" }, 401, origin) }

  const claims = await verifySession(token, app)
  if (!claims) return { error: websiteJson({ error: "invalid_session" }, 401, origin) }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, name: true, email: true, isActive: true },
  })
  if (!user || !user.isActive) return { error: websiteJson({ error: "account_inactive" }, 403, origin) }

  return { user: { id: user.id, name: user.name, email: user.email } }
}
