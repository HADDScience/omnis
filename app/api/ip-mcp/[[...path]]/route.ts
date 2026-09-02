import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getMembership } from "@/lib/ip-data"
import {
  INSTRUCTIONS,
  PROTOCOL_VERSION,
  SERVER_INFO,
  TOOLS,
  randomToken,
  resolveCaller,
  runTool,
  sha256,
} from "@/lib/ip-mcp"

/**
 * HADD IP — 원격 MCP 서버 (Streamable HTTP) + OAuth 2.1 인가 서버.
 *
 * Supabase 엣지 함수에서 옮겨 왔다. 프로토콜 처리와 OAuth 흐름은 원본 그대로이고,
 * 달라진 것은 세 가지다.
 *
 *  1. 주소가 바뀐다. `${SUPABASE_URL}/functions/v1/ip-mcp` → 여기.
 *     이미 붙여 둔 커넥터는 새 주소로 다시 연결해야 한다 — issuer 와 resource
 *     식별자가 주소 그 자체라, 옛 주소를 그대로 둘 방법이 없다.
 *  2. 승인 화면이 Omnis 안으로 들어왔다(/ip-mcp/authorize). 예전에는 정적 앱에
 *     띄우고 Supabase 세션 토큰을 헤더로 넘겨받았는데, Omnis 에는 이미 세션이
 *     있으므로 그 왕복이 통째로 사라진다.
 *  3. DB 접근이 Prisma 다. service_role 대신 DB 소유자로 붙으므로 RLS 를
 *     지나가는 것은 같고, 따라서 권한 경계도 여전히 이 코드다.
 *
 * 왜 HTTP 인가
 *  stdio 로 만들면 CLI 에서만 쓸 수 있다. HTTP 로 두면 claude.ai·ChatGPT 의
 *  커스텀 커넥터로 같은 서버를 그대로 붙일 수 있다.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
}

const ACCESS_TTL_SEC = 60 * 60 * 8

/**
 * 이 서버의 공개 주소. 발급자(issuer)이자 보호 자원(resource) 식별자다.
 *
 * 요청에서 오리진을 읽어 만든다 — 미리보기 배포와 프로덕션이 같은 코드를 쓰면서도
 * 각자 자기 주소를 발급자로 말해야 하기 때문이다. 고정해 두면 미리보기에서
 * 인가가 프로덕션으로 새어 나간다.
 */
function baseOf(req: NextRequest): string {
  const url = new URL(req.url)
  return `${url.origin}/api/ip-mcp`
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS, ...extra, "cache-control": "no-store" },
  })
}

function reply(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id, result })
}

function fail(id: unknown, code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } })
}

/** 함수 이름 뒤에 붙은 부분만 본다. */
function tailOf(req: NextRequest): string {
  const url = new URL(req.url)
  return url.pathname.replace(/^.*\/api\/ip-mcp/, "") || "/"
}

// ─── OAuth 메타데이터 ───────────────────────────────────────────────

/** RFC 9728 — 이 자원이 어느 인가 서버를 믿는지 */
function protectedResourceMetadata(base: string) {
  return json({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
  })
}

/** RFC 8414 — 인가 서버가 무엇을 할 수 있는지 */
function authorizationServerMetadata(base: string) {
  return json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // 공개 클라이언트만 받는다. 비밀을 나눠 가질 상대가 아니다.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp"],
  })
}

/** RFC 7591 — 클라이언트가 스스로 등록한다 */
async function registerClient(req: NextRequest) {
  let body: { client_name?: string; redirect_uris?: string[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: "invalid_client_metadata" }, 400)
  }

  const uris = body.redirect_uris ?? []
  if (uris.length === 0) {
    return json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris 가 필요합니다." },
      400
    )
  }

  const clientId = `mcp_${randomToken(16)}`
  await prisma.$executeRaw`
    INSERT INTO ip.oauth_clients (client_id, client_name, redirect_uris)
    VALUES (${clientId}, ${body.client_name ?? ""}, ${uris})`

  return json(
    {
      client_id: clientId,
      client_name: body.client_name ?? "",
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201
  )
}

/** 사용자를 승인 화면으로 보낸다. 로그인 여부는 그 화면이 판단한다. */
async function authorize(req: NextRequest) {
  const url = new URL(req.url)
  const clientId = url.searchParams.get("client_id") ?? ""
  const redirectUri = url.searchParams.get("redirect_uri") ?? ""
  const challenge = url.searchParams.get("code_challenge") ?? ""
  const method = url.searchParams.get("code_challenge_method") ?? ""
  const state = url.searchParams.get("state")

  const client = (
    await prisma.$queryRaw<{ client_id: string; redirect_uris: string[] }[]>`
      SELECT client_id, redirect_uris FROM ip.oauth_clients WHERE client_id = ${clientId}`
  )[0]

  // 클라이언트나 redirect_uri 가 수상하면 그쪽으로 되돌려 보내지 않는다.
  // 공격자가 지정한 주소로 오류를 흘리면 그것이 곧 통로가 된다.
  if (!client) return new NextResponse("알 수 없는 client_id 입니다.", { status: 400 })
  if (!client.redirect_uris.includes(redirectUri)) {
    return new NextResponse("등록되지 않은 redirect_uri 입니다.", { status: 400 })
  }
  if (method !== "S256" || !challenge) {
    return new NextResponse("PKCE(S256)가 필요합니다.", { status: 400 })
  }

  const row = (
    await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ip.oauth_requests (client_id, redirect_uri, state, code_challenge, resource, scope)
      VALUES (${clientId}, ${redirectUri}, ${state}, ${challenge},
              ${url.searchParams.get("resource")}, ${url.searchParams.get("scope") ?? ""})
      RETURNING id`
  )[0]

  return NextResponse.redirect(new URL(`/ip-mcp/authorize?req=${row.id}`, url.origin), {
    headers: { "cache-control": "no-store" },
  })
}

/** 인가 코드·갱신 토큰 → 액세스 토큰 */
async function issueToken(req: NextRequest) {
  const form = new URLSearchParams(await req.text())
  const grant = form.get("grant_type")

  async function mint(clientId: string, userId: string) {
    const access = randomToken(32)
    const refresh = randomToken(32)
    await prisma.$executeRaw`
      INSERT INTO ip.oauth_tokens (access_hash, refresh_hash, client_id, user_id, expires_at)
      VALUES (${sha256(access)}, ${sha256(refresh)}, ${clientId}, ${userId},
              ${new Date(Date.now() + ACCESS_TTL_SEC * 1000)})`
    return json({
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: "mcp",
    })
  }

  if (grant === "authorization_code") {
    const code = form.get("code") ?? ""
    const verifier = form.get("code_verifier") ?? ""
    const row = (
      await prisma.$queryRaw<
        {
          code_hash: string
          client_id: string
          user_id: string
          redirect_uri: string
          code_challenge: string
          expires_at: Date
          used_at: Date | null
        }[]
      >`SELECT * FROM ip.oauth_codes WHERE code_hash = ${sha256(code)}`
    )[0]

    if (!row || row.used_at) return json({ error: "invalid_grant" }, 400)
    if (row.expires_at < new Date()) {
      return json(
        { error: "invalid_grant", error_description: "코드가 만료되었습니다." },
        400
      )
    }
    if (form.get("redirect_uri") !== row.redirect_uri) {
      return json(
        { error: "invalid_grant", error_description: "redirect_uri 가 다릅니다." },
        400
      )
    }

    // PKCE — verifier 의 S256 이 등록된 challenge 와 같아야 한다.
    const computed = createHash("sha256").update(verifier).digest("base64url")
    if (computed !== row.code_challenge) {
      return json(
        { error: "invalid_grant", error_description: "PKCE 검증에 실패했습니다." },
        400
      )
    }

    // 코드는 한 번만. 재사용은 탈취 신호다.
    await prisma.$executeRaw`
      UPDATE ip.oauth_codes SET used_at = now() WHERE code_hash = ${row.code_hash}`
    return mint(row.client_id, row.user_id)
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") ?? ""
    const row = (
      await prisma.$queryRaw<{ id: string; client_id: string; user_id: string }[]>`
        SELECT id, client_id, user_id FROM ip.oauth_tokens
         WHERE refresh_hash = ${sha256(refresh)} AND revoked_at IS NULL`
    )[0]
    if (!row) return json({ error: "invalid_grant" }, 400)

    // 갱신할 때마다 옛 토큰은 죽인다(회전).
    await prisma.$executeRaw`
      UPDATE ip.oauth_tokens SET revoked_at = now() WHERE id = ${row.id}::uuid`
    return mint(row.client_id, row.user_id)
  }

  return json({ error: "unsupported_grant_type" }, 400)
}

/**
 * 승인 화면이 부른다. 사람 확인은 Omnis 세션으로 한다.
 *
 * 예전에는 정적 앱에서 Supabase 세션 토큰을 헤더로 넘겨받았다. 승인 화면이
 * Omnis 안으로 들어오면서 그 왕복이 사라졌다 — 같은 오리진이라 쿠키가 그대로
 * 실려 오고, 로그인 화면을 새로 만들 필요도 없다.
 */
async function approve(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return json({ error: "로그인이 필요합니다." }, 401)

  // Omnis 계정이 있어도 지식재산권 구성원이 아니면 인가하지 않는다.
  const membership = await getMembership(session.user.id)
  if (!membership) return json({ error: "승인된 멤버가 아닙니다." }, 403)

  let body: { req?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400)
  }

  const request = (
    await prisma.$queryRaw<
      {
        id: string
        client_id: string
        redirect_uri: string
        state: string | null
        code_challenge: string
        resource: string | null
        expires_at: Date
      }[]
    >`SELECT * FROM ip.oauth_requests WHERE id = ${body.req ?? ""}::uuid`
  )[0]
  if (!request) return json({ error: "만료되었거나 없는 요청입니다." }, 400)
  if (request.expires_at < new Date()) {
    return json({ error: "요청이 만료되었습니다. 처음부터 다시 시도하세요." }, 400)
  }

  const code = randomToken(32)
  await prisma.$executeRaw`
    INSERT INTO ip.oauth_codes
      (code_hash, client_id, user_id, redirect_uri, code_challenge, resource)
    VALUES (${sha256(code)}, ${request.client_id}, ${session.user.id},
            ${request.redirect_uri}, ${request.code_challenge}, ${request.resource})`
  await prisma.$executeRaw`DELETE FROM ip.oauth_requests WHERE id = ${request.id}::uuid`

  const target = new URL(request.redirect_uri)
  target.searchParams.set("code", code)
  if (request.state) target.searchParams.set("state", request.state)
  return json({ redirect: target.toString() })
}

// ─── 라우팅 ─────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS })
}

export async function GET(req: NextRequest) {
  const base = baseOf(req)
  const tail = tailOf(req)

  if (tail === "/.well-known/oauth-protected-resource") {
    return protectedResourceMetadata(base)
  }
  if (
    tail === "/.well-known/oauth-authorization-server" ||
    tail === "/.well-known/openid-configuration"
  ) {
    return authorizationServerMetadata(base)
  }
  if (tail === "/authorize") return authorize(req)

  // 커넥터가 살아 있는지 볼 때 GET 을 던지는 클라이언트가 있다.
  return json({ ...SERVER_INFO, transport: "streamable-http" })
}

export async function POST(req: NextRequest) {
  const base = baseOf(req)
  const tail = tailOf(req)

  if (tail === "/register") return registerClient(req)
  if (tail === "/token") return issueToken(req)
  if (tail === "/approve") return approve(req)

  let message: { id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    message = (await req.json()) as typeof message
  } catch {
    return fail(null, -32700, "본문을 JSON 으로 읽지 못했습니다.")
  }

  const { id, method, params } = message

  // 알림(notification)은 id 가 없다. 답을 기다리지 않으므로 본문 없이 끝낸다.
  if (id === undefined || id === null) {
    return new NextResponse(null, { status: 202, headers: CORS })
  }

  if (method === "initialize") {
    return reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      // 클라이언트가 시스템 프롬프트에 실어주는 자리. 여기까지 읽어주는 도구라면
      // 지침을 미리 알고 오고, 아니어도 쓰기 게이트에서 한 번 더 걸린다.
      instructions: INSTRUCTIONS,
    })
  }

  if (method === "ping") return reply(id, {})

  // 여기부터는 누구인지 알아야 한다.
  const caller = await resolveCaller(req.headers.get("authorization"))
  if (!caller) {
    return json(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32001,
          message:
            "토큰이 없거나 폐기되었습니다. IP 플랫폼의 「AI 도구 설치하기」에서 새로 발급하세요.",
        },
      },
      401,
      {
        // OAuth 를 쓰는 클라이언트는 이 헤더를 보고 스스로 등록·인가를 시작한다.
        // `.well-known` 을 호스트 루트에 둘 수 없어서 주소를 명시해 준다.
        "www-authenticate": `Bearer realm="hadd-ip", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      }
    )
  }

  if (method === "tools/list") return reply(id, { tools: TOOLS })

  if (method === "tools/call") {
    const name = params?.name as string
    const args = (params?.arguments as Record<string, unknown>) ?? {}
    const result = await runTool(name, args, caller)

    if ("error" in result) {
      // 도구가 실패한 것은 프로토콜 오류가 아니다. isError 로 알려 모델이
      // 스스로 고쳐 다시 부르게 한다.
      return reply(id, {
        content: [{ type: "text", text: result.error }],
        isError: true,
      })
    }
    return reply(id, { content: [{ type: "text", text: result.text }] })
  }

  return fail(id, -32601, `지원하지 않는 메서드입니다: ${method}`)
}
