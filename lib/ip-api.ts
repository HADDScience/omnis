// 지식재산권 API 라우트가 공통으로 쓰는 문지기.
//
// ip-platform 은 다른 오리진(GitHub Pages)의 정적 앱이라 쿠키를 쓸 수 없다.
// 대신 SSO 세션 토큰을 Authorization 헤더에 실어 보낸다 — 허브가 받는 것과 같은
// 토큰이고, audience 만 ip-platform 이다.
//
// 세 가지를 차례로 본다. 하나라도 어긋나면 거기서 끝난다.
//   1. 오리진이 등록된 앱의 것인가        (CORS + 명시적 거부)
//   2. 토큰이 이 앱용으로 유효한가         (서명·발급자·audience·만료)
//   3. 그 사람이 지식재산권 구성원인가     (ip.members)
//
// 3번이 예전 RLS 를 대신한다. Prisma 는 DB 소유자로 접속해 RLS 를 지나가므로,
// 판단하는 자리는 여기 하나뿐이다. 라우트가 이 함수를 건너뛰면 방어가 없다.

import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { corsHeaders, resolveApp, ssoEnabled, verifySession, type SsoApp } from "@/lib/sso"
import { canWrite, getIpAccess, type IpMembership } from "@/lib/ip-data"

/** ip-platform 이 등록된 앱 id. 로컬 개발용도 함께 본다. */
function ipApps(): SsoApp[] {
  return ["ip-platform", "ip-platform-dev"]
    .map((id) => resolveApp(id))
    .filter((a): a is SsoApp => a !== null)
}

export interface IpCaller {
  userId: string
  membership: IpMembership
}

type Denied = { response: NextResponse }
type Allowed = { caller: IpCaller; cors: Record<string, string> }

function json(body: unknown, status: number, cors: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { ...cors, "cache-control": "no-store" },
  })
}

/**
 * 요청자를 확인한다. 통과하면 caller, 아니면 그대로 돌려줄 응답.
 *
 * `write` 가 true 면 viewer 는 거부한다. 읽기와 쓰기를 한 함수로 다루되
 * 호출부가 어느 쪽인지 반드시 말하게 해서, 새 라우트를 만들 때 권한을 빠뜨리지
 * 않도록 한다.
 */
export async function authorize(
  req: NextRequest,
  opts: { write: boolean }
): Promise<Denied | Allowed> {
  const origin = req.headers.get("origin")
  const cors = corsHeaders(origin)

  // Omnis 안의 화면(/ip)은 같은 오리진이라 표 대신 로그인 쿠키가 실린다.
  // 같은 오리진인지는 브라우저가 붙이는 sec-fetch-site 로 본다 — 같은 오리진 GET 에는
  // Origin 헤더가 빠지기 때문이다. 다른 사이트의 요청은 여기로 들어오지 못하고
  // 아래 표 검사로 간다(쿠키는 SameSite=Lax 라 애초에 실리지도 않는다).
  const authHeader = req.headers.get("authorization")
  const sameOrigin =
    req.headers.get("sec-fetch-site") === "same-origin" || (origin !== null && origin === req.nextUrl.origin)
  if (!authHeader && sameOrigin) {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return { response: json({ error: "unauthorized" }, 401, {}) }

    return admit(userId, opts, {})
  }

  if (!ssoEnabled()) {
    return { response: json({ error: "sso_disabled" }, 503, cors) }
  }

  const app = ipApps().find((a) => a.origin === origin)
  if (!app) {
    // 등록되지 않은 오리진. CORS 헤더도 주지 않으므로 브라우저가 응답을 읽지 못한다.
    return { response: json({ error: "origin_not_allowed" }, 403, {}) }
  }

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!token) return { response: json({ error: "no_token" }, 401, cors) }

  const claims = await verifySession(token, app)
  if (!claims) return { response: json({ error: "invalid_session" }, 401, cors) }

  return admit(claims.userId, opts, cors)
}

/**
 * 로그인한 사람이 확인된 뒤의 공통 관문. 자격은 getIpAccess 가 정한다 — 문턱을
 * 최대한 낮춰 두었으므로 비활성 계정만 걸린다(lib/ip-data.ts).
 */
async function admit(
  userId: string,
  opts: { write: boolean },
  cors: Record<string, string>
): Promise<Denied | Allowed> {
  const membership = await getIpAccess(userId)
  if (!membership) return { response: json({ error: "unauthorized" }, 401, cors) }

  if (opts.write && !canWrite(membership)) {
    return { response: json({ error: "read_only" }, 403, cors) }
  }

  return { caller: { userId, membership }, cors }
}

export function isDenied(result: Denied | Allowed): result is Denied {
  return "response" in result
}

export function ok(body: unknown, cors: Record<string, string>) {
  return json(body, 200, cors)
}

export function bad(message: string, cors: Record<string, string>, status = 400) {
  return json({ error: message }, status, cors)
}

/** 프리플라이트. 등록되지 않은 오리진에는 CORS 헤더가 나가지 않는다. */
export function preflight(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(req.headers.get("origin")),
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
    },
  })
}

/** 본문을 읽는다. 깨졌으면 null. */
export async function body<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}
