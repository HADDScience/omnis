// 첫 화면 「지금 할 일」 — trigger 별 클릭률 비교(정책 5번: 2주 뒤 하루 1회 / 지금대로 / AI 빼기 중 하나로 정한다). 읽기만 한다.
//   npx tsx --env-file=<환경 파일> scripts/home-suggestions-report.ts [--days 14]
//
// 줄 하나 = (trigger, source). source 가 code 인 줄은 AI 없이 코드 순서로 보인 것(30분 안 · 한도 · AI 실패)이라
// 「AI 빼기」 의 대조군으로 쓴다. 클릭률 = 클릭 / 노출(같은 실행 · 같은 카드는 한 번씩만 센다).
export {}
const { prisma } = await import("../lib/db")

const i = process.argv.indexOf("--days")
const days = i > 0 ? Number(process.argv[i + 1]) : 14
if (!Number.isFinite(days) || days <= 0) throw new Error("--days 는 양수")
const since = new Date(Date.now() - days * 86_400_000)

type Row = { trigger: string; source: string; runs: number; users: number; candidates: number; costKrw: number; impressions: number; clicks: number }
const rows = await prisma.$queryRaw<Row[]>`
  WITH r AS (
    SELECT "trigger", "source", COUNT(*)::int AS runs, COUNT(DISTINCT "userId")::int AS users,
           COALESCE(AVG("candidateCount"), 0)::float AS candidates, COALESCE(SUM("costKrw"), 0)::float AS "costKrw"
    FROM "HomeSuggestionRun" WHERE "createdAt" >= ${since} GROUP BY 1, 2
  ), e AS (
    SELECT "trigger", "source",
           COUNT(*) FILTER (WHERE "kind" = 'impression')::int AS impressions,
           COUNT(*) FILTER (WHERE "kind" = 'click')::int AS clicks
    FROM "HomeSuggestionEvent" WHERE "createdAt" >= ${since} GROUP BY 1, 2
  )
  SELECT COALESCE(r."trigger", e."trigger") AS "trigger", COALESCE(r."source", e."source") AS "source",
         COALESCE(r.runs, 0) AS runs, COALESCE(r.users, 0) AS users, COALESCE(r.candidates, 0) AS candidates, COALESCE(r."costKrw", 0) AS "costKrw",
         COALESCE(e.impressions, 0) AS impressions, COALESCE(e.clicks, 0) AS clicks
  FROM r FULL JOIN e ON r."trigger" = e."trigger" AND r."source" = e."source"
  ORDER BY 1, 2`

console.log(`최근 ${days}일 (${since.toISOString().slice(0, 10)} ~)`)
console.log("| trigger | source | 실행 | 사람 | 평균 후보 | 비용(원) | 노출 | 클릭 | 클릭률 |")
console.log("|---|---|---|---|---|---|---|---|---|")
for (const r of rows) {
  const ctr = r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(1)}%` : "-"
  console.log(`| ${r.trigger} | ${r.source} | ${r.runs} | ${r.users} | ${r.candidates.toFixed(1)} | ${Math.round(r.costKrw)} | ${r.impressions} | ${r.clicks} | ${ctr} |`)
}
await prisma.$disconnect()
