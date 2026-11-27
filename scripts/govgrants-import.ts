/**
 * 수집기 govgrants → GrantNotice — 하루 cron 단계(lib/govgrants-sync.ts)를 손으로 돌린다.
 *
 *   GOVGRANTS_READ_URL=… npx tsx scripts/govgrants-import.ts            # 건식(기본): 옮길 실행 · 새 · 바뀐 칸 · 그대로 건수만. 아무것도 쓰지 않는다
 *   GOVGRANTS_READ_URL=… npx tsx scripts/govgrants-import.ts --apply    # cron 과 똑같이 쓴다(GrantNotice · GovgrantsImport)
 *
 * GOVGRANTS_READ_URL 은 govgrants 스키마만 읽는 역할(govgrants_reader)의 주소다. 만드는 법: mydocs/manual/govgrants-import.md
 * DATABASE_URL 은 GrantNotice 가 있는 옴니스 DB(건식이면 읽기만 한다).
 */
import "dotenv/config"
import { importGovgrants, GOVGRANTS_READ_ENV } from "@/lib/govgrants-sync"
import { prisma } from "@/lib/db"

const APPLY = process.argv.includes("--apply")

async function main() {
  if (!process.env[GOVGRANTS_READ_ENV]) throw new Error(`${GOVGRANTS_READ_ENV} 가 없다 — govgrants 읽기 전용 역할의 주소`)
  const r = await importGovgrants({ dry: !APPLY })
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", ...r }, null, 2))
  if (r.runs.some((x) => !x.ok)) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
