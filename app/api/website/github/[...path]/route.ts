import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { isAllowedOrigin, resolveApp, ssoEnabled, verifySession, type SsoApp } from "@/lib/sso"

/**
 * 홈페이지 관리 화면(haddscience.github.io/admin)을 위한 GitHub API 프록시.
 *
 * 홈페이지는 정적 사이트라 GitHub 토큰을 들 수 없다. 예전에는 사람마다 PAT 을
 * 발급해 브라우저가 api.github.com 을 직접 불렀는데, 발급·갱신이 비개발자에게
 * 벅찼고 퇴사 처리가 GitHub 쪽 회수에 기대야 했다. 이제 브라우저는 Omnis SSO
 * 세션 토큰만 들고 여기로 오고, 서버가 토큰 하나(WEBSITE_GITHUB_TOKEN)로 대신 부른다.
 *
 *   GET | POST | PATCH  /api/website/github/<GitHub 경로>?<쿼리>
 *     Authorization: Bearer <SSO 세션 토큰>
 *     X-Sso-App: website-admin | website-admin-com | website-admin-dev
 *
 * 지키는 것:
 *  - 세션은 서명·audience 뿐 아니라 DB 의 isActive 까지 본다 (/api/sso/verify 와 같다).
 *    퇴사 처리가 토큰 수명을 기다리지 않고 다음 요청에 먹힌다.
 *  - 경로는 홈페이지 저장소 아래만. 서버 토큰이 다른 저장소에 닿을 권한이 있어도
 *    이 문으로는 못 간다.
 *  - 커밋 생성(POST …/git/commits)의 author 는 세션 사용자로 덮어쓴다. PAT 시절의
 *    장점 — 누가 고쳤는지 실명으로 남는 것 — 을 잃지 않는다. committer 는 토큰 주인이다.
 *
 * 응답은 GitHub 의 상태 코드와 본문을 그대로 돌려준다. 클라이언트(lib/github.ts)가
 * api.github.com 을 부를 때와 같은 모양을 기대하기 때문이다.
 */
export const dynamic = "force-dynamic"

/** 검증 때만 바꾼다 — 가짜 GitHub 에 보내 author 덮어쓰기를 눈으로 확인하기 위해. */
const GITHUB = process.env.WEBSITE_GITHUB_API ?? "https://api.github.com"
const REPO = process.env.WEBSITE_REPO ?? "HADDScience/HADDScience.github.io"
const AUTHOR_FALLBACK_EMAIL = "website-admin@haddscience.com"

type Props = { params: Promise<{ path: string[] }> }

/**
 * 기존 corsHeaders() 는 redeem/verify 용이라 POST 와 content-type 만 연다.
 * 여기는 GET/PATCH 와 Authorization 헤더가 필요해 따로 만든다. 허용 오리진 판단은 같다.
 */
function cors(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-sso-app",
    "Access-Control-Expose-Headers": "x-ratelimit-remaining, x-ratelimit-reset",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

function json(body: unknown, status: number, origin: string | null) {
  return NextResponse.json(body, {
    status,
    headers: { ...cors(origin), "cache-control": "no-store" },
  })
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) })
}

/** 세션을 확인하고 사용자를 돌려준다. 실패하면 응답을 돌려준다. */
async function authenticate(
  req: NextRequest,
  origin: string | null
): Promise<{ user: { name: string; email: string | null } } | { error: NextResponse }> {
  if (!ssoEnabled()) return { error: json({ error: "sso_disabled" }, 503, origin) }
  if (!process.env.WEBSITE_GITHUB_TOKEN) {
    return { error: json({ error: "github_token_missing" }, 503, origin) }
  }

  const app: SsoApp | null = resolveApp(req.headers.get("x-sso-app"))
  // 홈페이지 앱만 이 문을 쓴다. 다른 앱 토큰은 audience 가 달라 어차피 실패하지만,
  // 어떤 앱이 여기 오는지를 코드가 말하게 둔다.
  if (!app || !app.id.startsWith("website-admin")) {
    return { error: json({ error: "unknown_app" }, 400, origin) }
  }
  if (origin !== app.origin) return { error: json({ error: "origin_not_allowed" }, 403, origin) }

  const auth = req.headers.get("authorization") ?? ""
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : ""
  if (!token) return { error: json({ error: "invalid_session" }, 401, origin) }

  const claims = await verifySession(token, app)
  if (!claims) return { error: json({ error: "invalid_session" }, 401, origin) }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { name: true, email: true, isActive: true },
  })
  if (!user || !user.isActive) return { error: json({ error: "account_inactive" }, 403, origin) }

  return { user: { name: user.name, email: user.email } }
}

async function proxy(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await authenticate(req, origin)
  if ("error" in authed) return authed.error

  const { path } = await params
  const ghPath = path.join("/")
  if (!ghPath.startsWith(`repos/${REPO}/`)) {
    return json({ error: "path_not_allowed" }, 403, origin)
  }

  let body: string | undefined
  if (req.method === "POST" || req.method === "PATCH") {
    body = await req.text()
    if (req.method === "POST" && ghPath === `repos/${REPO}/git/commits`) {
      // 커밋 작성자는 요청이 정하지 못한다. 세션 사용자다.
      const parsed = JSON.parse(body || "{}") as Record<string, unknown>
      parsed.author = {
        name: authed.user.name,
        email: authed.user.email ?? AUTHOR_FALLBACK_EMAIL,
      }
      body = JSON.stringify(parsed)
    }
  }

  const upstream = await fetch(`${GITHUB}/${ghPath}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.WEBSITE_GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body,
    cache: "no-store",
  })

  const text = await upstream.text()
  const headers: Record<string, string> = { ...cors(origin), "cache-control": "no-store" }
  for (const h of ["content-type", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
    const v = upstream.headers.get(h)
    if (v) headers[h] = v
  }
  return new NextResponse(text, { status: upstream.status, headers })
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
