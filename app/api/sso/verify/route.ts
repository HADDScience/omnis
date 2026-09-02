import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { corsHeaders, resolveApp, ssoEnabled, verifySession } from "@/lib/sso"

/**
 * 세션 토큰이 아직 살아 있는지 확인한다. 앱이 화면을 그리기 전에 한 번 부른다.
 *
 * 토큰만 보고 만료 시각을 스스로 판단하게 두지 않는 이유: 그러면 퇴사 처리
 * (isActive=false)나 계정 삭제가 토큰 수명(8시간)만큼 늦게 먹힌다. 여기서
 * DB 를 한 번 보면 다음 새로고침에 바로 끊긴다.
 *
 * 실패 응답은 두 갈래로 나뉜다:
 *  - 401/403 → 이 세션은 죽었다. 앱은 저장된 토큰을 지워야 한다.
 *  - 그 밖(네트워크 오류 등) → 판단 불가. 앱은 저장된 만료 시각을 믿고 버틴다.
 */
export const dynamic = "force-dynamic"

function json(body: unknown, status: number, origin: string | null) {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(origin), "cache-control": "no-store" },
  })
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin")
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")

  if (!ssoEnabled()) return json({ error: "sso_disabled" }, 503, origin)

  const body = (await req.json().catch(() => null)) as
    | { token?: unknown; app?: unknown }
    | null
  if (!body || typeof body.token !== "string" || typeof body.app !== "string") {
    return json({ error: "bad_request" }, 400, origin)
  }

  const app = resolveApp(body.app)
  if (!app) return json({ error: "unknown_app" }, 400, origin)
  if (origin !== app.origin) return json({ error: "origin_not_allowed" }, 403, origin)

  const claims = await verifySession(body.token, app)
  if (!claims) return json({ error: "invalid_session" }, 401, origin)

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return json({ error: "account_inactive" }, 403, origin)

  return json(
    {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      expiresAt: claims.expiresAt.getTime(),
    },
    200,
    origin
  )
}
