// 블라인드 A/B 집계 — votes.jsonl 과 sessions.jsonl 을 합쳐 블라인드를 푼다.
//
//   npx tsx bench/report-ab.ts --peek     # 진행 현황만 (팔을 드러내지 않는다 — 평가 도중에 써도 된다)
//   npx tsx bench/report-ab.ts            # 평가가 다 끝났을 때. 아직 목표에 못 미친 쌍이 있으면 멈춘다
//   npx tsx bench/report-ab.ts --force    # 그래도 푼다 — 그 뒤의 평가는 블라인드가 아니다
//
// 결과: bench/results/lab-ab/summary.md. 계획: mydocs/plans/2026-10-06-weknora-lab.md 「블라인드 A/B 화면」
import "dotenv/config"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import {
  LAB_DIR, GOAL_PER_PAIR, PAIRS, PAIR_KEYS, readSessions, readVotes, spentKrw,
  type Arm, type Pair, type Scores, type SessionRow, type Side, type VoteRow,
} from "./lab-ab/trial"

const args = process.argv.slice(2)
const flag = (k: string) => args.includes(k)

interface Joined {
  vote: VoteRow
  session: SessionRow
  /** 선호한 팔. 비슷이면 null */
  winner: Arm | null
}

const SCORE_KEYS: { key: keyof Scores; label: string }[] = [
  { key: "satisfy", label: "답 만족" },
  { key: "trust", label: "근거 신뢰" },
  { key: "worthWait", label: "기다릴 만했나" },
  { key: "agentic", label: "알아서 해냈다" },
]

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(0)}%` : "—")
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "—")
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()

function join2(): Joined[] {
  const sessions = new Map(readSessions().map((s) => [s.trialId, s]))
  const out: Joined[] = []
  for (const vote of readVotes()) {
    const session = sessions.get(vote.trialId)
    if (!session) continue
    out.push({ vote, session, winner: vote.prefer === "tie" ? null : session.sides[vote.prefer].arm })
  }
  return out
}

function peek(rows: Joined[]) {
  const sessions = readSessions()
  console.log(`실행 ${sessions.length}회 · 평가 ${rows.length}건 · 누적 ${spentKrw().toFixed(0)}원`)
  for (const p of PAIR_KEYS) {
    const n = rows.filter((r) => r.session.pair === p).length
    console.log(`  ${p.padEnd(6)} ${String(n).padStart(3)} / ${GOAL_PER_PAIR}`)
  }
}

function pairTable(rows: Joined[], title: string): string[] {
  const lines = [`### ${title}`, "", "| 쌍 | 평가 | 앞 팔 선호 | 뒤 팔 선호 | 비슷 | 앞 팔 승률 (비슷 제외) |", "|---|--:|---|---|--:|--:|"]
  for (const p of PAIR_KEYS) {
    const rs = rows.filter((r) => r.session.pair === p)
    if (rs.length === 0) continue
    const [x, y] = PAIRS[p]
    const wx = rs.filter((r) => r.winner === x).length
    const wy = rs.filter((r) => r.winner === y).length
    const tie = rs.length - wx - wy
    lines.push(`| ${p} | ${rs.length} | ${x} ${wx} | ${y} ${wy} | ${tie} | ${pct(wx, wx + wy)} |`)
  }
  if (lines.length === 4) lines.push("| (없음) | 0 | | | | |")
  return [...lines, ""]
}

function armTable(rows: Joined[]): string[] {
  const per = new Map<string, { scores: Scores[]; sec: number[]; krw: number[] }>()
  for (const r of rows) {
    for (const side of ["A", "B"] as Side[]) {
      const s = r.session.sides[side]
      const k = `${s.arm} (${s.method})`
      const cur = per.get(k) ?? { scores: [], sec: [], krw: [] }
      cur.scores.push(r.vote.scores[side])
      cur.sec.push(s.sec)
      cur.krw.push(s.krw)
      per.set(k, cur)
    }
  }
  const lines = [
    "| 팔 | 평가 | " + SCORE_KEYS.map((s) => s.label).join(" | ") + " | 평균 초 | 평균 원 |",
    "|---|--:|" + SCORE_KEYS.map(() => "--:").join("|") + "|--:|--:|",
  ]
  for (const [k, v] of [...per].sort()) {
    lines.push(`| ${k} | ${v.scores.length} | ` + SCORE_KEYS.map((s) => avg(v.scores.map((x) => x[s.key]))).join(" | ") + ` | ${avg(v.sec)} | ${avg(v.krw)} |`)
  }
  return [...lines, ""]
}

function guessTable(rows: Joined[]): string[] {
  const g = rows.filter((r) => r.vote.guessed)
  if (g.length === 0) return ["짐작 메모가 있는 평가 없음.", ""]
  const lines = ["| trialId | 쌍 | 실제 A | 실제 B | 선호 | 짐작 메모 |", "|---|---|---|---|---|---|"]
  for (const r of g) {
    lines.push(`| ${r.vote.trialId.slice(0, 8)} | ${r.session.pair} | ${r.session.sides.A.arm} | ${r.session.sides.B.arm} | ${r.vote.prefer === "tie" ? "비슷" : `${r.vote.prefer}=${r.winner}`} | ${cell(r.vote.guessed ?? "")} |`)
  }
  return [...lines, ""]
}

function main() {
  const rows = join2()
  if (flag("--peek")) { peek(rows); return }

  const unfinished = PAIR_KEYS.filter((p: Pair) => {
    const n = rows.filter((r) => r.session.pair === p).length
    return n > 0 && n < GOAL_PER_PAIR
  })
  if (unfinished.length && !flag("--force")) {
    peek(rows)
    console.log(`\n⚠ 평가가 끝난 뒤 실행하세요 — 목표(${GOAL_PER_PAIR})에 못 미친 쌍: ${unfinished.join(", ")}.`)
    console.log("  이 집계는 어느 쪽이 어느 팔이었는지 드러낸다. 본 뒤의 평가는 블라인드가 아니다.")
    console.log("  진행 현황만 보려면 --peek, 그래도 풀려면 --force")
    process.exitCode = 1
    return
  }

  const blind = rows.filter((r) => !r.vote.guessed)
  const guessed = rows.filter((r) => r.vote.guessed)
  const md = [
    "# 블라인드 A/B 집계",
    "",
    `생성 ${new Date().toISOString()} · 평가 ${rows.length}건 (짐작 메모 없음 ${blind.length} · 있음 ${guessed.length}) · 실행 원가 누적 ${spentKrw().toFixed(0)}원` +
      (unfinished.length ? ` · **--force: 목표 미달 쌍 ${unfinished.join(", ")}**` : ""),
    "",
    "## 쌍별 선호",
    "",
    "앞 팔 / 뒤 팔은 쌍 이름의 순서다 (N0-A1 이면 N0 이 앞). 승률은 비슷을 뺀 표 중 앞 팔을 고른 비율.",
    "",
    ...pairTable(blind, "짐작 메모 없는 평가 (본 결과)"),
    ...pairTable(guessed, "짐작 메모 있는 평가 (따로 본다 — 블라인드가 깨졌을 수 있다)"),
    ...pairTable(rows, "전체"),
    "## 팔별 항목 평균 (1~5, 전체 평가)",
    "",
    ...armTable(rows),
    "## 짐작 메모",
    "",
    ...guessTable(rows),
  ].join("\n")
  mkdirSync(LAB_DIR, { recursive: true })
  const out = join(LAB_DIR, "summary.md")
  writeFileSync(out, md)
  console.log(md)
  console.log(`\n→ ${out}`)
}

main()
