// 에이전트형 과제 벤치 — 모델 × 과제 × 반복을 한 줄씩 results.jsonl 에 쌓는다.
//
//   npx tsx bench/agent/run.ts --dry-run                                  # 돈 0원: 고정 스크립트로 루프·도구·채점·리포트 확인 + 비용 추산
//   npx tsx bench/agent/run.ts --models claude-haiku-5-5,gemini-3.8-flash --limit 2   # 모델별 2건 시험
//   npx tsx bench/agent/run.ts --models <…> --repeat 2                     # 전체
//   npx tsx bench/agent/run.ts --run agent-20261028-1500                   # 중단한 것 이어서
//   npx tsx bench/agent/run.ts --list                                      # 모델 · 키 · 과제 수
//
// 옵션: --tasks <파일> (기본 ~/work/omnis-import/eval/agent-tasks-261028.json, AGENT_BENCH_TASKS)
//       --only T01,T04 · --limit N · --repeat R · --max-turns 12 · --max-krw-per-task 1000
//       --budget-krw 35000 (모델+심판 누적이 넘으면 멈춘다) · --no-judge · --user 정우창 · --workdays 22
// 심판: AGENT_BENCH_JUDGE (기본 claude-sonnet-5-5). dry-run 은 심판을 부르지 않는다.
//
// DB 는 .env 의 DATABASE_URL 만 읽고, localhost 가 아니면 시작하지 않는다 — 운영 Neon 에 붙지 않게.
// (next start/build 는 .env.production.local 을 읽어 운영에 붙는다. 이 스크립트는 dotenv/config = .env 만)
import "dotenv/config"
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import { AGENT_MODELS, MODELS, KRW_PER_USD, usdToKrw, modelAvailable, type ModelSpec } from "../config"
import { createDriver, scriptedDriver, estTokens, type Driver, type ScriptStep } from "./drivers"
import { runAgentLoop } from "./loop"
import { AGENT_TOOLS, READ_TOOLS, WRITE_TOOLS, agentSystemPrompt } from "./tools"
import { gradeDeterministic, buildJudgePrompt, judge, judgeModel } from "./grade"
import { writeAgentReport } from "./report"
import type { AgentRow, AgentTask, TaskFile, JudgeGrade, ProposalSpec } from "./types"

const args = process.argv.slice(2)
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const flag = (k: string) => args.includes(k)

const DRY_PERFECT: ModelSpec = { key: "dry-perfect", provider: "openai-compat", id: "script:perfect", price: { input: 0, output: 0, note: "과제 파일의 정답 스크립트" } }
const DRY_NAIVE: ModelSpec = { key: "dry-naive", provider: "openai-compat", id: "script:naive", price: { input: 0, output: 0, note: "채점이 걸러내야 하는 나쁜 에이전트" } }

/** 정답 스크립트: 1턴 읽기 → 2턴 쓰기 제안 → 3턴 답 */
function perfectScript(t: AgentTask): ScriptStep[] {
  const steps: ScriptStep[] = t.dry.reads.length ? [{ calls: t.dry.reads.map(([name, a]) => ({ name, args: a })) }] : []
  if (t.dry.proposals?.length) steps.push({ calls: t.dry.proposals.map(([name, a]) => ({ name, args: a })) })
  steps.push({ text: t.dry.answer })
  return steps
}

/** 나쁜 에이전트: 대충 하나 읽고, 아무 데나 글을 올리고, 끝났다고 단정한다. 채점이 대부분 떨어뜨려야 한다 */
function naiveScript(): ScriptStep[] {
  return [
    { calls: [{ name: "list_tasks", args: { limit: 5 } }] },
    { calls: [{ name: "post_message", args: { content: "요청하신 건 처리했습니다." } }] },
    { text: "요청하신 작업을 완료했습니다." },
  ]
}

function validateTasks(file: TaskFile): void {
  const tools = new Set(AGENT_TOOLS.map((t) => t.name))
  const errs: string[] = []
  const checkSpec = (id: string, s: ProposalSpec) => {
    for (const n of Array.isArray(s.tool) ? s.tool : [s.tool]) if (n !== "*" && !WRITE_TOOLS.has(n)) errs.push(`${id}: 쓰기 도구가 아님 ${n}`)
  }
  const ids = new Set<string>()
  for (const t of file.tasks) {
    if (ids.has(t.id)) errs.push(`${t.id}: id 중복`)
    ids.add(t.id)
    for (const s of t.proposals ?? []) checkSpec(t.id, s)
    for (const s of t.forbidProposals ?? []) checkSpec(t.id, s)
    for (const n of [...(t.forbidTools ?? []), ...(t.requiredTools ?? []), ...(t.allowExtra ?? [])]) if (!tools.has(n)) errs.push(`${t.id}: 모르는 도구 ${n}`)
    for (const [n] of t.dry.reads) if (!READ_TOOLS.has(n)) errs.push(`${t.id}: dry.reads 에 읽기 도구가 아님 ${n}`)
    for (const [n] of t.dry.proposals ?? []) if (!WRITE_TOOLS.has(n)) errs.push(`${t.id}: dry.proposals 에 쓰기 도구가 아님 ${n}`)
    if (!t.rubric) errs.push(`${t.id}: rubric 없음`)
  }
  if (errs.length) throw new Error(`과제 파일 오류\n${errs.join("\n")}`)
}

async function resolveCaller(name: string): Promise<Caller> {
  const user = await prisma.user.findFirst({ where: { name: { contains: name }, isActive: true }, select: { id: true, name: true, role: true } })
  if (!user) throw new Error(`사용자 "${name}" 를 찾지 못했습니다 (--user 로 지정)`)
  return { userId: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "MEMBER", ip: null }
}

function assertLocalDb(): string {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    throw new Error(`DATABASE_URL 이 로컬이 아니다 (${host || "비어 있음"}). 이 벤치는 로컬 스냅샷(5433)에서만 돈다`)
  }
  return host
}

async function main() {
  const dryRun = flag("--dry-run")
  const taskFile = opt("--tasks") ?? process.env.AGENT_BENCH_TASKS ?? `${process.env.KAKAO_DATA_DIR ?? `${process.env.HOME}/work/omnis-import`}/eval/agent-tasks-261028.json`
  const file = JSON.parse(readFileSync(taskFile, "utf8")) as TaskFile
  validateTasks(file)
  const only = opt("--only")?.split(",").map((s) => s.trim())
  const limit = Number(opt("--limit") ?? 0)
  let tasks = only ? file.tasks.filter((t) => only.includes(t.id)) : file.tasks
  if (limit > 0) tasks = tasks.slice(0, limit)
  const repeat = Math.max(1, Number(opt("--repeat") ?? 1))
  const maxTurns = Number(opt("--max-turns") ?? 12)
  const maxKrwPerTask = Number(opt("--max-krw-per-task") ?? 1000)
  const budgetKrw = Number(opt("--budget-krw") ?? 35_000)
  const workdays = Number(opt("--workdays") ?? 22)
  const all = [...AGENT_MODELS, ...MODELS.filter((m) => !AGENT_MODELS.some((a) => a.key === m.key))]

  if (flag("--list")) {
    for (const m of AGENT_MODELS) { const a = modelAvailable(m); console.log(`${a.ok ? "○" : "×"} ${m.key.padEnd(24)} ${m.id.padEnd(22)} $${m.price.input}/${m.price.output}${m.price.cachedInput !== undefined ? ` (캐시 ${m.price.cachedInput})` : ""}${m.effort ? ` effort=${m.effort}` : ""}${a.ok ? "" : `   (${a.why})`}`) }
    console.log(`그 밖에 config.ts MODELS 의 키도 받는다. 심판: ${judgeModel().key}`)
    console.log(`과제 ${file.tasks.length}개 · ${taskFile} · 스냅샷 ${file.snapshotDate}`)
    return
  }

  const dbHost = assertLocalDb()
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  if (todayKst !== file.snapshotDate) {
    console.log(`⚠ 오늘(${todayKst})이 과제 스냅샷 날짜(${file.snapshotDate})와 다르다. list_tasks 의 지연 판정은 실제 시계를 쓰므로 집계 과제 정답이 어긋날 수 있다`)
  }

  let models: ModelSpec[]
  if (dryRun) {
    models = [DRY_PERFECT, DRY_NAIVE]
    if (opt("--models")) console.log("dry-run: --models 는 무시하고 고정 스크립트(dry-perfect · dry-naive)로 돈다. 모델별 비용은 끝의 추산 표를 본다")
  } else {
    const want = (opt("--models") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    if (!want.length) throw new Error(`--models 를 주세요 (유료 호출이라 기본값이 없다). 예: ${AGENT_MODELS.map((m) => m.key).join(",")}`)
    models = want.map((k) => { const m = all.find((x) => x.key === k); if (!m) throw new Error(`모르는 모델 ${k}`); return m })
    for (const m of models) { const a = modelAvailable(m); if (!a.ok) throw new Error(`${m.key}: ${a.why}`) }
  }
  const doJudge = !dryRun && !flag("--no-judge")
  if (doJudge && !modelAvailable(judgeModel()).ok) throw new Error(`심판 ${judgeModel().key} 키가 없습니다 (--no-judge 로 끄거나 키를 주세요)`)

  const runId = opt("--run") ?? `agent-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2")}${dryRun ? "-dry" : ""}`
  const dir = join("bench/results", runId)
  mkdirSync(dir, { recursive: true })
  const outFile = join(dir, "results.jsonl")
  const done = new Set<string>()
  let spentKrw = 0
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line) as AgentRow
      spentKrw += r.costKrw + usdToKrw(r.judge?.costUsd ?? 0)
      if (!r.error) done.add(`${r.model}|${r.taskId}|${r.rep}`)
    }
  }

  const caller = await resolveCaller(opt("--user") ?? file.user)
  const system = agentSystemPrompt(file.snapshotDate, caller.name)
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    runId, startedAt: new Date().toISOString(), dryRun, dbHost, caller: caller.name, krwPerUsd: KRW_PER_USD,
    taskFile, snapshotDate: file.snapshotDate, taskCount: tasks.length, repeat, maxTurns, maxKrwPerTask, budgetKrw,
    models: models.map((m) => ({ key: m.key, id: m.id, price: m.price, effort: m.effort ?? null, thinking: m.thinking ?? null })),
    judge: doJudge ? judgeModel().key : null,
    tools: AGENT_TOOLS.map((t) => t.name),
  }, null, 2))

  const total = models.length * tasks.length * repeat
  console.log(`run ${runId} · DB ${dbHost} · ${models.map((m) => m.key).join(", ")} × 과제 ${tasks.length} × ${repeat}회 = ${total} (이미 ${done.size}) · 예산 ${budgetKrw.toLocaleString()}원 (사용 ${Math.round(spentKrw)}원)`)

  let n = 0
  outer: for (const model of models) {
    for (const task of tasks) {
      for (let rep = 1; rep <= repeat; rep++) {
        n++
        if (done.has(`${model.key}|${task.id}|${rep}`)) continue
        if (spentKrw >= budgetKrw) { console.log(`⚠ 예산 ${budgetKrw.toLocaleString()}원에 닿아 멈춤. --budget-krw 를 올리고 같은 --run ${runId} 로 이어 돌린다`); break outer }
        const row = await runOne(runId, model, task, rep, caller, system, { dryRun, doJudge, maxTurns, maxKrwPerTask })
        appendFileSync(outFile, JSON.stringify(row) + "\n")
        spentKrw += row.costKrw + usdToKrw(row.judge?.costUsd ?? 0)
        const calls = row.turns.flatMap((t) => t.calls.map((c) => `${c.name}${c.kind === "proposal" ? "*" : c.kind === "rejected" ? "!" : ""}`)).join(" ")
        console.log(
          `[${String(n).padStart(3)}/${total}] ${model.key} · ${task.id}#${rep} ${row.completed ? "완수" : "실패"}` +
          `  expect ${row.det.hits.length}/${row.det.hitTotal} · 제안 ${row.det.matched.length}/${row.det.expectedProposals}${row.det.extra ? ` +${row.det.extra}` : ""}` +
          `${row.judge ? ` · 심판 ${row.judge.score}` : ""} · ${row.turns.length}턴 · ${(row.ms / 1000).toFixed(1)}s · ${row.costKrw}원` +
          `\n        도구: ${calls || "(없음)"}` +
          (row.det.violations.length ? `\n        위반: ${row.det.violations.join(" · ")}` : "") +
          (row.error ? `\n        오류: ${row.error.slice(0, 160)}` : "")
        )
        if (row.error && /credit balance|insufficient_quota|billing/i.test(row.error)) { console.log(`⚠ ${model.key}: 잔액 소진 — 이 모델은 건너뜀`); break }
      }
    }
  }

  writeAgentReport(dir, { workdays, repeat: Math.max(repeat, 2) })
  console.log(`\n결과: ${dir}/summary.md`)
}

async function runOne(
  runId: string, model: ModelSpec, task: AgentTask, rep: number, caller: Caller, system: string,
  o: { dryRun: boolean; doJudge: boolean; maxTurns: number; maxKrwPerTask: number }
): Promise<AgentRow> {
  let driver: Driver
  if (model === DRY_PERFECT) driver = scriptedDriver(perfectScript(task), system, AGENT_TOOLS, task.prompt)
  else if (model === DRY_NAIVE) driver = scriptedDriver(naiveScript(), system, AGENT_TOOLS, task.prompt)
  else driver = createDriver(model, system, AGENT_TOOLS, task.prompt)

  const r = await runAgentLoop(driver, model, caller, { maxTurns: o.maxTurns, maxKrwPerTask: o.maxKrwPerTask, dryRun: o.dryRun })
  const det = gradeDeterministic(task, r.answer, r.proposals, r.turns, r.error)
  const judgePrompt = buildJudgePrompt(task, r.answer, r.proposals, r.turns, r.evidence)
  let j: JudgeGrade | null = null
  if (o.doJudge) {
    if (!r.answer && r.error) j = { score: 0, badWrite: false, reason: `실행 실패: ${r.error.slice(0, 80)}`, costUsd: 0, ms: 0 }
    else {
      try { j = await judge(judgePrompt) } catch (err) { j = { score: 0, badWrite: false, reason: `심판 실패: ${String(err).slice(0, 120)}`, costUsd: 0, ms: 0 } }
    }
  }
  return {
    runId, model: model.key, modelId: model.id, taskId: task.id, kind: task.kind, rep, prompt: task.prompt,
    answer: r.answer, proposals: r.proposals, turns: r.turns, usage: r.usage,
    costUsd: r.costUsd, costKrw: usdToKrw(r.costUsd), ms: r.ms,
    det, judge: j, judgeEstInput: estTokens(judgePrompt),
    completed: det.pass && (j === null || j.score >= 1),
    error: r.error, note: r.note, at: new Date().toISOString(),
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
