// 전역 비용 장부 — 여러 run 의 원가를 한 파일에 쌓아 총액을 본다.
//
//   npx tsx bench/ledger.ts            # run 별 합계 + 전체 합계
//
// results/ledger.jsonl 에 한 줄씩 append 한다. 생성·심판은 질문 1건마다, 검색 평가는 run 1건마다 한 줄.
// 작업지시자 개인 부담 예산(계획서 상한 약 5만 원)을 run 을 가로질러 확인하는 용도다.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { dirname } from "path"

export const LEDGER_FILE = "bench/results/ledger.jsonl"

export interface LedgerRow {
  at: string
  /** run: 생성 평가(run.ts) · retrieval: 검색 평가(retrieval-eval.ts) */
  kind: "run" | "retrieval"
  runId: string
  /** 답변·임베딩 원가 (원) */
  krw: number
  /** 심판 원가 (원). 검색 평가에는 없다 */
  judgeKrw?: number
  note?: string
}

export function appendLedger(row: Omit<LedgerRow, "at">) {
  mkdirSync(dirname(LEDGER_FILE), { recursive: true })
  appendFileSync(LEDGER_FILE, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n")
}

export function readLedger(): LedgerRow[] {
  if (!existsSync(LEDGER_FILE)) return []
  return readFileSync(LEDGER_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerRow)
}

/** 장부 전체 합계(원). 리랭크 서버처럼 run 폴더 밖에서 나간 돈까지 포함한다 */
export function ledgerTotal(): number {
  return readLedger().reduce((s, r) => s + r.krw + (r.judgeKrw ?? 0), 0)
}

/**
 * 실험 전체 상한 BENCH_TOTAL_CAP_KRW. BENCH_BUDGET_KRW 는 run 폴더 안의 원가만 세서
 * 리랭크 서버(wk-real-rerank) 원가를 못 봤다 (2026-10-07, 400원 상한 run 의 실제 지출 459원).
 */
export function overTotalCap(): string | null {
  const cap = Number(process.env.BENCH_TOTAL_CAP_KRW ?? 0)
  if (cap <= 0) return null
  const total = ledgerTotal()
  return total >= cap ? `장부 전체 ${total.toFixed(0)}원 ≥ BENCH_TOTAL_CAP_KRW ${cap}원` : null
}

if (process.argv[1]?.endsWith("ledger.ts")) {
  const rows = readLedger()
  if (rows.length === 0) { console.log(`${LEDGER_FILE} 에 기록이 없습니다`); process.exit(0) }
  const byRun = new Map<string, { kind: string; krw: number; judgeKrw: number; n: number; first: string }>()
  for (const r of rows) {
    const k = `${r.kind}|${r.runId}`
    const cur = byRun.get(k) ?? { kind: r.kind, krw: 0, judgeKrw: 0, n: 0, first: r.at }
    byRun.set(k, { ...cur, krw: cur.krw + r.krw, judgeKrw: cur.judgeKrw + (r.judgeKrw ?? 0), n: cur.n + 1 })
  }
  let total = 0
  console.log("종류        run                       줄   답변·임베딩      심판       합계 (원)")
  for (const [k, v] of byRun) {
    const sum = v.krw + v.judgeKrw
    total += sum
    console.log(`${v.kind.padEnd(10)}  ${k.split("|")[1].padEnd(24)}  ${String(v.n).padStart(4)}  ${v.krw.toFixed(2).padStart(10)}  ${v.judgeKrw.toFixed(2).padStart(9)}  ${sum.toFixed(2).padStart(10)}`)
  }
  console.log(`\n전체 합계 ${total.toFixed(2)}원 (${byRun.size} run)`)
  const cap = Number(process.env.BENCH_BUDGET_KRW ?? 0)
  if (cap > 0) console.log(`BENCH_BUDGET_KRW ${cap}원 대비 ${((total / cap) * 100).toFixed(1)}%`)
}
