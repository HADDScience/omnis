// 결과 집계 — results.jsonl → summary.md · summary.csv
//
//   npx tsx bench/report.ts bench/results/<run>
//
// 셀 하나 = 모델 × 방법. 품질(심판 평균 · 근거 적중률 · 환각 수), 시간(p50 · p90 · 단계별),
// 비용(질문당 원 · 토큰) 을 한 표에 놓는다. 하루 50건 기준 월 비용도 같이 적는다.
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import type { ResultRow } from "./run"
import { DEFAULT_TYPE } from "./questions"

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

/** 과정 점수 평균. 옛 행·단발 방법처럼 매기지 않은 행은 빼고, 하나도 없으면 null */
function processAvg(rows: ResultRow[]): number | null {
  const xs = rows.map((r) => r.judge?.process).filter((p): p is 0 | 1 | 2 => typeof p === "number")
  return xs.length ? r2(avg(xs)) : null
}
const showProcess = (p: number | null) => (p === null ? "" : String(p))

export interface Cell {
  model: string
  method: string
  n: number
  errors: number
  notes: number
  judgeAvg: number
  judgeFull: number
  hallucinations: number
  /** 과정 점수 평균 — 매긴 행이 없으면 null (빈칸) */
  processAvg: number | null
  hitRate: number
  p50: number
  p90: number
  retrieval: number
  context: number
  llm: number
  calls: number
  inTok: number
  outTok: number
  thinkTok: number
  krw: number
  krwMonth50: number
  judgeKrw: number
}

/** 같은 (모델·방법·질문) 이 여러 줄이면(재개·재시도) 마지막 성공 줄, 없으면 마지막 줄만 남긴다 */
export function dedupe(rows: ResultRow[]): ResultRow[] {
  const last = new Map<string, ResultRow>()
  for (const r of rows) {
    const k = `${r.model}|${r.method}|${r.qid}`
    const cur = last.get(k)
    if (!cur || !r.error || cur.error) last.set(k, r)
  }
  return [...last.values()]
}

export function aggregate(allRows: ResultRow[]): Cell[] {
  const rows = dedupe(allRows)
  const groups = new Map<string, ResultRow[]>()
  for (const r of rows) {
    const k = `${r.model}|${r.method}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const cells: Cell[] = []
  for (const [k, rs] of groups) {
    const [model, method] = k.split("|")
    const ok = rs.filter((r) => !r.error)
    // 오류 행이라도 심판이 채점했으면(한도 초과로 "답을 정리하지 못했습니다" 등) 품질·원가·시간에 넣는다 —
    // 사용자에겐 실패한 답이고 돈과 시간은 나갔다. 빼면 포기한 방법이 평균에서 유리해진다 (2026-10-07 본측정에서 발견).
    // 심판도 못 한 인프라 오류(429 등)만 뺀다.
    const judged = rs.filter((r) => r.judge)
    const spent = rs.filter((r) => !r.error || r.judge)
    const krw = avg(spent.map((r) => r.costKrw))
    const krwPerUsd = ok.length && ok[0].costUsd > 0 ? ok[0].costKrw / ok[0].costUsd : 1380
    cells.push({
      model, method, n: rs.length, errors: rs.length - ok.length, notes: ok.filter((r) => r.note).length,
      judgeAvg: r2(avg(judged.map((r) => r.judge!.score))),
      judgeFull: judged.filter((r) => r.judge!.score === 2).length,
      hallucinations: judged.filter((r) => r.judge!.hallucination).length,
      processAvg: processAvg(judged),
      hitRate: r2(spent.reduce((a, r) => a + r.hits.length, 0) / Math.max(spent.reduce((a, r) => a + r.hitTotal, 0), 1)),
      p50: pct(spent.map((r) => r.timings.total), 0.5), p90: pct(spent.map((r) => r.timings.total), 0.9),
      retrieval: Math.round(avg(spent.map((r) => r.timings.retrieval))), context: Math.round(avg(spent.map((r) => r.timings.context))), llm: Math.round(avg(spent.map((r) => r.timings.llm))),
      calls: r1(avg(spent.map((r) => r.calls))),
      inTok: Math.round(avg(spent.map((r) => r.usage.input))), outTok: Math.round(avg(spent.map((r) => r.usage.output))), thinkTok: Math.round(avg(spent.map((r) => r.usage.thinking))),
      krw: r2(krw), krwMonth50: Math.round(krw * 50 * 30),
      judgeKrw: r2(avg(judged.map((r) => r.judge!.costUsd)) * krwPerUsd),
    })
  }
  // 품질 높은 순, 같으면 싼 순
  return cells.sort((a, b) => b.judgeAvg - a.judgeAvg || b.hitRate - a.hitRate || a.krw - b.krw)
}

export interface TypeCell { model: string; method: string; type: string; n: number; judgeAvg: number; judgeFull: number; hallucinations: number; processAvg: number | null; hitRate: number; krw: number }

/** 모델 × 방법 × 질문 유형. type 이 없는 행(옛 결과·옛 질문 파일)은 "regression" */
export function aggregateByType(allRows: ResultRow[]): TypeCell[] {
  const groups = new Map<string, ResultRow[]>()
  for (const r of dedupe(allRows)) {
    const k = `${r.model}|${r.method}|${r.type ?? DEFAULT_TYPE}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const cells: TypeCell[] = []
  for (const [k, rs] of groups) {
    const [model, method, type] = k.split("|")
    // aggregate() 와 같은 규칙 — 심판이 채점한 오류 행은 실패한 답으로 넣는다
    const judged = rs.filter((r) => r.judge)
    const ok = rs.filter((r) => !r.error || r.judge)
    cells.push({
      model, method, type, n: rs.length,
      judgeAvg: r2(avg(judged.map((r) => r.judge!.score))),
      judgeFull: judged.filter((r) => r.judge!.score === 2).length,
      hallucinations: judged.filter((r) => r.judge!.hallucination).length,
      processAvg: processAvg(judged),
      hitRate: r2(ok.reduce((a, r) => a + r.hits.length, 0) / Math.max(ok.reduce((a, r) => a + r.hitTotal, 0), 1)),
      krw: r2(avg(ok.map((r) => r.costKrw))),
    })
  }
  return cells.sort((a, b) => a.type.localeCompare(b.type) || a.model.localeCompare(b.model) || a.method.localeCompare(b.method))
}

export interface AgenticCell {
  model: string; method: string; n: number
  iterations: number; toolCalls: number; toolKinds: number
  /** 비율 0~1 */
  requery: number; hitLimit: number
  compactions: number
  processAvg: number | null
}

/** 도구 루프 지표가 있는 행(native · route · wk-agent)만 모델 × 방법으로 묶는다 */
export function aggregateAgentic(allRows: ResultRow[]): AgenticCell[] {
  const groups = new Map<string, ResultRow[]>()
  for (const r of dedupe(allRows)) {
    // 한도 초과로 끝난 행도 넣는다 — 빼면 "한도 도달" 비율이 늘 0 이 된다. 심판도 못 한 인프라 오류만 뺀다
    if (!r.agent || (r.error && !r.judge)) continue
    const k = `${r.model}|${r.method}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups].map(([k, rs]) => {
    const [model, method] = k.split("|")
    const a = rs.map((r) => r.agent!)
    return {
      model, method, n: rs.length,
      iterations: r1(avg(a.map((x) => x.iterations))), toolCalls: r1(avg(a.map((x) => x.toolCalls))), toolKinds: r1(avg(a.map((x) => x.toolKinds))),
      requery: r2(a.filter((x) => x.requery).length / rs.length), hitLimit: r2(a.filter((x) => x.hitLimit).length / rs.length),
      compactions: a.reduce((s, x) => s + x.compactions, 0),
      processAvg: processAvg(rs.filter((r) => r.judge)),
    }
  })
}

/**
 * 한 표에 서로 다른 심판의 점수가 섞였으면 경고 줄. 심판마다 점수 성향이 달라 섞어 비교하면 안 된다.
 * judgeModel 이 없는 옛 행은 meta.judge 의 심판으로 본다.
 */
function judgeMixWarning(rows: ResultRow[], fallback: string): string[] {
  const names = [...new Set(rows.filter((r) => r.judge).map((r) => r.judgeModel ?? fallback))]
  return names.length > 1 ? [`> ⚠ 이 표에는 서로 다른 심판의 점수가 섞여 있다 (${names.join(" · ")}). 심판이 다른 점수끼리 비교하지 않는다.`, ""] : []
}

/** 구독 심판(claude -p) 행이 있으면 요약 줄. 청구는 없고 API 환산액만 적는다 */
function cliJudgeLine(rows: ResultRow[]): string[] {
  const cli = rows.filter((r) => r.judgeModel?.startsWith("claude-cli:"))
  if (!cli.length) return []
  const models = [...new Set(cli.map((r) => r.judgeModel!.slice("claude-cli:".length)))].join(" · ")
  const usd = cli.reduce((s, r) => s + (r.judgeNotionalUsd ?? 0), 0)
  return [`심판: Claude 구독(claude -p, ${models}) · ${cli.length}행 · API 환산 $${usd.toFixed(3)} (청구 없음 — 표의 심판 원가는 0)`, ""]
}

export async function writeReport(dir: string) {
  const file = join(dir, "results.jsonl")
  if (!existsSync(file)) throw new Error(`${file} 없음`)
  const rows = dedupe(readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultRow))
  const meta = existsSync(join(dir, "meta.json")) ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) : {}
  const cells = aggregate(rows)
  const fallbackJudge = String(meta.judge ?? "(기록 없음)")

  const header = "| 모델 | 방법 | n | 심판 평균(0~2) | 만점 | 환각 | 과정(0~2) | 근거 적중 | p50 | p90 | 검색 | 조립 | 생성 | 호출 | 입력 tok | 출력 tok | thinking | 질문당 원 | 월(50/일) |"
  const sep = "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|"
  const line = (c: Cell) =>
    `| ${c.model} | ${c.method} | ${c.n}${c.errors ? ` (✗${c.errors})` : ""}${c.notes ? ` (산문 ${c.notes})` : ""} | **${c.judgeAvg}** | ${c.judgeFull} | ${c.hallucinations} | ${showProcess(c.processAvg)} | ${Math.round(c.hitRate * 100)}% | ${(c.p50 / 1000).toFixed(1)}s | ${(c.p90 / 1000).toFixed(1)}s | ${c.retrieval} | ${c.context} | ${c.llm} | ${c.calls} | ${c.inTok.toLocaleString()} | ${c.outTok.toLocaleString()} | ${c.thinkTok.toLocaleString()} | ${c.krw} | ${c.krwMonth50.toLocaleString()} |`

  const typeHeader = "| 유형 | 모델 | 방법 | n | 심판 평균(0~2) | 만점 | 환각 | 과정(0~2) | 근거 적중 | 질문당 원 |"
  const typeSep = "|---|---|---|--:|--:|--:|--:|--:|--:|--:|"
  const typeLine = (c: TypeCell) =>
    `| ${c.type} | ${c.model} | ${c.method} | ${c.n} | **${c.judgeAvg}** | ${c.judgeFull} | ${c.hallucinations} | ${showProcess(c.processAvg)} | ${Math.round(c.hitRate * 100)}% | ${c.krw} |`

  const agentic = aggregateAgentic(rows)
  const agenticHeader = "| 모델 | 방법 | n | 평균 반복 | 도구 호출 | 도구 종류 | 재검색 | 한도 도달 | 압축(합) | 과정(0~2) |"
  const agenticSep = "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|"
  const agenticLine = (c: AgenticCell) =>
    `| ${c.model} | ${c.method} | ${c.n} | ${c.iterations} | ${c.toolCalls} | ${c.toolKinds} | ${Math.round(c.requery * 100)}% | ${Math.round(c.hitLimit * 100)}% | ${c.compactions} | ${showProcess(c.processAvg)} |`

  const byMethod = new Map<string, Cell[]>()
  for (const c of cells) byMethod.set(c.method, [...(byMethod.get(c.method) ?? []), c])

  const md = [
    `# 벤치마크 ${meta.runId ?? dir}`,
    "",
    `DB ${meta.dbHost ?? "?"} · 질문 ${meta.questionCount ?? "?"}개 (${meta.questions ?? "?"}) · 심판 ${meta.judge ?? "없음"} · 환율 ${meta.krwPerUsd ?? "?"}원/$ · 시작 ${meta.startedAt ?? "?"}`,
    "",
    ...cliJudgeLine(rows),
    "시간은 ms 평균(검색 = 임베딩 호출 + pgvector · 조립 = 현황 DB 조회 또는 도구 실행 · 생성 = 모델 호출 합계). p50·p90 은 질문 전체 시간. 원은 질문 1건 평균, 심판 비용 제외.",
    "",
    "## 전체 (품질 높은 순)",
    "",
    ...judgeMixWarning(rows, fallbackJudge),
    header, sep, ...cells.map(line),
    "",
    "## 유형별 (질문 파일의 type · 없으면 regression)",
    "",
    ...judgeMixWarning(rows, fallbackJudge),
    typeHeader, typeSep, ...aggregateByType(rows).map(typeLine),
    "",
    ...(agentic.length ? [
      "## Agentic (도구 루프 방법만)",
      "",
      "반복 = 모델 호출 수. 재검색 = 검색류 도구를 뒤 단계에서 다른 인자로 다시 부른 문항 비율. 한도 도달 = 반복 한도에 닿은 비율 (native·route 6단계, wk-agent 20회).",
      "",
      ...judgeMixWarning(rows.filter((r) => r.agent), fallbackJudge),
      agenticHeader, agenticSep, ...agentic.map(agenticLine), "",
    ] : []),
    ...[...byMethod.entries()].flatMap(([m, cs]) => [`## 방법 ${m}`, "", ...judgeMixWarning(rows.filter((r) => r.method === m), fallbackJudge), header, sep, ...cs.map(line), ""]),
    "## 답변별",
    "",
    ...rows.map((r) =>
      `### ${r.model} · ${r.method} · ${r.qid}${r.error ? " · ✗" : ""}\n` +
      `${r.question}\n\n` +
      `근거 ${r.hits.length}/${r.hitTotal}${r.judge ? ` · 심판 ${r.judge.score}${r.judge.hallucination ? " (환각)" : ""} — ${r.judge.reason}` : ""}${typeof r.judge?.process === "number" ? ` · 과정 ${r.judge.process} — ${r.judge.processReason ?? ""}` : ""} · ${(r.timings.total / 1000).toFixed(1)}s · ${r.costKrw}원 · 호출 ${r.calls}` +
      (r.trace?.length ? `\n\n도구: ${r.trace.map((t) => `${t.tool}(${JSON.stringify(t.args)}) → ${t.resultChars}자 ${t.ms}ms`).join(" → ")}` : "") +
      (r.agent ? `\n\n루프: 반복 ${r.agent.iterations} · 도구 ${r.agent.toolCalls}회 ${r.agent.toolKinds}종${r.agent.requery ? " · 재검색" : ""}${r.agent.hitLimit ? " · 한도 도달" : ""}${r.agent.compactions ? ` · 압축 ${r.agent.compactions}` : ""}` : "") +
      (r.note ? `\n\n비고: ${r.note}` : "") + (r.error ? `\n\n오류: ${r.error}` : "") +
      `\n\n${(r.answer || "(빈 답변)").split("\n").map((l) => `> ${l}`).join("\n")}\n`
    ),
  ].join("\n")
  writeFileSync(join(dir, "summary.md"), md)

  const csvHead = "model,method,n,errors,judge_avg,judge_full,hallucinations,process_avg,hit_rate,p50_ms,p90_ms,retrieval_ms,context_ms,llm_ms,calls,in_tok,out_tok,think_tok,krw_per_q,krw_month_50,judge_krw"
  const csv = [csvHead, ...cells.map((c) => [c.model, c.method, c.n, c.errors, c.judgeAvg, c.judgeFull, c.hallucinations, c.processAvg ?? "", c.hitRate, c.p50, c.p90, c.retrieval, c.context, c.llm, c.calls, c.inTok, c.outTok, c.thinkTok, c.krw, c.krwMonth50, c.judgeKrw].join(","))].join("\n")
  writeFileSync(join(dir, "summary.csv"), csv)
  return cells
}

if (process.argv[1]?.endsWith("report.ts")) {
  const dir = process.argv[2]
  if (!dir) { console.error("결과 폴더를 주세요: npx tsx bench/report.ts bench/results/<run>"); process.exit(1) }
  writeReport(dir).then((cells) => {
    console.log(`${cells.length} 셀 → ${join(dir, "summary.md")}`)
    const md = readFileSync(join(dir, "summary.md"), "utf8")
    if (md.includes("서로 다른 심판의 점수가 섞여")) console.log("⚠ 심판이 섞인 표가 있다 — summary.md 의 경고 줄 참고")
  })
}
