// 작업용 컴퓨터 작업 1건의 순서 — 열기 · 진행 가져오기 · 끝내기 · 계속 · 멈춤.
// 바깥(Anthropic API · DB · 채팅방 · 파일 저장)은 전부 주입한다: 운영은 store.ts · api.ts, 시험과 로컬 시범은 가짜 · 메모리.
// Workflow(workflow.ts)는 이 함수들을 단계로 부른다 — 인자는 작업 ID 뿐이라 비밀값이 Workflow 기록에 남지 않는다.
import { budgetCents, sessionCost, type SessionUsageLike, type WorkbenchCost } from "./pricing"
import { compactLines, idleOutcome, progressLine, type EventLike, type IdleOutcome } from "./progress"

export type JobStatus = "QUEUED" | "RUNNING" | "NEEDS_BUDGET" | "DONE" | "FAILED" | "CANCELLED"

export interface Job {
  id: string
  userId: string
  roomId: string
  request: string
  model: string
  status: JobStatus
  budgetKrw: number
  sessionId: string | null
  vaultId: string | null
  tokenId: string | null
  /** 마지막으로 본 이벤트의 processed_at — 다음에는 그 뒤만 가져온다 */
  cursor: string | null
  /** 에이전트의 마지막 답(끝날 때 채팅방에 그대로) */
  lastMessage: string | null
  startedAt: Date | null
  costKrw: number
}

export interface OutputFile {
  id: string
  filename: string
  size: number
}

/** Anthropic Managed Agents 중 이 기능이 쓰는 것 — 운영 구현은 api.ts */
export interface WorkbenchApi {
  createVault(displayName: string): Promise<{ id: string }>
  addBearer(vaultId: string, mcpUrl: string, token: string): Promise<void>
  deleteVault(vaultId: string): Promise<void>
  createSession(p: { agentId: string; environmentId: string; vaultIds: string[]; budgetCents: string; title: string; text: string }): Promise<{ id: string }>
  listEvents(sessionId: string, afterProcessedAt: string | null): Promise<EventLike[]>
  getSession(sessionId: string): Promise<{ status: string; usage: SessionUsageLike | null }>
  setBudget(sessionId: string, cents: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  listOutputs(sessionId: string): Promise<OutputFile[]>
  download(fileId: string): Promise<Buffer>
  deleteSession(sessionId: string): Promise<void>
}

/** 옴니스 쪽 — 운영 구현은 store.ts(prisma · NAS · 채팅방) */
export interface JobStore {
  get(jobId: string): Promise<Job>
  patch(jobId: string, data: Partial<Job> & { error?: string; finishedAt?: Date; cost?: WorkbenchCost; outputFileIds?: string[] }): Promise<void>
  /** 채팅방에 옴니스 글 한 개(여러 줄이면 한 글로) */
  post(job: Job, text: string): Promise<void>
  /** 결과 파일 하나를 옴니스 File 로 받아 채팅방 글에 붙인다 */
  saveOutput(job: Job, file: { name: string; bytes: Buffer }): Promise<{ ok: true; fileId: string } | { ok: false; reason: string }>
  recordUsage(job: Job, cost: WorkbenchCost): Promise<void>
  /** 요청자 권한의 단기 MCP 토큰 — 원문은 vault 로만 간다 */
  mintToken(job: Job): Promise<{ token: string; tokenId: string }>
  revokeToken(tokenId: string): Promise<void>
}

export interface RunnerDeps {
  api: WorkbenchApi
  store: JobStore
  agentId: string
  environmentId: string
  mcpUrl: string | null
  krwPerUsd: number
  maxMinutes: number
  now?: () => Date
  wait?: (ms: number) => Promise<void>
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`
const MAX_OUTPUT_FILES = 20

export async function openJob(jobId: string, d: RunnerDeps): Promise<{ ok: boolean }> {
  const job = await d.store.get(jobId)
  if (job.status !== "QUEUED") return { ok: job.status === "RUNNING" }
  let tokenId: string | null = null
  let vaultId: string | null = null
  try {
    const vaultIds: string[] = []
    if (d.mcpUrl) {
      const t = await d.store.mintToken(job)
      tokenId = t.tokenId
      const v = await d.api.createVault(`omnis-workbench ${job.id}`)
      vaultId = v.id
      await d.api.addBearer(v.id, d.mcpUrl, t.token)
      vaultIds.push(v.id)
    }
    const s = await d.api.createSession({
      agentId: d.agentId,
      environmentId: d.environmentId,
      vaultIds,
      budgetCents: budgetCents(job.budgetKrw, d.krwPerUsd),
      title: `omnis ${job.id}`,
      text: job.request,
    })
    await d.store.patch(job.id, { status: "RUNNING", sessionId: s.id, vaultId, tokenId, startedAt: (d.now ?? (() => new Date()))() })
    await d.store.post(job, `🖥 작업용 컴퓨터를 켰습니다. 상한 ${won(job.budgetKrw)} · 진행을 여기에 한 줄씩 남깁니다.`)
    return { ok: true }
  } catch (e) {
    // 반쯤 만든 것을 치운다 — 토큰 · vault 가 남지 않게
    if (vaultId) await d.api.deleteVault(vaultId).catch(() => {})
    if (tokenId) await d.store.revokeToken(tokenId).catch(() => {})
    const reason = e instanceof Error ? e.message : String(e)
    await d.store.patch(job.id, { status: "FAILED", error: reason.slice(0, 1000), finishedAt: new Date() })
    await d.store.post(job, `⚠︎ 작업용 컴퓨터를 켜지 못했습니다: ${reason.slice(0, 200)}`)
    return { ok: false }
  }
}

export type PumpState = { state: "running" } | { state: "idle"; outcome: IdleOutcome } | { state: "timeout" }

/** 새 이벤트를 가져와 진행 한 줄로 남기고, 세션이 멈췄는지 본다 */
export async function pumpJob(jobId: string, d: RunnerDeps): Promise<PumpState> {
  const job = await d.store.get(jobId)
  if (!job.sessionId || job.status !== "RUNNING") return { state: "idle", outcome: "failed" }
  const events = await d.api.listEvents(job.sessionId, job.cursor)
  const lines: string[] = []
  let lastMessage = job.lastMessage
  let idle: string | undefined
  let cursor = job.cursor
  for (const e of events) {
    const l = progressLine(e)
    if (l) lines.push(l)
    if (e.type === "agent.message") {
      const t = (e.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim()
      if (t) lastMessage = t
    }
    if (e.type === "session.status_idle") idle = e.stop_reason?.type
    if (e.type === "session.status_running") idle = undefined
    if (e.processed_at) cursor = e.processed_at
  }
  const c = compactLines(lines)
  if (c.lines.length) await d.store.post(job, c.lines.join("\n") + (c.dropped ? `\n… 그 밖에 ${c.dropped}줄` : ""))
  await d.store.patch(job.id, { cursor, lastMessage })

  // 이벤트에 idle 이 없어도 세션 상태가 기준이다(이벤트를 놓쳤을 때)
  const s = await d.api.getSession(job.sessionId)
  if (s.status === "terminated") return { state: "idle", outcome: "failed" }
  if (s.status === "idle" && idle) return { state: "idle", outcome: idleOutcome(idle) }
  const now = (d.now ?? (() => new Date()))()
  if (job.startedAt && now.getTime() - job.startedAt.getTime() > d.maxMinutes * 60_000) return { state: "timeout" }
  return { state: "running" }
}

/** 끝 — 결과 파일 받기 · 비용 기록 · 세션 · vault · 토큰 치우기. 상한에 닿았으면 세션을 남기고 「계속할까요」 를 묻는다 */
export async function finishJob(jobId: string, how: IdleOutcome | "timeout" | "cancelled", d: RunnerDeps): Promise<JobStatus> {
  const job = await d.store.get(jobId)
  if (!job.sessionId) return job.status

  if (how === "needs_budget") {
    const s = await d.api.getSession(job.sessionId)
    const cost = sessionCost(job.model, s.usage, d.krwPerUsd)
    await d.store.patch(job.id, { status: "NEEDS_BUDGET", cost })
    await d.store.post(
      job,
      `⏸ 작업 1건 상한(${won(job.budgetKrw)})에 닿아 멈췄습니다. 지금까지 ${won(cost.krw)}. ` +
        `이어서 하려면 「작업 계속」, 그만두려면 「작업 멈춰」 라고 말해 주세요 — 확인 카드가 뜹니다.`
    )
    return "NEEDS_BUDGET"
  }
  if (how === "timeout" || how === "cancelled") await d.api.interrupt(job.sessionId).catch(() => {})

  // 결과 파일 — 목록에 뜨기까지 1~3초 걸린다(문서). 두 번 더 본다
  const wait = d.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let outputs: OutputFile[] = []
  for (let i = 0; i < 3; i++) {
    outputs = await d.api.listOutputs(job.sessionId).catch(() => [])
    if (outputs.length || how !== "done") break
    await wait(2000)
  }
  const saved: string[] = []
  const problems: string[] = []
  for (const f of outputs.slice(0, MAX_OUTPUT_FILES)) {
    const bytes = await d.api.download(f.id)
    const r = await d.store.saveOutput(job, { name: f.filename, bytes })
    if (r.ok) saved.push(r.fileId)
    else problems.push(`${f.filename}: ${r.reason}`)
  }
  if (outputs.length > MAX_OUTPUT_FILES) problems.push(`파일이 ${outputs.length}개라 앞 ${MAX_OUTPUT_FILES}개만 받았습니다`)

  const s = await d.api.getSession(job.sessionId)
  const cost = sessionCost(job.model, s.usage, d.krwPerUsd)
  await d.store.recordUsage(job, cost)

  // 치우기 — 세션 기록을 남기지 않는 것이 기본(결정 4번). 실패해도 끝까지 간다
  await d.api.deleteSession(job.sessionId).catch(() => {})
  if (job.vaultId) await d.api.deleteVault(job.vaultId).catch(() => {})
  if (job.tokenId) await d.store.revokeToken(job.tokenId).catch(() => {})

  const status: JobStatus = how === "done" ? "DONE" : how === "cancelled" ? "CANCELLED" : "FAILED"
  const head =
    status === "DONE" ? "✅ 작업을 마쳤습니다." : status === "CANCELLED" ? "⏹ 작업을 멈췄습니다." : how === "timeout" ? "⚠︎ 시간이 너무 걸려 멈췄습니다." : "⚠︎ 작업이 끝나지 못했습니다."
  const body = [
    head,
    job.lastMessage ? `\n${job.lastMessage.slice(0, 3000)}` : "",
    `\n파일 ${saved.length}개 · 비용 ${won(cost.krw)} (입력 ${cost.inputTokens + cost.cacheWriteTokens + cost.cacheReadTokens} · 출력 ${cost.outputTokens} 토큰 · 실행 ${Math.round(cost.activeSeconds)}초)`,
    ...problems.map((p) => `- 받지 못함: ${p}`),
  ].join("")
  await d.store.post(job, body)
  await d.store.patch(job.id, { status, cost, outputFileIds: saved, finishedAt: new Date(), sessionId: null, vaultId: null, tokenId: null })
  return status
}

/** 「계속」 카드 — 지금까지 쓴 것 위에 상한을 한 번 더 */
export async function continueJob(jobId: string, addKrw: number, d: RunnerDeps): Promise<{ ok: boolean; text: string }> {
  const job = await d.store.get(jobId)
  if (job.status !== "NEEDS_BUDGET" || !job.sessionId) return { ok: false, text: "멈춘 작업이 아닙니다" }
  const s = await d.api.getSession(job.sessionId)
  const spent = sessionCost(job.model, s.usage, d.krwPerUsd).krw
  const next = spent + addKrw
  await d.api.setBudget(job.sessionId, budgetCents(next, d.krwPerUsd))
  await d.store.patch(job.id, { status: "RUNNING", budgetKrw: next })
  await d.store.post(job, `▶︎ 이어서 합니다. 상한 ${won(next)}`)
  return { ok: true, text: `작업을 이어 갑니다(상한 ${won(next)})` }
}
