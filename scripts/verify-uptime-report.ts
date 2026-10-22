// 가동률 계산 — 연속 실패 묶음 · 복구 시간 · 세지 않을 회차.
//   npx tsx scripts/verify-uptime-report.ts      (DB · 네트워크 없음)
import { summarizeUptime, type UptimeRun } from "../lib/uptime-report"
export {}

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}
const run = (hhmm: string, conclusion: string | null, extra: Partial<UptimeRun> = {}): UptimeRun => ({
  created_at: `2031-01-07T${hhmm}:00Z`, status: "completed", conclusion, event: "schedule", ...extra,
})

console.log("── 장애 묶음")
// 순서를 섞어 넣는다 — 시각으로 정렬해서 세야 한다
const s = summarizeUptime([
  run("02:00", "success"),
  run("00:00", "success"),
  run("00:30", "failure"),
  run("01:00", "failure"),
  run("01:30", "success"),
  run("03:00", "failure"),
])
check("센 회차 6 · 성공 3 · 가동률 0.5", [s.runs, s.ok, s.ratio], [6, 3, 0.5])
check("장애 2건", s.incidents.length, 2)
check("첫 장애: 00:30 실패부터 01:30 성공까지 60분, 실패 2회", [s.incidents[0].start, s.incidents[0].end, s.incidents[0].minutes, s.incidents[0].failedRuns], ["2031-01-07T00:30:00Z", "2031-01-07T01:30:00Z", 60, 2])
check("마지막 장애는 진행 중 — 끝 · 복구 시간 없음", [s.incidents[1].end, s.incidents[1].minutes], [null, null])
check("기간은 정렬된 첫·끝", [s.first, s.last], ["2031-01-07T00:00:00Z", "2031-01-07T03:00:00Z"])

console.log("── 세지 않는 회차 (거부)")
const r = summarizeUptime([
  run("00:00", "success"),
  run("00:30", "cancelled"),
  run("01:00", null, { status: "in_progress" }),
  run("01:30", "skipped"),
  run("02:00", "failure", { event: "workflow_dispatch" }),
  run("02:30", "success"),
])
check("거부: 취소 · 진행 중 · 건너뜀 · 손으로 돌린 실패는 분모에도 장애에도 없다", [r.runs, r.ok, r.incidents.length], [2, 2, 0])
check("거부: 센 회차가 없으면 가동률은 0 이 아니라 null", summarizeUptime([run("00:00", "cancelled")]).ratio, null)

console.log(fail ? `\n✗ ${fail}건 실패` : "\n✓ 전부 통과")
process.exit(fail ? 1 : 0)
