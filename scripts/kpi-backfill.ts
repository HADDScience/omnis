// 운영 KPI 백필 — 하루 크론이 생기기 전 날짜를 채운다.
//   npx tsx --env-file=.env scripts/kpi-backfill.ts --from 2026-09-02 [--to 2026-10-15] [--dry]
//
// 원재료가 이미 있는 지표(메시지 · 업무 생성 · 알림 · AI 호출)만 채운다. 업무 변경 이력으로 세는 지표는
// 이력이 쌓이기 시작한 날부터만 넣고, 계산하는 순간의 상태(열린 업무 수 등)는 지난 날로 되살릴 수 없어 넣지 않는다.
// GeminiUsage 기록이 2026-09-02 부터라 그보다 앞은 AI 지표가 0 으로 나온다.
const { computeDailyKpis, saveDailyKpis, eventsSince, kstDay } = await import("../lib/kpi")
const { prisma } = await import("../lib/db")

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const from = arg("--from")
const to = arg("--to") ?? kstDay(new Date(Date.now() - 86_400_000))
const dry = process.argv.includes("--dry")
if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  throw new Error("--from YYYY-MM-DD [--to YYYY-MM-DD] 가 필요하다")
}

const since = await eventsSince()
let days = 0
let cells = 0
for (let d = from; d <= to; d = kstDay(new Date(new Date(`${d}T12:00:00+09:00`).getTime() + 86_400_000))) {
  const rows = await computeDailyKpis(d, { withEvents: since !== null && d >= since, withSnapshot: false })
  if (!dry) await saveDailyKpis(d, rows)
  days++
  cells += rows.length
  const pick = (k: string) => rows.find((r) => r.key === k)?.value ?? "-"
  console.log(`${d}  사람 ${pick("users.active")} · 직접 ${pick("messages.native")} · 이식 ${pick("messages.imported")} · 연결 ${pick("messages.linkedRate")} · AI ${pick("ai.calls")}회`)
}
console.log(`${dry ? "(쓰지 않음) " : ""}${days}일 · ${cells}칸 — 이력 지표는 ${since ?? "아직 이력 없음"}부터`)
await prisma.$disconnect()
export {}
