/**
 * omnis-hadd MCP 검증 — 옴니스 도구를 실제로 돌린다. (OAuth·지식재산권 도구는 verify-ip-mcp.ts)
 *
 *   IP_MCP_BASE=http://localhost:3000 npx tsx scripts/verify-omnis-mcp.ts
 *
 * 지식재산권 구성원이 **아닌** 임시 계정으로 돈다 — 그래야 "Omnis 구성원이면 붙는다" 와
 * "지식재산권 도구는 구성원에게만" 이 둘 다 검증된다. 끝나면 만든 것을 전부 지운다.
 * ask_omnis·post_message 는 Gemini 를 실제로 부른다(각 1~2회).
 */
import { createHash, randomBytes } from "crypto"
import { hashSync } from "bcryptjs"
import { prisma } from "../lib/db"

const BASE = process.env.IP_MCP_BASE ?? "http://localhost:3000"
const MCP = `${BASE}/api/ip-mcp`
const TEST_NAME = "__omnis_mcp_test__"
const TEST_PW = "omnis-mcp-test-only"
const REDIRECT = "http://localhost:9999/callback"

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

type Rpc = { status: number; body: Record<string, unknown> }
async function rpc(method: string, params: Record<string, unknown> | undefined, token?: string): Promise<Rpc> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(MCP, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}
const call = (name: string, args: Record<string, unknown>, token: string) => rpc("tools/call", { name, arguments: args }, token)
const text = (r: Rpc) => ((r.body.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "")
const isErr = (r: Rpc) => Boolean((r.body.result as { isError?: boolean })?.isError)

/** OAuth 한 바퀴 — 등록 → 승인(세션) → 코드 → 토큰. verify-ip-mcp 와 같은 절차다. */
let clientId = ""
async function obtainToken(): Promise<string> {
  const reg = (await (await fetch(`${MCP}/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "__omnis 검증용__", redirect_uris: [REDIRECT] }),
  })).json()) as { client_id: string }
  clientId = reg.client_id
  const verifier = randomBytes(32).toString("hex")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const authRes = await fetch(`${MCP}/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`, { redirect: "manual" })
  const reqId = new URL(authRes.headers.get("location") ?? "", BASE).searchParams.get("req") ?? ""

  const jar: string[] = []
  const withJar = (h: Headers) => { for (const c of h.getSetCookie?.() ?? []) jar.push(c.split(";")[0]) }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); withJar(csrfRes.headers)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken, name: TEST_NAME, password: TEST_PW, callbackUrl: `${BASE}/dashboard` }), redirect: "manual",
  }); withJar(loginRes.headers)
  const approve = (await (await fetch(`${MCP}/approve`, {
    method: "POST", headers: { "content-type": "application/json", cookie: jar.join("; ") }, body: JSON.stringify({ req: reqId }),
  })).json()) as { redirect?: string; error?: string }
  check("지식재산권 구성원이 아니어도 Omnis 계정이면 승인된다", Boolean(approve.redirect), JSON.stringify(approve))
  const code = new URL(approve.redirect ?? "http://x/").searchParams.get("code") ?? ""
  const tok = (await (await fetch(`${MCP}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT }),
  })).json()) as { access_token?: string }
  check("액세스 토큰을 받았다", Boolean(tok.access_token))
  return tok.access_token ?? ""
}

async function main() {
  const user = await prisma.user.upsert({
    where: { name: TEST_NAME },
    update: { passwordHash: hashSync(TEST_PW, 10), isActive: true },
    create: { name: TEST_NAME, email: "omnis-mcp-test@local", passwordHash: hashSync(TEST_PW, 10), role: "MEMBER", position: "검증" },
    select: { id: true },
  })
  await prisma.$executeRaw`DELETE FROM ip.members WHERE user_id = ${user.id}`
  let createdTaskId: string | null = null

  try {
    console.log("\n[1] 인가 — Omnis 구성원 전원")
    const token = await obtainToken()

    console.log("\n[2] 도구 목록·지침")
    const init = (await rpc("initialize", {})).body.result as { serverInfo: { name: string }; instructions: string }
    check("서버 이름이 omnis-hadd", init.serverInfo.name === "omnis-hadd")
    check("지침에 옴니스와 지식재산권 안내가 함께 있다", init.instructions.includes("ask_omnis") && init.instructions.includes("read_guide"))
    const tools = ((await rpc("tools/list", undefined, token)).body.result as { tools: { name: string }[] }).tools
    check(`도구 20개 (옴니스 12 + 지식재산권 8) — ${tools.length}`, tools.length === 20)

    console.log("\n[3] 거부되어야 하는 것")
    const bad = await rpc("tools/list", undefined, "hadd_nope")
    check("가짜 개인 토큰은 401", bad.status === 401)
    const ip = await call("list_ip", {}, token)
    check("구성원이 아니면 지식재산권 도구는 isError", isErr(ip) && text(ip).includes("구성원"), text(ip))
    const unknown = await call("no_such_tool", {}, token)
    check("모르는 도구는 isError", isErr(unknown))
    const noAssignee = await call("create_task", { name: "x", assignees: [] }, token)
    check("담당자 없는 create_task 는 isError", isErr(noAssignee))
    const ghost = await call("get_task", { task: "__없는_업무_이름__" }, token)
    check("없는 업무는 isError + list_tasks 안내", isErr(ghost) && text(ghost).includes("list_tasks"))
    const badName = await call("create_task", { name: "x", assignees: ["__없는사람__"] }, token)
    check("모르는 담당자 이름은 isError", isErr(badName) && text(badName).includes("list_members"))

    console.log("\n[4] 읽기")
    const members = await call("list_members", {}, token)
    check("list_members 에 검증 계정이 있다", text(members).includes(TEST_NAME))
    const projects = await call("list_projects", { query: "AI" }, token)
    check("list_projects 가 업무 수를 센다", /업무 \d+/.test(text(projects)), text(projects).slice(0, 120))
    const tasks = await call("list_tasks", { limit: 5 }, token)
    check("list_tasks 가 #슬러그 줄을 준다", /#[^\s]+ · /.test(text(tasks)), text(tasks).slice(0, 120))
    const firstSlug = text(tasks).match(/#(\S+) · /)?.[1] ?? ""
    const one = await call("get_task", { task: firstSlug, messages: 5 }, token)
    check("get_task 가 상태·담당·체크리스트를 준다", text(one).includes("상태 ") && text(one).includes("담당 "), text(one).slice(0, 160))
    const overdue = await call("list_tasks", { overdue: true, limit: 3 }, token)
    check("overdue 목록의 마감에는 (지연) 이 붙는다", text(overdue).includes("조건에 맞는") || text(overdue).includes("(지연)"))
    const crm = await call("crm_overview", {}, token)
    check("crm_overview 가 재고를 센다", text(crm).includes("재고"), text(crm).slice(0, 100))
    const firstOrg = await prisma.crmOrg.findFirst({ select: { name: true } })
    if (firstOrg) {
      const org = await call("find_org", { query: firstOrg.name.slice(0, 3) }, token)
      check("find_org 가 기관을 찾는다", text(org).startsWith("# "), text(org).slice(0, 100))
    }
    const cards = await call("list_omnis_cards", {}, token)
    const cardId = text(cards).match(/· ([0-9a-f-]{36})$/m)?.[1]
    if (cardId) {
      const card = await call("get_omnis_card", { card: cardId }, token)
      check("get_omnis_card 가 본문을 준다", text(card).startsWith("# ["), text(card).slice(0, 80))
    }
    const found = await call("search_knowledge", { query: "애드젤 샘플", limit: 3 }, token)
    check("search_knowledge 가 유사도와 함께 조각을 준다", /\(\d+%\)/.test(text(found)), text(found).slice(0, 120))

    console.log("\n[5] 쓰기 — 화면과 같은 길")
    const created = await call("create_task", {
      name: "__MCP 검증용 업무__", assignees: [TEST_NAME], instruction: "검증용 지시입니다", checklist: ["첫째", "둘째"], deadline: "2099-12-31",
    }, token)
    const slug = text(created).match(/#(\S+) /)?.[1] ?? ""
    check("create_task 가 슬러그를 돌려준다", !isErr(created) && Boolean(slug), text(created))
    const t = await prisma.task.findUnique({ where: { slug }, include: { checklists: true, assignees: true, messages: true } })
    createdTaskId = t?.id ?? null
    check("업무·체크리스트 2·담당자 1·채팅 2건(지시+카드)이 생겼다", !!t && t.checklists.length === 2 && t.assignees.length === 1 && t.messages.length === 2)
    check("마감이 KST 로 들어갔다", t?.deadline?.toISOString() === "2099-12-31T14:59:59.000Z", t?.deadline?.toISOString())

    const posted = await call("post_message", { task: slug, content: "첫째 항목 끝냈습니다" }, token)
    check("post_message 가 업무에 붙고 처리 결과를 말한다", !isErr(posted) && text(posted).includes("업무:") && text(posted).includes("업무 처리"), text(posted))
    const after = await prisma.task.findUnique({ where: { slug }, include: { checklists: true, messages: true } })
    check("메시지가 스레드에 쌓였다 (3건 이상)", (after?.messages.length ?? 0) >= 3, String(after?.messages.length))

    const ask = await call("ask_omnis", { question: "__MCP 검증용 업무__ 는 누가 담당이야?" }, token)
    check("ask_omnis 가 답과 근거를 준다", !isErr(ask) && text(ask).includes("근거:"), text(ask).slice(0, 160))
  } finally {
    // ─── 정리 ───
    if (createdTaskId) {
      await prisma.notification.deleteMany({ where: { entityId: createdTaskId } }).catch(() => {})
      await prisma.chatMention.deleteMany({ where: { message: { taskId: createdTaskId } } }).catch(() => {})
      await prisma.embeddingChunk.deleteMany({ where: { OR: [{ source: "TASK", sourceId: createdTaskId }, { source: "CHAT_MESSAGE", sourceId: { in: (await prisma.chatMessage.findMany({ where: { taskId: createdTaskId }, select: { id: true } })).map((m) => m.id) } }] } })
      await prisma.chatMessage.deleteMany({ where: { taskId: createdTaskId } })
      await prisma.checklist.deleteMany({ where: { taskId: createdTaskId } })
      await prisma.taskAssignee.deleteMany({ where: { taskId: createdTaskId } })
      await prisma.task.delete({ where: { id: createdTaskId } })
    }
    await prisma.omnisQuery.deleteMany({ where: { userId: user.id } })
    await prisma.activityLog.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.geminiUsage.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.$executeRaw`DELETE FROM ip.oauth_tokens WHERE user_id = ${user.id}`
    await prisma.$executeRaw`DELETE FROM ip.oauth_codes WHERE user_id = ${user.id}`
    // 클라이언트를 지우면 토큰이 따라 지워진다(FK cascade) — 그래서 맨 끝에서.
    if (clientId) await prisma.$executeRaw`DELETE FROM ip.oauth_clients WHERE client_id = ${clientId}`
    await prisma.user.delete({ where: { id: user.id } })
    console.log("\n임시 계정·검증 데이터 정리 완료")
    console.log(`${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed`)
    await prisma.$disconnect()
    if (failed > 0) process.exit(1)
  }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
