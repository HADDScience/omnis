import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import {
  consumeGrant,
  corsHeaders,
  issueSession,
  resolveApp,
  ssoEnabled,
  verifyGrant,
} from "@/lib/sso"

/**
 * grant(1회용 60초 표) → 세션 토큰(8시간) 교환.
 *
 * 정적 앱은 비밀키를 들 수 없으므로 서명 검증을 여기서 대신 해 준다.
 * 동시에 여기가 **1회용을 강제하는 유일한 지점**이다 — 앱이 혼자 서명만
 * 확인하면 같은 표를 몇 번이고 다시 쓸 수 있다.
 *
 * 넘겨받은 app 이 토큰의 audience 와 일치해야 하고, 요청 Origin 이 그 앱의
 * 등록 오리진이어야 한다. hub 용 표를 ip-platform 이 가져와도 통하지 않는다.
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

  // 브라우저가 붙이는 Origin 은 위조할 수 없다. 등록된 오리진에서 온 요청만 받는다.
  if (origin !== app.origin) return json({ error: "origin_not_allowed" }, 403, origin)

  const claims = await verifyGrant(body.token, app)
  if (!claims) return json({ error: "invalid_grant" }, 401, origin)

  // 서명·만료·audience 를 통과했어도 이미 쓴 표면 여기서 막힌다.
  if (!(await consumeGrant(claims))) return json({ error: "grant_already_used" }, 401, origin)

  // 프로필은 토큰이 아니라 DB 에서 다시 읽는다. 표를 끊고 8시간 뒤에 교환해도
  // (그럴 수는 없지만) 최신 상태가 나가고, 퇴사 처리가 즉시 반영된다.
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return json({ error: "account_inactive" }, 403, origin)

  const { token, expiresAt } = await issueSession(app, user)
  return json(
    {
      token,
      expiresAt,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    },
    200,
    origin
  )
}
