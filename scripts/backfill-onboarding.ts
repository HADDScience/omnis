/** No-op backfill: nullable columns deliberately leave existing accounts unseen.
 * Run after migration to check that completion never exists without a video marker.
 * Existing completed records must never be cleared by a re-run.
 */
import "dotenv/config"
import { prisma } from "../lib/db"

const target = new URL(process.env.DATABASE_URL!)
console.log(`대상: ${target.hostname}:${target.port || "5432"}${target.pathname}`)
if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) throw new Error("이 검증은 로컬 DB에서 실행하세요.")
try {
  const inconsistent = await prisma.user.count({ where: { onboardingCompletedAt: { not: null }, onboardingVideoSeenAt: null } })
  if (inconsistent) throw new Error(`잘못된 온보딩 상태 ${inconsistent}건`)
  console.log("온보딩 백필: 기존 계정 NULL 유지, 기존 완료 기록 보존. 잘못된 상태 0건.")
} finally { await prisma.$disconnect() }
