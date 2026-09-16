/**
 * hadd-omnis MCP 검증 — 옴니스 도구를 실제로 돌린다. (OAuth·지식재산권 도구는 verify-ip-mcp.ts)
 *
 *   IP_MCP_BASE=http://localhost:3000 npx tsx scripts/verify-omnis-mcp.ts
 *
 * 지식재산권 구성원이 **아닌** 임시 계정으로 돈다 — 그래야 "Omnis 구성원이면 붙는다" 와
 * "지식재산권 도구는 구성원에게만" 이 둘 다 검증된다. 끝나면 만든 것을 전부 지운다.
 * ask_omnis·post_message 는 Gemini 를 실제로 부른다(각 1~2회).
 */
import { createHash, createHmac, randomBytes } from "crypto"
import { hashSync } from "bcryptjs"
import { prisma } from "../lib/db"
import { deleteObject, objectKeyFor } from "../lib/storage"

/** 서명은 맞고 시각만 지난 링크 — 만료 거절을 보려고 lib/omnis-mcp 의 형식을 그대로 흉내 낸다. */
function forgeExpiredLink(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: null, e: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ""
  return `${payload}.${createHmac("sha256", secret).update(`mcp-upload.${payload}`).digest("base64url")}`
}

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
  let createdCardId: string | null = null
  const uploadedIds: string[] = []

  try {
    console.log("\n[1] 인가 — Omnis 구성원 전원")
    const token = await obtainToken()

    console.log("\n[2] 도구 목록·지침")
    const init = (await rpc("initialize", {})).body.result as { serverInfo: { name: string }; instructions: string }
    check("서버 이름이 hadd-omnis", init.serverInfo.name === "hadd-omnis")
    check("지침에 옴니스와 지식재산권 안내가 함께 있다", init.instructions.includes("ask_omnis") && init.instructions.includes("read_guide"))
    check("지침에 파일 올리고 읽는 법이 있다", init.instructions.includes("upload_file") && init.instructions.includes("create_upload_link") && init.instructions.includes("read_file"))
    check("지침에 알림 응답·업무 수정 안내가 있다", init.instructions.includes("respond_notification") && init.instructions.includes("update_task"))
    const tools = ((await rpc("tools/list", undefined, token)).body.result as { tools: { name: string }[] }).tools
    check(`도구 37개 (옴니스 29 + 지식재산권 8) — ${tools.length}`, tools.length === 37)

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

    console.log("\n[6] 파일 올리기")
    const fileIdOf = (s: string) => s.match(/파일 ID ([0-9a-f-]{36})/)?.[1] ?? ""
    const noBody = await call("upload_file", { name: "빈.md" }, token)
    check("본문 없는 upload_file 은 isError", isErr(noBody), text(noBody))
    const both = await call("upload_file", { name: "a.md", content: "a", content_base64: "YQ==" }, token)
    check("content 와 content_base64 를 함께 주면 isError", isErr(both), text(both))
    const huge = await call("upload_file", { name: "큰.txt", content: "a".repeat(4 * 1024 * 1024 + 1) }, token)
    check("4MB 넘는 파일은 isError", isErr(huge) && text(huge).includes("MB"), text(huge))
    const ghostTask = await call("upload_file", { name: "a.md", content: "a", task: "__없는_업무_이름__" }, token)
    check("없는 업무에 올리면 isError", isErr(ghostTask))

    const md = await call("upload_file", { name: "__MCP 검증__.md", content: "# 검증\n한글 본문", task: slug }, token)
    const mdId = fileIdOf(text(md))
    if (mdId) uploadedIds.push(mdId)
    check("upload_file(content) 가 파일 ID 를 준다", !isErr(md) && Boolean(mdId), text(md))
    const mdRow = mdId ? await prisma.file.findUnique({ where: { id: mdId } }) : null
    check("업무 첨부로 기록되고 크기·형식이 맞다", mdRow?.taskId === createdTaskId && mdRow?.size === Buffer.byteLength("# 검증\n한글 본문") && (mdRow?.mimeType ?? "").startsWith("text/markdown"), JSON.stringify(mdRow))

    const png = await call("upload_file", { name: "__점__.png", content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }, token)
    const pngId = fileIdOf(text(png))
    if (pngId) uploadedIds.push(pngId)
    check("upload_file(content_base64) 가 이미지 형식을 이름으로 채운다", !isErr(png) && (await prisma.file.findUnique({ where: { id: pngId } }))?.mimeType === "image/png", text(png))

    const link = await call("create_upload_link", { task: slug }, token)
    const url = text(link).match(/https?:\/\/\S+\/upload\?t=[^\s'"]+/)?.[0] ?? ""
    check("create_upload_link 가 링크를 준다", !isErr(link) && Boolean(url), text(link))
    const form = () => { const f = new FormData(); f.append("file", new Blob(["a,b\n1,2\n"]), "__링크 검증__.csv"); return f }
    const badSig = await fetch(url.replace(/(t=[^.]+\.)(.)/, (_, head: string, c: string) => head + (c === "A" ? "B" : "A")), { method: "POST", body: form() })
    check("서명이 틀린 링크는 401", badSig.status === 401, String(badSig.status))
    const noToken = await fetch(`${MCP}/upload`, { method: "POST", body: form() })
    check("토큰 없는 업로드는 401", noToken.status === 401, String(noToken.status))
    const expired = await fetch(`${MCP}/upload?t=${forgeExpiredLink(user.id)}`, { method: "POST", body: form() })
    check("만료된 링크는 401", expired.status === 401, String(expired.status))
    const noFile = await fetch(url, { method: "POST", body: new FormData() })
    check("file 필드가 없으면 400", noFile.status === 400, String(noFile.status))
    const up = await fetch(url, { method: "POST", body: form() })
    const upBody = (await up.json()) as { id?: string; name?: string }
    if (upBody.id) uploadedIds.push(upBody.id)
    check("링크로 올리면 201 + 파일 ID", up.status === 201 && Boolean(upBody.id), JSON.stringify(upBody))
    const csvRow = upBody.id ? await prisma.file.findUnique({ where: { id: upBody.id } }) : null
    check("링크 업로드도 업무 첨부 · 형식은 이름으로", csvRow?.taskId === createdTaskId && (csvRow?.mimeType ?? "").startsWith("text/csv"), JSON.stringify(csvRow))

    const ghostFile = await call("post_message", { task: slug, content: "첨부", files: ["00000000-0000-0000-0000-000000000000"] }, token)
    check("없는 파일 ID 로 post_message 는 isError", isErr(ghostFile), text(ghostFile))
    const attached = await call("post_message", { task: slug, content: "검증 자료 첨부합니다", files: [mdId, upBody.id] }, token)
    check("post_message 가 첨부 수를 말한다", !isErr(attached) && text(attached).includes("첨부 2"), text(attached))
    const linked = await prisma.file.findMany({ where: { id: { in: [mdId, upBody.id ?? ""] } }, select: { messageId: true } })
    check("두 파일이 같은 메시지에 붙었다", linked.length === 2 && !!linked[0].messageId && linked[0].messageId === linked[1].messageId)
    const reuse = await call("post_message", { task: slug, content: "다시", files: [mdId] }, token)
    check("이미 다른 메시지에 붙은 파일은 isError", isErr(reuse) && text(reuse).includes("이미"), text(reuse))

    console.log("\n[7] 첨부 읽기")
    const withIds = await call("get_task", { task: slug }, token)
    check("get_task 첨부 목록에 파일 ID 가 보인다", text(withIds).includes(mdId), text(withIds).slice(0, 300))
    const readMd = await call("read_file", { file: mdId }, token)
    check("read_file 이 텍스트 본문을 준다", !isErr(readMd) && text(readMd).includes("한글 본문"), text(readMd))
    const byName = await call("read_file", { task: slug, name: "링크 검증" }, token)
    check("task + name 으로도 찾는다 (csv)", !isErr(byName) && text(byName).includes("1,2"), text(byName))
    const readPng = await call("read_file", { file: pngId }, token)
    const pngContent = (readPng.body.result as { content?: { type: string; mimeType?: string }[] })?.content ?? []
    check("이미지는 image content 로 온다", pngContent.some((c) => c.type === "image" && c.mimeType === "image/png"), JSON.stringify(pngContent).slice(0, 200))
    const pdfBytes = Buffer.from("%PDF-1.4\n%검증\n")
    const pdf = await call("upload_file", { name: "__검증__.pdf", content_base64: pdfBytes.toString("base64") }, token)
    const pdfId = fileIdOf(text(pdf))
    if (pdfId) uploadedIds.push(pdfId)
    const readPdf = await call("read_file", { file: pdfId }, token)
    const dl = text(readPdf).match(/https?:\/\/\S+\/download\?t=[^\s'"]+/)?.[0] ?? ""
    check("풀지 못하는 형식은 내려받기 링크를 준다", !isErr(readPdf) && Boolean(dl), text(readPdf))
    const got = dl ? await fetch(dl) : null
    const gotBytes = got ? Buffer.from(await got.arrayBuffer()) : Buffer.alloc(0)
    check("링크로 받은 바이트가 올린 것과 같다", got?.status === 200 && gotBytes.equals(pdfBytes), `${got?.status} ${gotBytes.length}`)
    const dlAsUpload = await fetch(url.replace("/upload?", "/download?"))
    check("업로드 링크로는 내려받을 수 없다", dlAsUpload.status === 401, String(dlAsUpload.status))
    const badDl = await fetch(dl.replace(/(t=[^.]+\.)(.)/, (_, head: string, c: string) => head + (c === "A" ? "B" : "A")))
    check("서명이 틀린 내려받기 링크는 401", badDl.status === 401, String(badDl.status))
    const ghostRead = await call("read_file", { file: "00000000-0000-0000-0000-000000000000" }, token)
    check("없는 파일 read_file 은 isError", isErr(ghostRead))
    const noRef = await call("read_file", {}, token)
    check("file 도 task 도 없으면 isError", isErr(noRef))

    console.log("\n[8] 업무 수정 · 체크리스트")
    const badStatus = await call("update_task", { task: slug, status: "FINISHED" }, token)
    check("모르는 상태는 isError", isErr(badStatus), text(badStatus))
    const badProject = await call("update_task", { task: slug, project: "__없는_프로젝트__" }, token)
    check("없는 프로젝트는 isError", isErr(badProject), text(badProject))
    const badDeadline = await call("update_task", { task: slug, deadline: "내일" }, token)
    check("날짜가 아닌 마감은 isError", isErr(badDeadline), text(badDeadline))
    const nothing = await call("update_task", { task: slug }, token)
    check("바꿀 필드가 없으면 isError", isErr(nothing), text(nothing))
    const upd = await call("update_task", { task: slug, status: "IN_PROGRESS", priority: "HIGH", deadline: "2099-06-30", expected_result: "검증 결과" }, token)
    const t2 = await prisma.task.findUnique({ where: { slug }, select: { status: true, priority: true, deadline: true, expectedResult: true, workStart: true } })
    check("update_task 가 준 필드만 바꾼다", !isErr(upd) && t2?.status === "IN_PROGRESS" && t2?.priority === "HIGH" && t2?.expectedResult === "검증 결과" && !!t2?.workStart, `${text(upd)} ${JSON.stringify(t2)}`)
    check("마감이 KST 로 들어갔다", t2?.deadline?.toISOString() === "2099-06-30T14:59:59.000Z", t2?.deadline?.toISOString())
    const clear = await call("update_task", { task: slug, deadline: "" }, token)
    check("빈 마감은 지운다", !isErr(clear) && (await prisma.task.findUnique({ where: { slug }, select: { deadline: true } }))?.deadline === null)
    check("활동 기록이 남는다 (화면과 같은 길)", (await prisma.activityLog.count({ where: { userId: user.id, action: "task.updated", entityId: createdTaskId ?? "" } })) >= 2)

    // Gemini 가 살아 있으면 앞의 post_message 가 체크리스트를 재구성해 둔다. 알려진 상태에서 시작한다.
    await prisma.checklist.deleteMany({ where: { taskId: createdTaskId ?? "" } })
    for (const name of ["첫째", "둘째"]) await prisma.checklist.create({ data: { taskId: createdTaskId ?? "", name } })
    const ghostItem = await call("update_checklist", { task: slug, check: ["__없는항목__"] }, token)
    check("없는 항목은 isError 이고 아무것도 안 바뀐다", isErr(ghostItem) && (await prisma.checklist.count({ where: { taskId: createdTaskId ?? "", done: true } })) === 0, text(ghostItem))
    const outOfRange = await call("update_checklist", { task: slug, check: ["9"] }, token)
    check("범위 밖 번호는 isError", isErr(outOfRange), text(outOfRange))
    const cl = await call("update_checklist", { task: slug, add: ["셋째", "넷째"], check: ["1", "셋째"], remove: ["둘째"] }, token)
    const items = await prisma.checklist.findMany({ where: { taskId: createdTaskId ?? "" }, orderBy: { createdAt: "asc" }, select: { name: true, done: true } })
    check("remove → add → check 순서로 반영된다", !isErr(cl) && JSON.stringify(items.map((i) => [i.name, i.done])) === JSON.stringify([["첫째", true], ["셋째", true], ["넷째", false]]), `${text(cl)} ${JSON.stringify(items)}`)
    const un = await call("update_checklist", { task: slug, uncheck: ["첫째"] }, token)
    check("uncheck 가 체크를 푼다", !isErr(un) && (await prisma.checklist.findFirst({ where: { taskId: createdTaskId ?? "", name: "첫째" } }))?.done === false, text(un))

    console.log("\n[9] 알림 · 응답")
    const foreign = await prisma.user.findFirst({ where: { isActive: true, id: { not: user.id }, role: "MEMBER" }, select: { id: true } })
      ?? await prisma.user.findFirst({ where: { isActive: true, id: { not: user.id } }, select: { id: true } })
    const theirs = foreign ? await prisma.notification.create({ data: { userId: foreign.id, type: "task_done_confirm", title: "검증", content: "검증", entityId: createdTaskId, actionType: "confirm_done" } }) : null
    // Gemini 가 살아 있으면 앞의 post_message 가 이미 완료 확인을 물었을 수 있다 — 떠 있는 것을 쓴다(한 업무에 하나만 뜬다).
    const mine = (await prisma.notification.findFirst({ where: { userId: user.id, entityId: createdTaskId, actionType: "confirm_done", resolvedAt: null } }))
      ?? await prisma.notification.create({ data: { userId: user.id, type: "task_done_confirm", title: `완료 확인: __MCP 검증용 업무__`, content: "검증용", entityId: createdTaskId, actionType: "confirm_done" } })
    const list = await call("list_notifications", {}, token)
    check("list_notifications 가 응답 대기 알림을 ID 와 함께 준다", !isErr(list) && text(list).includes(mine.id) && text(list).includes("완료 확인"), text(list).slice(0, 300))
    check("남의 알림은 목록에 없다", !theirs || !text(list).includes(theirs.id))
    if (theirs) {
      const steal = await call("respond_notification", { notification: theirs.id, response: "confirm_done" }, token)
      check("남의 알림에 응답하면 isError", isErr(steal), text(steal))
    }
    const wrong = await call("respond_notification", { notification: mine.id, response: "accept" }, token)
    check("완료 확인에 accept 는 isError", isErr(wrong), text(wrong))
    const noTarget = await call("respond_notification", { response: "defer" }, token)
    check("notification 도 task 도 없으면 isError", isErr(noTarget))
    const done = await call("respond_notification", { task: slug, response: "confirm_done" }, token)
    const t3 = await prisma.task.findUnique({ where: { slug }, include: { checklists: true } })
    check("confirm_done 이 업무를 완료하고 체크리스트를 모두 체크한다", !isErr(done) && t3?.status === "DONE" && t3.checklists.every((c) => c.done), `${text(done)} ${t3?.status}`)
    const again = await call("respond_notification", { notification: mine.id, response: "confirm_done" }, token)
    check("이미 응답한 알림은 부수효과 없이 그렇다고 말한다", !isErr(again) && text(again).includes("이미"), text(again))

    console.log("\n[10] 시스템 계정은 사람이 아니다")
    const members2 = await call("list_members", { includeInactive: true }, token)
    check("list_members(과거 구성원 포함)에 시스템 계정이 없다", !isErr(members2) && !/^- Omnis\b/m.test(text(members2)), text(members2).slice(0, 200))
    const sysAssignee = await call("create_task", { name: "x", assignees: ["Omnis"] }, token)
    check("시스템 계정을 담당자로 지정하면 isError", isErr(sysAssignee), text(sysAssignee))

    console.log("\n[11] 주간보고 · 지식 카드 쓰기 · 채팅")
    const emptyEdit = await call("write_weekly_report", { report: "00000000-0000-0000-0000-000000000000" }, token)
    check("report 만 주고 내용이 없으면 isError", isErr(emptyEdit), text(emptyEdit))
    const foreignReport = await call("write_weekly_report", { report: "00000000-0000-0000-0000-000000000000", markdown: "x" }, token)
    check("남의(없는) 보고서 수정은 isError", isErr(foreignReport) && text(foreignReport).includes("list_weekly_reports"), text(foreignReport))

    const made = await call("write_weekly_report", {}, token)
    const reportId = text(made).match(/ID ([0-9a-f-]{36})/)?.[1] ?? ""
    check("write_weekly_report 가 이번 주 보고서를 만든다", !isErr(made) && Boolean(reportId), text(made).slice(0, 160))
    const written = await call("write_weekly_report", { markdown: "## 이번 주\n- 검증용 본문", submit: true }, token)
    check("본문·제출이 반영된다", !isErr(written) && text(written).includes("제출 완료"), text(written).slice(0, 160))
    const saved = await prisma.weeklyReport.findUnique({ where: { id: reportId } })
    check("DB 에 본문과 제출 시각이 남는다", ((saved?.content as { markdown?: string })?.markdown ?? "").includes("검증용 본문") && !!saved?.submittedAt)
    const listed = await call("list_weekly_reports", {}, token)
    check("list_weekly_reports 가 주차·상태·본문을 준다", !isErr(listed) && text(listed).includes(reportId) && text(listed).includes("검증용 본문"), text(listed).slice(0, 200))

    const noCat = await call("write_omnis_card", { title: "__검증 카드__" }, token)
    check("분류 없는 새 카드는 isError", isErr(noCat), text(noCat))
    const badCat = await call("write_omnis_card", { title: "x", category: "__없는분류__", markdown: "x" }, token)
    check("없는 분류는 isError", isErr(badCat), text(badCat))
    const someCat = await prisma.omnisCategory.findFirst({ select: { name: true } })
    if (someCat) {
      const card = await call("write_omnis_card", { title: "__MCP 검증 카드__", category: someCat.name, markdown: "첫 줄", tags: ["검증"] }, token)
      createdCardId = text(card).match(/ID ([0-9a-f-]{36})/)?.[1] ?? null
      check("write_omnis_card 가 카드를 만든다", !isErr(card) && Boolean(createdCardId), text(card))
      const appended = await call("write_omnis_card", { card: createdCardId ?? "", markdown: "둘째 줄", append: true }, token)
      check("append 가 본문 뒤에 붙인다", !isErr(appended) && text(appended).includes("v2"), text(appended))
      const row = createdCardId ? await prisma.omnisCard.findUnique({ where: { id: createdCardId }, include: { versions: true } }) : null
      const body = ((row?.content as { sections?: { type: string; body?: string }[] })?.sections ?? []).find((sec) => sec.type === "text")?.body ?? ""
      check("본문·태그·버전 기록이 화면과 같게 남는다", body.includes("첫 줄") && body.includes("둘째 줄") && (row?.tags ?? []).includes("검증") && (row?.versions.length ?? 0) === 2, body.slice(0, 80))
      const ghostCard = await call("write_omnis_card", { card: "__없는카드__", markdown: "x" }, token)
      check("없는 카드를 고치면 isError", isErr(ghostCard), text(ghostCard))
    }

    const badView = await call("list_chat", { view: "inbox" }, token)
    check("모르는 view 는 isError", isErr(badView), text(badView))
    const dmNoUser = await call("list_chat", { view: "dm" }, token)
    check("view=dm 에 상대가 없으면 isError", isErr(dmNoUser), text(dmNoUser))
    const taskGhost = await call("list_chat", { view: "task", task: "__없는_업무__" }, token)
    check("view=task 에 없는 업무는 isError", isErr(taskGhost))
    const feed = await call("list_chat", { limit: 5 }, token)
    check("list_chat 이 최근 글을 시간순으로 준다", !isErr(feed) && /^\[\d{4}-\d{2}-\d{2}/m.test(text(feed)), text(feed).slice(0, 160))
    const taskFeed = await call("list_chat", { view: "task", task: slug, limit: 20 }, token)
    check("view=task 가 그 업무의 글만 준다", !isErr(taskFeed) && text(taskFeed).includes(`#${slug}`), text(taskFeed).slice(0, 160))
  } finally {
    // ─── 정리 ───
    // 파일이 메시지·업무를 FK 로 물고 있어 먼저 지운다. NAS 실물도 함께.
    for (const f of await prisma.file.findMany({ where: { id: { in: uploadedIds } }, select: { id: true, name: true } })) {
      await deleteObject(objectKeyFor(f.id, f.name)).catch((e) => console.log(`  (NAS 정리 실패 ${f.name}: ${e})`))
    }
    await prisma.file.deleteMany({ where: { id: { in: uploadedIds } } })
    if (createdCardId) {
      await prisma.omnisCardVersion.deleteMany({ where: { cardId: createdCardId } })
      await prisma.embeddingChunk.deleteMany({ where: { source: "OMNIS_CARD", sourceId: createdCardId } })
      await prisma.omnisCard.delete({ where: { id: createdCardId } }).catch(() => {})
    }
    for (const r of await prisma.weeklyReport.findMany({ where: { ownerId: user.id }, select: { id: true } })) {
      await prisma.embeddingChunk.deleteMany({ where: { source: "WEEKLY_REPORT", sourceId: r.id } })
    }
    await prisma.weeklyReport.deleteMany({ where: { ownerId: user.id } })
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
