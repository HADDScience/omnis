/** 작업용 컴퓨터 — 가짜 API 응답으로 순서 · 비용 · 한도 · 진행 줄 · MCP 범위를 본다. 실제 호출 없음. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { budgetCents, estimateKrw, sessionCost } from "./pricing"
import { compactLines, idleOutcome, progressLine } from "./progress"
import { continueJob, finishJob, openJob, pumpJob, type Job, type JobStore, type WorkbenchApi } from "./runner"
import { workbenchConfig, workbenchEnabledFor } from "./config"
import { grantBudget } from "./service"
import { WORKBENCH_MCP_TOOLS, agentParams, environmentParams } from "./definitions"
import { COMPANY_GUIDELINES } from "./guidelines"
import { toolPolicy } from "../tools/registry"

const KRW = 1468.8

// ─── 비용 ───

test("비용 — Sonnet 5.5 표 계산(입력 $2 · 캐시 쓰기 5분 1.25배 · 읽기 $0.10 · 출력 $10) + 세션 $0.08/시간", () => {
  const c = sessionCost(
    "claude-sonnet-5-5",
    { input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 10_000, ephemeral_1h_input_tokens: 0 }, cache_read_input_tokens: 100_000, output_tokens: 2_000, active_seconds: 600, list_cost: { amount: "0", currency: "USD" } },
    KRW
  )
  const usd = (1000 * 2 + 10_000 * 2.5 + 100_000 * 0.1 + 2_000 * 10) / 1e6 + (600 / 3600) * 0.08
  assert.equal(c.source, "table")
  assert.ok(Math.abs(c.usd - usd) < 1e-6)
  assert.equal(c.krw, Math.round(usd * KRW))
  assert.equal(c.cacheWriteTokens, 10_000)
})

test("비용 — Anthropic 의 list_cost 가 있으면 그것(센트)을 쓴다", () => {
  const c = sessionCost("claude-sonnet-5-5", { input_tokens: 5, output_tokens: 5, list_cost: { amount: "123", currency: "USD" } }, KRW)
  assert.equal(c.source, "list_cost")
  assert.equal(c.usd, 1.23)
})

test("세션 예산 — 원을 센트 정수 문자열로(내림), 3,000원 ≈ $2.04", () => {
  assert.equal(budgetCents(3000, KRW), "204")
  assert.equal(budgetCents(0, KRW), "1")
  assert.match(budgetCents(1234.5, KRW), /^\d+$/)
})

test("예상 비용 — 계획 v3 표, Opus 는 2배", () => {
  assert.equal(estimateKrw("standard", "claude-sonnet-5-5"), 1130)
  assert.equal(estimateKrw("standard", "claude-opus-5-5"), 2260)
})

// ─── 한도 ───

test("한도 — 1건 상한 · 개인 · 회사 남은 것 중 가장 작은 것, 400원 아래면 시작하지 않는다", () => {
  const c = { taskLimitKrw: 3000, userMonthlyKrw: 30000, companyMonthlyKrw: 30000 }
  assert.deepEqual(grantBudget(c, { userKrw: 0, companyKrw: 0 }), { ok: true, budgetKrw: 3000 })
  assert.deepEqual(grantBudget(c, { userKrw: 28000, companyKrw: 28000 }), { ok: true, budgetKrw: 2000 })
  const r = grantBudget(c, { userKrw: 1000, companyKrw: 29800 })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /회사 한도/)
})

test("스위치 — 사람 · 키 · 에이전트 · 환경이 다 있어야 켜진다", () => {
  const env = { WORKBENCH_USER_IDS: "u1, u2", WORKBENCH_ANTHROPIC_API_KEY: "k", WORKBENCH_AGENT_ID: "agent_1", WORKBENCH_ENVIRONMENT_ID: "env_1" }
  assert.equal(workbenchEnabledFor("u1", workbenchConfig(env)), true)
  assert.equal(workbenchEnabledFor("u3", workbenchConfig(env)), false)
  assert.equal(workbenchEnabledFor("u1", workbenchConfig({ ...env, WORKBENCH_AGENT_ID: "" })), false)
  assert.equal(workbenchEnabledFor("u1", workbenchConfig({})), false)
  assert.equal(workbenchConfig({}).model, "claude-sonnet-5-5")
  assert.equal(workbenchConfig({ PUBLIC_URL: "https://x.example/" }).mcpUrl, "https://x.example/api/ip-mcp")
})

// ─── 진행 줄 ───

test("진행 줄 — 명령 · 파일 · 옴니스 조회 · 답 · 오류, 생각은 보이지 않는다", () => {
  assert.equal(progressLine({ type: "agent.tool_use", name: "bash", input: { command: "soffice --headless --convert-to pdf k.pptx" } }), "⚙︎ 명령: soffice --headless --convert-to pdf k.pptx")
  assert.equal(progressLine({ type: "agent.tool_use", name: "write", input: { file_path: "/mnt/session/outputs/a.pdf" } }), "✎ 파일 쓰기: outputs/a.pdf")
  assert.equal(progressLine({ type: "agent.mcp_tool_use", name: "list_tasks" }), "🔎 옴니스 조회: list_tasks")
  assert.equal(progressLine({ type: "agent.thinking" }), null)
  assert.match(progressLine({ type: "session.error", error: { message: "Package installation failed" } })!, /오류/)
  assert.equal(progressLine({ type: "session.status_idle", stop_reason: { type: "budget_reached" } }), "⏸ 작업 1건 상한에 닿아 멈췄습니다")
})

test("진행 줄 — 같은 줄 연속은 하나로, 넘치면 처음 몇 줄 + 마지막 줄", () => {
  assert.deepEqual(compactLines(["a", "a", "b"]), { lines: ["a", "b"], dropped: 0 })
  const many = Array.from({ length: 20 }, (_, i) => `l${i}`)
  const c = compactLines(many, 5)
  assert.deepEqual(c.lines, ["l0", "l1", "l2", "l3", "l19"])
  assert.equal(c.dropped, 15)
  assert.equal(idleOutcome("end_turn"), "done")
  assert.equal(idleOutcome("budget_reached"), "needs_budget")
  assert.equal(idleOutcome("retries_exhausted"), "failed")
})

// ─── 정의 ───

test("환경 — limited 네트워크(패키지 저장소 · MCP 만), 한글 글꼴 · HWPX 도구, pyhwp 는 넣지 않는다", () => {
  const p = environmentParams()
  const cfg = p.config as { type: string; networking: Record<string, unknown>; packages: { apt: string[]; pip: string[] } }
  assert.equal(cfg.networking.type, "limited")
  assert.equal(cfg.networking.allow_package_managers, true)
  assert.equal(cfg.networking.allow_mcp_servers, true)
  assert.equal("allowed_hosts" in cfg.networking, false)
  assert.ok(cfg.packages.apt.includes("fonts-nanum-extra"), "NanumSquare 는 fonts-nanum-extra 에 있다(2026-11-26 실측)")
  assert.ok(!cfg.packages.pip.includes("pyhwp"))
})

test("에이전트 — 웹 도구 끔, 옴니스 MCP 는 허용 목록만(기본 꺼짐), 공용 지침이 system", () => {
  const a = agentParams({ model: "claude-sonnet-5-5", mcpUrl: "https://o.example/api/ip-mcp" }) as unknown as {
    system: string; mcp_servers: { url: string }[]; tools: Array<{ type: string; default_config?: { enabled: boolean }; configs?: { name: string; enabled: boolean }[] }>
  }
  assert.equal(a.system, COMPANY_GUIDELINES)
  assert.equal(a.mcp_servers[0].url, "https://o.example/api/ip-mcp")
  const kit = a.tools.find((t) => t.type === "agent_toolset_20260401")!
  assert.deepEqual(kit.configs!.filter((c) => !c.enabled).map((c) => c.name).sort(), ["web_fetch", "web_search"])
  const mcp = a.tools.find((t) => t.type === "mcp_toolset")!
  assert.equal(mcp.default_config!.enabled, false)
  assert.deepEqual(mcp.configs!.map((c) => c.name), [...WORKBENCH_MCP_TOOLS])
  const local = agentParams({ model: "claude-sonnet-5-5", mcpUrl: null }) as unknown as { mcp_servers?: unknown; tools: { type: string }[] }
  assert.equal(local.mcp_servers, undefined)
  assert.ok(!local.tools.some((t) => t.type === "mcp_toolset"))
})

test("MCP 허용 목록 — 모두 읽기, 1:1 방 · 개인 기록 · 채용 · 쓰기 · ask_omnis 는 없다", () => {
  assert.ok(WORKBENCH_MCP_TOOLS.length > 10)
  for (const n of WORKBENCH_MCP_TOOLS) {
    assert.equal(toolPolicy(n)?.agent, "read", n)
    assert.equal(toolPolicy(n)?.mcp, true, n)
  }
  for (const n of ["list_chat", "list_rooms", "list_room_files", "list_files", "list_my_questions", "list_applications", "get_interview_pack", "ask_omnis", "post_message", "create_task", "record_sample"]) {
    assert.ok(!WORKBENCH_MCP_TOOLS.includes(n), n)
  }
})

test("공용 지침 — 발송 · 쓰기 금지, 지어내지 않기, 덮어쓰기 금지, 번역투 금지가 들어 있고 개인 내용은 없다", () => {
  for (const s of ["발송", "지어내지 않기", "덮어쓰지 않는다", "번역투", "requests.md", "NanumSquare"]) assert.ok(COMPANY_GUIDELINES.includes(s), s)
  for (const s of ["진로", "체중", "청약", "정우창"]) assert.ok(!COMPANY_GUIDELINES.includes(s), s)
})

// ─── 순서(가짜 API · 메모리 저장소) ───

function fakes(opts: { idleReason?: string; outputs?: number; failSession?: boolean } = {}) {
  const calls: string[] = []
  const posts: string[] = []
  const saved: string[] = []
  const jobs = new Map<string, Job>()
  let sessionStatus = "running"
  let eventsQueue: Record<string, unknown>[] = [
    { type: "session.status_running", processed_at: "2026-11-26T00:00:01Z" },
    { type: "agent.tool_use", name: "bash", input: { command: "python3 make.py" }, processed_at: "2026-11-26T00:00:02Z" },
    { type: "agent.message", content: [{ type: "text", text: "PDF 를 만들었습니다. 3쪽." }], processed_at: "2026-11-26T00:00:03Z" },
  ]
  const api: WorkbenchApi = {
    async createVault() { calls.push("createVault"); return { id: "vlt_1" } },
    async addBearer(_v, url, token) { calls.push(`addBearer ${url} ${token.length}`) },
    async deleteVault(v) { calls.push(`deleteVault ${v}`) },
    async createSession(p) {
      calls.push(`createSession budget=${p.budgetCents} vaults=${p.vaultIds.join(",")}`)
      if (opts.failSession) throw new Error("400 blocked host")
      return { id: "sesn_1" }
    },
    async listEvents(_s, after) {
      calls.push(`listEvents after=${after}`)
      const out = eventsQueue
      eventsQueue = []
      return out as never
    },
    async getSession() { return { status: sessionStatus, usage: { input_tokens: 100, output_tokens: 1000, cache_read_input_tokens: 5000, active_seconds: 60 } } },
    async setBudget(_s, c) { calls.push(`setBudget ${c}`) },
    async interrupt() { calls.push("interrupt") },
    async listOutputs() { return Array.from({ length: opts.outputs ?? 1 }, (_, i) => ({ id: `file_${i}`, filename: `out${i}.pdf`, size: 10 })) },
    async download(id) { return Buffer.from(`pdf ${id}`) },
    async deleteSession(s) { calls.push(`deleteSession ${s}`) },
  }
  const store: JobStore = {
    async get(id) { return { ...jobs.get(id)! } },
    async patch(id, d) { const { cost, error, finishedAt, outputFileIds, ...rest } = d; void error; void finishedAt; void outputFileIds; jobs.set(id, { ...jobs.get(id)!, ...rest, ...(cost ? { costKrw: cost.krw } : {}) }) },
    async post(_j, t) { posts.push(t) },
    async saveOutput(_j, f) { saved.push(f.name); return { ok: true, fileId: `F-${f.name}` } },
    async recordUsage() { calls.push("recordUsage") },
    async mintToken() { calls.push("mintToken"); return { token: "secret-token-value", tokenId: "tok_1" } },
    async revokeToken(t) { calls.push(`revokeToken ${t}`) },
  }
  const job: Job = {
    id: "job1", userId: "u1", roomId: "r1", request: "PDF 만들어줘", model: "claude-sonnet-5-5", status: "QUEUED", budgetKrw: 3000,
    sessionId: null, vaultId: null, tokenId: null, cursor: null, lastMessage: null, startedAt: null, costKrw: 0,
  }
  jobs.set(job.id, job)
  const deps = {
    api, store, agentId: "agent_1", environmentId: "env_1", mcpUrl: "https://o.example/api/ip-mcp", krwPerUsd: KRW, maxMinutes: 60,
    wait: async () => {},
  }
  return {
    calls, posts, saved, jobs, deps,
    idle(reason = opts.idleReason ?? "end_turn") {
      sessionStatus = "idle"
      eventsQueue = [{ type: "session.status_idle", stop_reason: { type: reason }, processed_at: "2026-11-26T00:01:00Z" }]
    },
  }
}

test("열기 — 단기 토큰을 vault 로만 넘기고, 예산을 건 세션을 연다. 토큰 원문은 글 · 작업 기록에 없다", async () => {
  const f = fakes()
  assert.deepEqual(await openJob("job1", f.deps), { ok: true })
  assert.deepEqual(f.calls.slice(0, 4), ["mintToken", "createVault", "addBearer https://o.example/api/ip-mcp 18", "createSession budget=204 vaults=vlt_1"])
  const j = f.jobs.get("job1")!
  assert.equal(j.status, "RUNNING")
  assert.equal(j.sessionId, "sesn_1")
  assert.ok(!JSON.stringify([...f.jobs.values(), f.posts]).includes("secret-token-value"))
})

test("열기 실패 — vault 를 지우고 토큰을 폐기한 뒤 FAILED", async () => {
  const f = fakes({ failSession: true })
  assert.deepEqual(await openJob("job1", f.deps), { ok: false })
  assert.ok(f.calls.includes("deleteVault vlt_1"))
  assert.ok(f.calls.includes("revokeToken tok_1"))
  assert.equal(f.jobs.get("job1")!.status, "FAILED")
  assert.match(f.posts.at(-1)!, /켜지 못했습니다/)
})

test("진행 → 끝 — 진행 줄을 남기고, 결과 파일을 받고, 비용을 기록하고, 세션 · vault · 토큰을 치운다", async () => {
  const f = fakes()
  await openJob("job1", f.deps)
  assert.deepEqual(await pumpJob("job1", f.deps), { state: "running" })
  assert.match(f.posts.join("\n"), /⚙︎ 명령: python3 make.py/)
  assert.equal(f.jobs.get("job1")!.cursor, "2026-11-26T00:00:03Z")
  f.idle()
  const r = await pumpJob("job1", f.deps)
  assert.deepEqual(r, { state: "idle", outcome: "done" })
  assert.ok(f.calls.some((c) => c === "listEvents after=2026-11-26T00:00:03Z"), "다음에는 커서 뒤만 가져온다")
  const status = await finishJob("job1", "done", f.deps)
  assert.equal(status, "DONE")
  assert.deepEqual(f.saved, ["out0.pdf"])
  for (const c of ["recordUsage", "deleteSession sesn_1", "deleteVault vlt_1", "revokeToken tok_1"]) assert.ok(f.calls.includes(c), c)
  const last = f.posts.at(-1)!
  assert.match(last, /✅ 작업을 마쳤습니다/)
  assert.match(last, /PDF 를 만들었습니다/)
  assert.match(last, /파일 1개 · 비용/)
  assert.equal(f.jobs.get("job1")!.sessionId, null)
})

test("상한 — 세션을 남기고 NEEDS_BUDGET, 「계속」 이면 쓴 것 위에 상한을 더한다", async () => {
  const f = fakes({ idleReason: "budget_reached" })
  await openJob("job1", f.deps)
  f.idle()
  const r = await pumpJob("job1", f.deps)
  assert.deepEqual(r, { state: "idle", outcome: "needs_budget" })
  assert.equal(await finishJob("job1", "needs_budget", f.deps), "NEEDS_BUDGET")
  assert.ok(!f.calls.some((c) => c.startsWith("deleteSession")), "상한에서는 세션을 지우지 않는다")
  assert.match(f.posts.at(-1)!, /작업 계속/)
  const c = await continueJob("job1", 3000, f.deps)
  assert.equal(c.ok, true)
  const set = f.calls.find((x) => x.startsWith("setBudget"))!
  assert.ok(Number(set.split(" ")[1]) > 204, "쓴 것 + 3,000원")
  assert.equal(f.jobs.get("job1")!.status, "RUNNING")
})

test("시간 초과 · 멈춤 — interrupt 를 보내고 그때까지 만든 파일을 받는다", async () => {
  const f = fakes()
  await openJob("job1", f.deps)
  assert.equal(await finishJob("job1", "cancelled", f.deps), "CANCELLED")
  assert.ok(f.calls.includes("interrupt"))
  assert.deepEqual(f.saved, ["out0.pdf"])
  // 두 번째 끝내기는 아무것도 하지 않는다(세션이 이미 없다)
  const before = f.calls.length
  await finishJob("job1", "done", f.deps)
  assert.equal(f.calls.length, before)
})

test("결과 파일은 20개까지만 받는다", async () => {
  const f = fakes({ outputs: 25 })
  await openJob("job1", f.deps)
  await finishJob("job1", "done", f.deps)
  assert.equal(f.saved.length, 20)
  assert.match(f.posts.at(-1)!, /앞 20개만/)
})

// ─── MCP 범위 ───

test("MCP — 작업용 컴퓨터 토큰은 허용 목록 밖 도구를 거절하고, 목록에도 허용 목록만 보인다", async () => {
  const { runTool, toolsFor, TOOLS } = await import("../omnis-mcp")
  const caller = { userId: "u1", name: "시험", role: "MEMBER" as const, ip: null, scope: "workbench" as const }
  const r = await runTool("create_task", { title: "x" }, caller)
  assert.ok("error" in r && /읽기 도구만/.test(r.error))
  const names = toolsFor(caller).map((t) => t.name).sort()
  assert.deepEqual(names, [...WORKBENCH_MCP_TOOLS].sort())
  assert.equal(toolsFor({ ...caller, scope: undefined }).length, TOOLS.length)
})
