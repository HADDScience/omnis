// 운영 KPI 내보내기 — 대시보드에 올릴 JSON. 읽기만 한다.
//   npx tsx --env-file=<환경 파일> scripts/kpi-export.ts --from 2026-09-02 [--to 2026-10-15] --out kpi.json [--compute]
//
// 기본은 쌓인 KpiDaily 를 읽는다. --compute 는 원본 표에서 바로 계산한다(쓰지 않는다) — 쌓인 값과 대조하거나,
// 카톡 이식처럼 지난 날짜에 나중에 행이 들어오는 지표의 최종값을 볼 때 쓴다. 「지금 열린 업무」 같은 상태는
// 마지막 날에만 넣는다(계산하는 순간의 상태라서).
//
// 무엇이든 실패하면 non-zero 로 끝난다. 예전에는 이력 표를 못 읽으면 이력 지표를 빼고 「성공」했는데,
// 낡은 클라이언트에서 그 길로 빠져 지표 4종이 소리 없이 사라졌다(2026-10-21, 264칸 vs 276칸).
import { writeFileSync } from "node:fs"

const { assertKpiClient, computeDailyKpis, eventsSince, kstDay } = await import("../lib/kpi")
const { prisma } = await import("../lib/db")
assertKpiClient()

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const from = arg("--from")
const to = arg("--to") ?? kstDay(new Date(Date.now() - 86_400_000))
const out = arg("--out")
if (!from || !out) throw new Error("--from YYYY-MM-DD --out <파일> 이 필요하다")

type Row = { day: string; key: string; value: number; detail: unknown }
const rows: Row[] = []
const next = (d: string) => kstDay(new Date(new Date(`${d}T12:00:00+09:00`).getTime() + 86_400_000))

if (process.argv.includes("--compute")) {
  const since = await eventsSince()
  for (let d = from; d <= to; d = next(d)) {
    const kpis = await computeDailyKpis(d, { withEvents: since !== null && d >= since, withSnapshot: d === to })
    for (const r of kpis) rows.push({ day: d, key: r.key, value: r.value, detail: r.detail ?? null })
  }
} else {
  const kept = await prisma.kpiDaily.findMany({
    where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: [{ day: "asc" }, { key: "asc" }],
  })
  for (const r of kept) rows.push({ day: r.day.toISOString().slice(0, 10), key: r.key, value: r.value, detail: r.detail })
}

writeFileSync(out, JSON.stringify(rows))
console.log(`${rows.length}칸 · ${new Set(rows.map((r) => r.day)).size}일 → ${out}`)
await prisma.$disconnect()
export {}
