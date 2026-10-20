// 청구처 백필 — 아는 쌍만 채운다 (2026-10-20, plans/2026-10-20-crm-billing-org.md).
//
//   npx tsx scripts/backfill-billing-org.ts                       로컬, 바꿀 것만 찍는다
//   npx tsx scripts/backfill-billing-org.ts --apply               로컬에 쓴다
//   npx tsx scripts/backfill-billing-org.ts --target prod [--apply]
//
// 나머지 기관은 비워 둔다 — 비어 있으면 청구처가 자기 자신이다. 이름 유사도로 쌍을 추정하지 않는다.
// 계산서를 견적에 다시 잇는 일은 하지 않는다. 견적 상세의 「이 세금계산서가 맞아요」 로 사람이 한다.
import "dotenv/config"
import { existsSync, readFileSync } from "fs"

const args = process.argv.slice(2)
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const target = flag("--target") ?? "local"
const apply = args.includes("--apply")

/** [견적 받는 기관, 청구처] — 기관 이름 그대로 */
const PAIRS: [string, string][] = [["가천대 의과대학", "가천대학교 산학협력단"]]

if (target === "prod") {
  const envFile = ".env.production.local"
  if (!existsSync(envFile)) throw new Error(`${envFile} 없음`)
  const env = Object.fromEntries(
    readFileSync(envFile, "utf-8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] }),
  )
  if (!env.POSTGRES_URL_NON_POOLING?.includes("neon.tech")) throw new Error("프로덕션 DB 주소가 아니다")
  process.env.DATABASE_URL = env.POSTGRES_URL_NON_POOLING
} else if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  throw new Error("로컬 대상인데 DATABASE_URL 이 localhost 가 아니다")
}

const { prisma } = await import("../lib/db")
const { billingOrgProblem } = await import("../lib/crm")

async function main() {
  console.log(`대상 ${target}${apply ? "" : " — 찍기만 (--apply 없음)"}`)
  for (const [fromName, toName] of PAIRS) {
    const [from, to] = await Promise.all([
      prisma.crmOrg.findUnique({ where: { name: fromName }, select: { id: true, billingOrgId: true } }),
      prisma.crmOrg.findUnique({ where: { name: toName }, select: { id: true, billingOrgId: true } }),
    ])
    if (!from || !to) {
      console.log(`- 건너뜀 ${fromName} → ${toName}: ${!from ? fromName : toName} 기관이 없다`)
      continue
    }
    if (from.billingOrgId === to.id) {
      console.log(`= 이미 ${fromName} → ${toName}`)
      continue
    }
    if (from.billingOrgId) {
      console.log(`- 건너뜀 ${fromName}: 다른 청구처가 이미 있다 (${from.billingOrgId}) — 사람이 본다`)
      continue
    }
    const billed = await prisma.crmOrg.count({ where: { billingOrgId: from.id } })
    const problem = billingOrgProblem(from.id, to, billed > 0)
    if (problem) {
      console.log(`- 건너뜀 ${fromName} → ${toName}: ${problem}`)
      continue
    }
    if (apply) await prisma.crmOrg.update({ where: { id: from.id }, data: { billingOrgId: to.id } })
    console.log(`${apply ? "✓ 채움" : "→ 채울 것"} ${fromName} → ${toName}`)
  }
  const filled = await prisma.crmOrg.count({ where: { billingOrgId: { not: null } } })
  console.log(`청구처가 채워진 기관 ${filled} / 전체 ${await prisma.crmOrg.count()}`)
}
main().finally(() => prisma.$disconnect())
