// 가동률 · 장애 건수 · 복구 시간 — uptime 워크플로 실행 기록에서 센다. 읽기만 한다.
//   npx tsx scripts/uptime-report.ts --from 2026-10-01 [--to 2026-10-31]
//   npx tsx scripts/uptime-report.ts --file runs.json          (gh 대신 파일 — 시험용)
//
// gh 로그인이 필요하다. Actions 실행 기록은 90일이 지나면 사라질 수 있으니 매월 결과를 mydocs/working/ops-log.md 에 옮긴다.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { summarizeUptime, type UptimeRun } from "../lib/uptime-report"
export {}

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const file = arg("--file")
const from = arg("--from")
const to = arg("--to")
if (!file && !from) throw new Error("--from YYYY-MM-DD 또는 --file <runs.json> 이 필요하다")

let runs: UptimeRun[]
if (file) {
  runs = JSON.parse(readFileSync(file, "utf8"))
} else {
  // created 는 UTC 날짜로 거른다. 한국 날짜 경계와 9시간 어긋나지만 한 달 단위 장부에는 문제가 안 된다
  const created = to ? `${from}..${to}` : `>=${from}`
  const lines = execFileSync(
    "gh",
    [
      "api", "--paginate",
      `repos/HADDScience/omnis/actions/workflows/uptime.yml/runs?per_page=100&created=${encodeURIComponent(created)}`,
      "--jq", ".workflow_runs[] | {created_at, status, conclusion, event}",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
  runs = lines.split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

const s = summarizeUptime(runs)
const pct = s.ratio === null ? "—" : `${(s.ratio * 100).toFixed(2)}%`
console.log(`기간 ${s.first ?? "—"} ~ ${s.last ?? "—"} · 센 회차 ${s.runs} · 성공 ${s.ok} · 가동률 ${pct}`)
console.log(`장애 ${s.incidents.length}건`)
for (const i of s.incidents) {
  console.log(`  ${i.start} ~ ${i.end ?? "(진행 중)"} · 실패 ${i.failedRuns}회 · 복구 ${i.minutes === null ? "—" : `${i.minutes}분`}`)
}
