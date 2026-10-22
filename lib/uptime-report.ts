// 가동률 장부(.github/workflows/uptime.yml 의 실행 기록)를 숫자로 바꾼다. scripts/uptime-report.ts 가 부른다.
// 정의는 mydocs/plans/2026-10-22-ops-metrics.md 의 「가동률」 절.

export interface UptimeRun {
  created_at: string
  /** completed 가 아니면 세지 않는다 */
  status: string
  /** success · failure 만 센다. cancelled · skipped 등은 측정이 안 된 회차다 */
  conclusion: string | null
  /** schedule 만 센다. 손으로 돌린 회차(workflow_dispatch)는 장애를 의심할 때 몰려서 분모를 흐린다 */
  event: string
}

export interface Incident {
  start: string
  /** 처음 다시 성공한 회차. 아직 실패 중이면 null */
  end: string | null
  failedRuns: number
  minutes: number | null
}

export interface UptimeSummary {
  runs: number
  ok: number
  /** 0~1. 센 회차가 없으면 null */
  ratio: number | null
  first: string | null
  last: string | null
  incidents: Incident[]
}

export function summarizeUptime(all: UptimeRun[]): UptimeSummary {
  const runs = all
    .filter((r) => r.event === "schedule" && r.status === "completed" && (r.conclusion === "success" || r.conclusion === "failure"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const incidents: Incident[] = []
  let open: Incident | null = null
  for (const r of runs) {
    if (r.conclusion === "failure") {
      if (open) open.failedRuns++
      else open = { start: r.created_at, end: null, failedRuns: 1, minutes: null }
    } else if (open) {
      open.end = r.created_at
      open.minutes = Math.round((Date.parse(r.created_at) - Date.parse(open.start)) / 60_000)
      incidents.push(open)
      open = null
    }
  }
  if (open) incidents.push(open)

  const ok = runs.filter((r) => r.conclusion === "success").length
  return {
    runs: runs.length,
    ok,
    ratio: runs.length ? ok / runs.length : null,
    first: runs[0]?.created_at ?? null,
    last: runs.at(-1)?.created_at ?? null,
    incidents,
  }
}
