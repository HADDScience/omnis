// 재채점 — 저장된 결과 행을 다른 심판으로 다시 채점해 새 run 폴더에 쓴다. 답변 생성은 하지 않는다.
//
//   npx tsx bench/rejudge.ts bench/results/<run> --judge claude-sonnet-cli [--methods a,b] [--limit N] [--out <새 run 폴더>]
//
// 심판에게 준 근거(evidence)와 부가 정보(judgeInput)가 행에 있어야 같은 조건으로 다시 채점할 수 있다.
// 그 둘을 저장하기 전의 행(2026-10-07 본측정까지)은 건너뛰고 수를 알린다. 원본 run 폴더는 건드리지 않는다.
// 기본 출력 폴더는 <run>-rejudge-<judge>. 같은 명령을 다시 돌리면 이미 채점한 행은 건너뛴다 (구독 한도로 멈춘 뒤 재개).
// 새 행의 prevJudge 에 원래 심판의 점수를 남겨, 끝에 원래 점수와의 비교표를 찍는다.
import "dotenv/config"
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs"
import { basename, dirname, join } from "path"
import type { ResultRow } from "./run"

const args = process.argv.slice(2)
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  const src = args[0]
  const judgeName = opt("--judge")
  if (!src || src.startsWith("--") || !judgeName) throw new Error("사용법: npx tsx bench/rejudge.ts bench/results/<run> --judge claude-sonnet-cli [--methods a,b] [--limit N] [--out <폴더>]")
  // config.ts 는 import 될 때 BENCH_JUDGE 를 읽는다 — 정한 뒤에 불러온다
  process.env.BENCH_JUDGE = judgeName
  const { JUDGE_LABEL } = await import("./config")
  const { judgeMany, judgedFields, JUDGE_BATCH, JUDGE_CONCURRENCY } = await import("./judge")
  const { ClaudeLimitError } = await import("./claude-cli")
  const { writeReport, dedupe } = await import("./report")

  const srcFile = join(src, "results.jsonl")
  if (!existsSync(srcFile)) throw new Error(`${srcFile} 없음`)
  const out = opt("--out") ?? join(dirname(src), `${basename(src)}-rejudge-${judgeName}`)
  if (out.replace(/\/$/, "") === src.replace(/\/$/, "")) throw new Error("--out 이 원본 run 과 같다 — 원본은 건드리지 않는다")
  const methods = opt("--methods")?.split(",").map((s) => s.trim()).filter(Boolean)
  const limit = Number(opt("--limit") ?? 0)

  const rows = dedupe(readFileSync(srcFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultRow))
    .filter((r) => !methods || methods.includes(r.method))
  // 심판도 못 한 인프라 오류 행(답 없음 · 채점 없음)은 원래도 표에서 빠진다
  const infra = rows.filter((r) => r.error && !r.judge && !r.judgePending)
  const candidates = rows.filter((r) => !infra.includes(r))
  const noEvidence = candidates.filter((r) => r.evidence === undefined || r.judgeInput === undefined)
  const eligible = candidates.filter((r) => r.evidence !== undefined && r.judgeInput !== undefined).slice(0, limit > 0 ? limit : undefined)

  console.log(`원본 ${src} · 행 ${rows.length}${methods ? ` (방법 ${methods.join(",")})` : ""}`)
  if (noEvidence.length) {
    console.log(`⚠ 근거(evidence·judgeInput)가 저장되지 않은 행 ${noEvidence.length}개는 다시 채점할 수 없어 건너뜀` +
      ` — 근거 저장 이전에 돈 run 이다. 다시 채점하려면 답변부터 새로 돌려야 한다`)
  }
  if (infra.length) console.log(`인프라 오류 행 ${infra.length}개 건너뜀 (원래도 집계 밖)`)
  if (eligible.length === 0) return console.log("다시 채점할 행이 없다")

  mkdirSync(out, { recursive: true })
  const outFile = join(out, "results.jsonl")
  const key = (r: Pick<ResultRow, "model" | "method" | "qid">) => `${r.model}|${r.method}|${r.qid}`
  const done = new Set(existsSync(outFile) ? readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => key(JSON.parse(l) as ResultRow)) : [])
  const todo = eligible.filter((r) => !done.has(key(r)))

  const srcMeta = existsSync(join(src, "meta.json")) ? JSON.parse(readFileSync(join(src, "meta.json"), "utf8")) : {}
  writeFileSync(join(out, "meta.json"), JSON.stringify({
    ...srcMeta, runId: basename(out), judge: JUDGE_LABEL, rejudgeOf: src, rejudgedAt: new Date().toISOString(), prevJudge: srcMeta.judge ?? null,
  }, null, 2))
  console.log(`심판 ${JUDGE_LABEL} · 대상 ${eligible.length}행 (이미 채점 ${eligible.length - todo.length}) · 묶음 ${JUDGE_BATCH} · 동시 ${JUDGE_CONCURRENCY} → ${out}`)

  const byKey = new Map(todo.map((r) => [key(r), r]))
  const write = (r: ResultRow, fields: Partial<ResultRow>) => {
    const prev = r.judge ? { model: r.judgeModel ?? String(srcMeta.judge ?? "(기록 없음)"), score: r.judge.score, hallucination: r.judge.hallucination, process: r.judge.process } : null
    const row: ResultRow = { ...r, runId: basename(out), judge: null, judgeModel: undefined, judgeNotionalUsd: undefined, judgeUsage: undefined, judgePending: undefined, judgeOnly: undefined, ...fields, prevJudge: prev }
    appendFileSync(outFile, JSON.stringify(row) + "\n")
  }
  // 빈 답변은 원래처럼 호출 없이 0점
  const empty = todo.filter((r) => !r.answer)
  for (const r of empty) write(r, { judge: { score: 0, hallucination: false, reason: "빈 답변", costUsd: 0 }, judgeModel: JUDGE_LABEL })
  const items = todo.filter((r) => r.answer).map((r) => ({ key: key(r), question: r.question, expect: r.expect, answer: r.answer, evidence: r.evidence ?? "", input: r.judgeInput ?? {} }))

  const t0 = performance.now()
  let failed = 0
  let stats = { calls: 0, notionalUsd: 0 }
  let limited = false
  try {
    stats = await judgeMany(items, (k, res) => write(byKey.get(k)!, judgedFields(res)), (k, err) => { failed++; console.log(`  ✗ ${k}: ${err}`) })
  } catch (err) {
    if (!(err instanceof ClaudeLimitError)) throw err
    limited = true
    console.log(`\n⚠ Claude 구독 한도: ${err.message.slice(0, 200)}\n  채점한 행은 ${outFile} 에 남았다. 한도가 풀리면 같은 명령으로 이어서`)
  }
  const sec = (performance.now() - t0) / 1000

  await writeReport(out)
  const outRows = readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultRow)
  const notional = outRows.reduce((s, r) => s + (r.judgeNotionalUsd ?? 0), 0)
  console.log(`\n채점 ${items.length - failed}행${limited ? " (한도로 중단)" : ""} · 실패 ${failed} · 호출 ${stats.calls}회 · ${sec.toFixed(1)}초 · 이번 API 환산 $${stats.notionalUsd.toFixed(4)} (폴더 누적 $${notional.toFixed(4)}, 청구 없음)`)

  // 원래 심판과의 비교표
  const fmt = (s: number | undefined, p: number | null | undefined, h: boolean | undefined) => s === undefined ? "-" : `${s}${h ? "!" : ""}${typeof p === "number" ? ` / ${p}` : ""}`
  console.log(`\n| 문항 | 유형 | 방법 | ${outRows[0]?.prevJudge?.model ?? "원래"} 점수/과정 | ${JUDGE_LABEL} 점수/과정 | 같음 |`)
  console.log("|---|---|---|--:|--:|:-:|")
  let same = 0
  for (const r of outRows) {
    const eq = r.prevJudge?.score === r.judge?.score
    if (eq) same++
    console.log(`| ${r.qid} | ${r.type} | ${r.method} | ${fmt(r.prevJudge?.score, r.prevJudge?.process, r.prevJudge?.hallucination)} | ${fmt(r.judge?.score, r.judge?.process, r.judge?.hallucination)} | ${eq ? "○" : "×"} |`)
  }
  console.log(`\n점수 일치 ${same}/${outRows.length} (! = 환각 판정) · 결과 ${join(out, "summary.md")}`)
  if (limited) process.exitCode = 2
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
