// 결과 집계 — results.jsonl → summary.md · summary.csv
//
//   npx tsx bench/report.ts bench/results/<run>
//
// 셀 하나 = 모델 × 방법. 품질(심판 평균 · 근거 적중률 · 환각 수), 시간(p50 · p90 · 단계별),
// 비용(질문당 원 · 토큰) 을 한 표에 놓는다. 하루 50건 기준 월 비용도 같이 적는다.
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import type { ResultRow } from "./run"

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

export interface Cell {
  model: string
  method: string
  n: number
  errors: number
  notes: number
  judgeAvg: number
  judgeFull: number
  hallucinations: number
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
    const judged = ok.filter((r) => r.judge)
    const krw = avg(ok.map((r) => r.costKrw))
    const krwPerUsd = ok.length && ok[0].costUsd > 0 ? ok[0].costKrw / ok[0].costUsd : 1380
    cells.push({
      model, method, n: rs.length, errors: rs.length - ok.length, notes: ok.filter((r) => r.note).length,
      judgeAvg: r2(avg(judged.map((r) => r.judge!.score))),
      judgeFull: judged.filter((r) => r.judge!.score === 2).length,
      hallucinations: judged.filter((r) => r.judge!.hallucination).length,
      hitRate: r2(ok.reduce((a, r) => a + r.hits.length, 0) / Math.max(ok.reduce((a, r) => a + r.hitTotal, 0), 1)),
      p50: pct(ok.map((r) => r.timings.total), 0.5), p90: pct(ok.map((r) => r.timings.total), 0.9),
      retrieval: Math.round(avg(ok.map((r) => r.timings.retrieval))), context: Math.round(avg(ok.map((r) => r.timings.context))), llm: Math.round(avg(ok.map((r) => r.timings.llm))),
      calls: r1(avg(ok.map((r) => r.calls))),
      inTok: Math.round(avg(ok.map((r) => r.usage.input))), outTok: Math.round(avg(ok.map((r) => r.usage.output))), thinkTok: Math.round(avg(ok.map((r) => r.usage.thinking))),
      krw: r2(krw), krwMonth50: Math.round(krw * 50 * 30),
      judgeKrw: r2(avg(judged.map((r) => r.judge!.costUsd)) * krwPerUsd),
    })
  }
  // 품질 높은 순, 같으면 싼 순
  return cells.sort((a, b) => b.judgeAvg - a.judgeAvg || b.hitRate - a.hitRate || a.krw - b.krw)
}

export async function writeReport(dir: string) {
  const file = join(dir, "results.jsonl")
  if (!existsSync(file)) throw new Error(`${file} 없음`)
  const rows = dedupe(readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultRow))
  const meta = existsSync(join(dir, "meta.json")) ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) : {}
  const cells = aggregate(rows)

  const header = "| 모델 | 방법 | n | 심판 평균(0~2) | 만점 | 환각 | 근거 적중 | p50 | p90 | 검색 | 조립 | 생성 | 호출 | 입력 tok | 출력 tok | thinking | 질문당 원 | 월(50/일) |"
  const sep = "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|"
  const line = (c: Cell) =>
    `| ${c.model} | ${c.method} | ${c.n}${c.errors ? ` (✗${c.errors})` : ""}${c.notes ? ` (산문 ${c.notes})` : ""} | **${c.judgeAvg}** | ${c.judgeFull} | ${c.hallucinations} | ${Math.round(c.hitRate * 100)}% | ${(c.p50 / 1000).toFixed(1)}s | ${(c.p90 / 1000).toFixed(1)}s | ${c.retrieval} | ${c.context} | ${c.llm} | ${c.calls} | ${c.inTok.toLocaleString()} | ${c.outTok.toLocaleString()} | ${c.thinkTok.toLocaleString()} | ${c.krw} | ${c.krwMonth50.toLocaleString()} |`

  const byMethod = new Map<string, Cell[]>()
  for (const c of cells) byMethod.set(c.method, [...(byMethod.get(c.method) ?? []), c])

  const md = [
    `# 벤치마크 ${meta.runId ?? dir}`,
    "",
    `DB ${meta.dbHost ?? "?"} · 질문 ${meta.questionCount ?? "?"}개 (${meta.questions ?? "?"}) · 심판 ${meta.judge ?? "없음"} · 환율 ${meta.krwPerUsd ?? "?"}원/$ · 시작 ${meta.startedAt ?? "?"}`,
    "",
    "시간은 ms 평균(검색 = 임베딩 호출 + pgvector · 조립 = 현황 DB 조회 또는 도구 실행 · 생성 = 모델 호출 합계). p50·p90 은 질문 전체 시간. 원은 질문 1건 평균, 심판 비용 제외.",
    "",
    "## 전체 (품질 높은 순)",
    "",
    header, sep, ...cells.map(line),
    "",
    ...[...byMethod.entries()].flatMap(([m, cs]) => [`## 방법 ${m}`, "", header, sep, ...cs.map(line), ""]),
    "## 답변별",
    "",
    ...rows.map((r) =>
      `### ${r.model} · ${r.method} · ${r.qid}${r.error ? " · ✗" : ""}\n` +
      `${r.question}\n\n` +
      `근거 ${r.hits.length}/${r.hitTotal}${r.judge ? ` · 심판 ${r.judge.score}${r.judge.hallucination ? " (환각)" : ""} — ${r.judge.reason}` : ""} · ${(r.timings.total / 1000).toFixed(1)}s · ${r.costKrw}원 · 호출 ${r.calls}` +
      (r.trace?.length ? `\n\n도구: ${r.trace.map((t) => `${t.tool}(${JSON.stringify(t.args)}) → ${t.resultChars}자 ${t.ms}ms`).join(" → ")}` : "") +
      (r.note ? `\n\n비고: ${r.note}` : "") + (r.error ? `\n\n오류: ${r.error}` : "") +
      `\n\n${(r.answer || "(빈 답변)").split("\n").map((l) => `> ${l}`).join("\n")}\n`
    ),
  ].join("\n")
  writeFileSync(join(dir, "summary.md"), md)

  const csvHead = "model,method,n,errors,judge_avg,judge_full,hallucinations,hit_rate,p50_ms,p90_ms,retrieval_ms,context_ms,llm_ms,calls,in_tok,out_tok,think_tok,krw_per_q,krw_month_50,judge_krw"
  const csv = [csvHead, ...cells.map((c) => [c.model, c.method, c.n, c.errors, c.judgeAvg, c.judgeFull, c.hallucinations, c.hitRate, c.p50, c.p90, c.retrieval, c.context, c.llm, c.calls, c.inTok, c.outTok, c.thinkTok, c.krw, c.krwMonth50, c.judgeKrw].join(","))].join("\n")
  writeFileSync(join(dir, "summary.csv"), csv)
  return cells
}

if (process.argv[1]?.endsWith("report.ts")) {
  const dir = process.argv[2]
  if (!dir) { console.error("결과 폴더를 주세요: npx tsx bench/report.ts bench/results/<run>"); process.exit(1) }
  writeReport(dir).then((cells) => {
    console.log(`${cells.length} 셀 → ${join(dir, "summary.md")}`)
  })
}
