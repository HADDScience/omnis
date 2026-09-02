/**
 * MCP 서버 검증 — OAuth 전 구간과 도구를 실제로 돌린다.
 *
 *   DATABASE_URL=… IP_MCP_BASE=http://localhost:3050 npx tsx scripts/verify-ip-mcp.ts
 *
 * 커넥터를 붙여 보는 것으로는 "PKCE 가 틀렸을 때 막히는가", "코드를 두 번 쓰면
 * 거절되는가", "지침을 안 읽고 쓰면 막히는가"를 재현하기 어렵다. 여기서 규격대로
 * 왕복을 만들어 확인하고, 끝나면 만든 것을 전부 지운다.
 */
import { createHash, randomBytes } from "crypto"

import { prisma } from "../lib/db"
import { hashSync } from "bcryptjs"

const BASE = process.env.IP_MCP_BASE ?? "http://localhost:3050"
const MCP = `${BASE}/api/ip-mcp`
const TEST_NAME = "__mcp_test__"
const TEST_PW = "mcp-test-only-pw"
const REDIRECT = process.env.IP_MCP_REDIRECT ?? "http://localhost:9999/callback"

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

/** MCP JSON-RPC 한 번. */
async function rpc(
  method: string,
  params: Record<string, unknown> | undefined,
  token?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(MCP, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}

/** tools/call 의 본문 텍스트만 꺼낸다. rpc() 가 돌려준 것을 그대로 받는다. */
type Rpc = { status: number; body: Record<string, unknown> }

function toolText(res: Rpc): string {
  const result = res.body.result as { content?: { text: string }[] } | undefined
  return result?.content?.[0]?.text ?? ""
}

function isToolError(res: Rpc): boolean {
  return Boolean((res.body.result as { isError?: boolean } | undefined)?.isError)
}

async function main() {
  // ─── 준비: 구성원인 임시 계정 ───
  const user = await prisma.user.upsert({
    where: { name: TEST_NAME },
    update: { passwordHash: hashSync(TEST_PW, 10), isActive: true },
    create: {
      name: TEST_NAME,
      email: "mcp-test@local",
      passwordHash: hashSync(TEST_PW, 10),
      role: "MEMBER",
    },
    select: { id: true },
  })
  await prisma.$executeRaw`
    INSERT INTO ip.members (user_id, email, display_name, role)
    VALUES (${user.id}, 'mcp-test@local', ${TEST_NAME}, 'editor')
    ON CONFLICT (user_id) DO UPDATE SET role = 'editor'`

  console.log("\n[1] 메타데이터 (RFC 9728 · 8414)")
  const prm = await (await fetch(`${MCP}/.well-known/oauth-protected-resource`)).json()
  check("보호 자원 메타데이터가 자기 주소를 가리킨다", prm.resource === MCP, JSON.stringify(prm))
  const asm = await (await fetch(`${MCP}/.well-known/oauth-authorization-server`)).json()
  check("인가 서버 메타데이터의 issuer 가 같다", asm.issuer === MCP)
  check("PKCE S256 만 받는다", JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]')
  check("공개 클라이언트만 받는다", JSON.stringify(asm.token_endpoint_auth_methods_supported) === '["none"]')

  console.log("\n[2] 토큰 없이 부르면 401 + WWW-Authenticate")
  const noAuth = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  })
  check("401 이다", noAuth.status === 401, `${noAuth.status}`)
  check(
    "WWW-Authenticate 가 메타데이터 주소를 알려준다",
    (noAuth.headers.get("www-authenticate") ?? "").includes("resource_metadata="),
    noAuth.headers.get("www-authenticate") ?? "(없음)"
  )

  console.log("\n[3] initialize·ping 은 인증 없이 통한다")
  const init = await rpc("initialize", {})
  const initResult = init.body.result as { serverInfo?: { name: string }; instructions?: string }
  check("initialize 가 서버 정보를 준다", initResult?.serverInfo?.name === "hadd-ip")
  check("instructions 가 실려 온다", Boolean(initResult?.instructions))

  console.log("\n[4] 동적 클라이언트 등록 (RFC 7591)")
  const regBad = await fetch(`${MCP}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "테스트" }),
  })
  check("redirect_uris 없으면 400", regBad.status === 400)

  const reg = await (
    await fetch(`${MCP}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "__검증용 도구__", redirect_uris: [REDIRECT] }),
    })
  ).json()
  check("client_id 를 발급받았다", typeof reg.client_id === "string", JSON.stringify(reg))
  const clientId = reg.client_id as string

  console.log("\n[5] authorize — 수상한 요청은 되돌려 보내지 않는다")
  const verifier = randomBytes(32).toString("hex")
  const challenge = createHash("sha256").update(verifier).digest("base64url")

  const unknownClient = await fetch(
    `${MCP}/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`,
    { redirect: "manual" }
  )
  check("모르는 client_id 는 400", unknownClient.status === 400)

  const badRedirect = await fetch(
    `${MCP}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent("https://evil.example.com/cb")}&code_challenge=${challenge}&code_challenge_method=S256`,
    { redirect: "manual" }
  )
  check("등록되지 않은 redirect_uri 는 400", badRedirect.status === 400)

  const noPkce = await fetch(
    `${MCP}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}`,
    { redirect: "manual" }
  )
  check("PKCE 없으면 400", noPkce.status === 400)

  const authRes = await fetch(
    `${MCP}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`,
    { redirect: "manual" }
  )
  const location = authRes.headers.get("location") ?? ""
  check("정상 요청은 승인 화면으로 보낸다", location.includes("/ip-mcp/authorize?req="), location)
  const reqId = new URL(location, BASE).searchParams.get("req") ?? ""

  console.log("\n[6] 승인 — 로그인한 구성원만")
  const anon = await fetch(`${MCP}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ req: reqId }),
  })
  check("로그인 없이 승인하면 401", anon.status === 401, `${anon.status}`)

  // Omnis 로그인 (NextAuth credentials)
  const jar: string[] = []
  const withJar = (h: Headers) => {
    const set = h.getSetCookie?.() ?? []
    for (const c of set) jar.push(c.split(";")[0])
  }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  withJar(csrfRes.headers)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.join("; ") },
    body: new URLSearchParams({
      csrfToken,
      name: TEST_NAME,
      password: TEST_PW,
      callbackUrl: `${BASE}/dashboard`,
    }),
    redirect: "manual",
  })
  withJar(loginRes.headers)
  const cookie = jar.join("; ")

  const approveRes = await fetch(`${MCP}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ req: reqId }),
  })
  const approveBody = (await approveRes.json()) as { redirect?: string; error?: string }
  check(
    "구성원이 승인하면 코드가 담긴 주소가 돌아온다",
    approveRes.status === 200 && Boolean(approveBody.redirect),
    JSON.stringify(approveBody)
  )
  const cbUrl = new URL(approveBody.redirect ?? "http://x/")
  const code = cbUrl.searchParams.get("code") ?? ""
  check("state 가 그대로 실려 돌아온다", cbUrl.searchParams.get("state") === "xyz")

  console.log("\n[7] 토큰 교환 — PKCE")
  const wrongVerifier = await (
    await fetch(`${MCP}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: "wrong-verifier",
        redirect_uri: REDIRECT,
      }),
    })
  ).json()
  check("verifier 가 틀리면 invalid_grant", wrongVerifier.error === "invalid_grant")

  const tokenRes = await (
    await fetch(`${MCP}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      }),
    })
  ).json()
  check("올바른 verifier 로 액세스 토큰을 받는다", typeof tokenRes.access_token === "string")
  let accessToken = tokenRes.access_token as string
  const refreshToken = tokenRes.refresh_token as string

  const replay = await (
    await fetch(`${MCP}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      }),
    })
  ).json()
  check("같은 코드를 두 번 쓰면 거절된다", replay.error === "invalid_grant")

  const refreshed = await (
    await fetch(`${MCP}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    })
  ).json()
  check("갱신 토큰으로 새 액세스 토큰을 받는다", typeof refreshed.access_token === "string")

  // 회전은 **같은 행**의 revoked_at 을 세운다. 그 행이 방금까지 쓰던 액세스 토큰을
  // 들고 있었으므로, 이후 호출은 새로 받은 토큰으로 해야 한다.
  const revokedOld = await rpc("tools/list", undefined, accessToken)
  check("회전된 옛 액세스 토큰은 더 이상 통하지 않는다", revokedOld.status === 401, `${revokedOld.status}`)
  accessToken = refreshed.access_token as string

  const reusedRefresh = await (
    await fetch(`${MCP}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    })
  ).json()
  check("옛 갱신 토큰은 죽는다 (회전)", reusedRefresh.error === "invalid_grant")

  console.log("\n[8] 도구 — 읽기")
  const list = await rpc("tools/list", undefined, accessToken)
  const tools = (list.body.result as { tools?: { name: string }[] })?.tools ?? []
  check(`도구 ${tools.length}개가 나온다`, tools.length === 8, tools.map((t) => t.name).join(", "))

  const listIp = await rpc(
    "tools/call",
    { name: "list_ip", arguments: { kind: "trademark", query: "ADDGEL" } },
    accessToken
  )
  check("list_ip 로 이름 검색이 된다", toolText(listIp).includes("TM-04"), toolText(listIp).slice(0, 120))

  const getIp = await rpc("tools/call", { name: "get_ip", arguments: { entityId: "TM-04" } }, accessToken)
  const got = toolText(getIp)
  check("get_ip 가 현재·이력·출발선을 준다", got.includes("현재") && got.includes("진행_이력") && got.includes("출발선"))

  const todo = await rpc("tools/call", { name: "list_todo", arguments: {} }, accessToken)
  check("list_todo 가 두 갈래로 나눠 준다", toolText(todo).includes("회신_필요") && toolText(todo).includes("상대_회신_대기"))

  console.log("\n[9] 쓰기 게이트 — 지침을 지나야 쓴다")
  const noGuide = await rpc(
    "tools/call",
    {
      name: "add_progress",
      arguments: {
        date: "1999-02-02",
        entityKind: "trademark",
        entityId: "TM-04",
        stage: "검토의견",
        nextTurn: "none",
        note: "__mcp 검증__",
      },
    },
    accessToken
  )
  check("지침 없이 쓰면 거절된다", isToolError(noGuide))
  check("거절하면서 지침 전문을 준다", toolText(noGuide).includes("HADD IP 사용 지침"))
  check("확인 코드가 지침에 들어 있다", toolText(noGuide).includes("guide-2026-08-14-r1"))

  const mailNoRaw = await rpc(
    "tools/call",
    {
      name: "add_progress",
      arguments: {
        date: "1999-02-02",
        entityKind: "trademark",
        entityId: "TM-04",
        stage: "검토의견",
        nextTurn: "none",
        source: "mail",
        note: "__mcp 검증__",
        guide: "guide-2026-08-14-r1",
      },
    },
    accessToken
  )
  check("메일 근거인데 raw 가 없으면 저장하지 않는다", isToolError(mailNoRaw))

  const badStage = await rpc(
    "tools/call",
    {
      name: "add_progress",
      arguments: {
        date: "1999-02-02",
        entityKind: "trademark",
        entityId: "TM-04",
        stage: "없는단계",
        nextTurn: "none",
        guide: "guide-2026-08-14-r1",
      },
    },
    accessToken
  )
  check("정의되지 않은 단계는 거절된다", isToolError(badStage))

  const written = await rpc(
    "tools/call",
    {
      name: "add_progress",
      arguments: {
        date: "1999-02-02",
        entityKind: "trademark",
        entityId: "TM-04",
        stage: "검토의견",
        nextTurn: "none",
        note: "__mcp 검증용 기록__",
        guide: "guide-2026-08-14-r1",
      },
    },
    accessToken
  )
  const writtenText = toolText(written)
  check("확인 코드가 있으면 저장된다", !isToolError(written) && writtenText.includes("기록_id"))
  check(
    "지난 날짜는 단계를 되돌리지 않는다고 알려준다",
    writtenText.includes("지난 일로 되돌리지 않습니다"),
    writtenText.slice(0, 200)
  )

  const auditActor = await prisma.$queryRaw<{ actor: string | null }[]>`
    SELECT actor FROM ip.audit_log
     WHERE entity = 'progress_entries' AND after->>'note' = '__mcp 검증용 기록__'
     ORDER BY at DESC LIMIT 1`
  check("감사 기록의 행위자가 MCP 호출자다", auditActor[0]?.actor === user.id, `actor=${auditActor[0]?.actor}`)

  console.log("\n[10] viewer 는 쓰지 못한다")
  await prisma.$executeRaw`UPDATE ip.members SET role = 'viewer' WHERE user_id = ${user.id}`
  const viewerWrite = await rpc(
    "tools/call",
    {
      name: "add_progress",
      arguments: {
        date: "1999-02-03",
        entityKind: "trademark",
        entityId: "TM-04",
        stage: "검토의견",
        nextTurn: "none",
        guide: "guide-2026-08-14-r1",
      },
    },
    accessToken
  )
  check("viewer 의 쓰기는 거절된다", isToolError(viewerWrite) && toolText(viewerWrite).includes("읽기 전용"))
  const viewerRead = await rpc("tools/call", { name: "list_todo", arguments: {} }, accessToken)
  check(
    "viewer 도 읽기는 된다",
    !isToolError(viewerRead) && toolText(viewerRead).includes("회신_필요"),
    toolText(viewerRead).slice(0, 80)
  )

  // ─── 정리 ───
  await prisma.$executeRaw`DELETE FROM ip.progress_entries WHERE note = '__mcp 검증용 기록__'`
  await prisma.$executeRaw`DELETE FROM ip.audit_log WHERE actor = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.oauth_tokens WHERE user_id = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.oauth_codes WHERE user_id = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.oauth_clients WHERE client_id = ${clientId}`
  await prisma.$executeRaw`DELETE FROM ip.mcp_guide_reads WHERE user_id = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.mcp_tokens WHERE user_id = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.members WHERE user_id = ${user.id}`
  await prisma.user.delete({ where: { id: user.id } })
  console.log("\n임시 계정·검증 데이터 정리 완료")

  console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
