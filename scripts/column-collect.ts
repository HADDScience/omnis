/**
 * 칼럼 키워드 후보 수집을 관리 화면 없이 돌린다. 2단계 dry-run 품질·사용량 확인용.
 *
 *   npx tsx scripts/column-collect.ts [--dry-run] [--out report.json]
 *
 * --dry-run: 칼럼 테이블을 읽지도 쓰지도 않는다. 운영 DB(마이그레이션 전)에서 라이브러리 글만 읽어 돌릴 수 있다.
 * 사용자는 정우창으로 기록한다(Gemini 사용량 귀속).
 */
import "dotenv/config"
import fs from "node:fs"

import { prisma } from "../lib/db"
import { collectKeywords } from "../lib/column/collect"

const args = process.argv.slice(2)
const out = args.indexOf("--out") >= 0 ? args[args.indexOf("--out") + 1] : undefined

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[:/].*$/, "")
  console.log(`DB 대상: ${host}`)
  const user = await prisma.user.findUnique({ where: { name: "정우창" }, select: { id: true } })
  if (!user) throw new Error("사용자 정우창 없음")
  const r = await collectKeywords({ userId: user.id, dryRun: args.includes("--dry-run") })
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2))
  console.log(`헤드라인 ${r.items}건 · 후보 ${r.candidates.length}건 · 버림 ${r.dropped.length}건`)
  console.log(`벽시계 ${r.durationMs}ms · CPU ${r.cpuMs}ms · 단계 ${JSON.stringify(r.timings)}`)
  for (const f of r.results) console.log(`  피드 ${f.ok ? "ok " : "실패"} ${String(f.fetched).padStart(3)} ${f.feed}${f.error ? ` (${f.error})` : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
