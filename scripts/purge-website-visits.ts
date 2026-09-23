/**
 * 홈페이지 방문 통계의 보관기간을 집행한다 — **400일**.
 *
 * 값의 출처는 `mydocs/plans/2026-09-22-website-visit-stats.md` 다: 작년 같은 달과 비교하려면
 * 1년 + 여유가 필요하다. 사이트 개인정보처리방침이 이 숫자를 그대로 적고 있으므로,
 * 방침이 지키지 못할 약속이 되지 않게 실제로 지우는 것이 있어야 한다.
 *
 * **행째 지운다.** 문의(`purge-website-inquiries.ts`)와 다른 점이다 — 거기에는 「사람이
 * 승인했다」 는 사실이 남아야 했지만 방문 기록에는 지킬 것이 없다. 미리 말아 둔 집계 표도
 * 없어서(`lib/website-visits.ts` 의 통계는 전부 원시 행에서 그때그때 센다) 행을 지우면
 * 그 기간의 숫자도 함께 사라진다. 그것이 보관기간의 뜻이다.
 *
 * 여기 지우는 것에 IP 도 UA 도 쿠키도 없다. 방문자 구분은 사이트가 만든 하루짜리 해시뿐이다.
 *
 * 크론을 붙이지 않았다 — 한 해에 몇 번 돌릴 일이다.
 *
 *   npx tsx scripts/purge-website-visits.ts           # 무엇이 지워질지만 보여준다
 *   npx tsx scripts/purge-website-visits.ts --apply   # 실제로 지운다
 */
import "dotenv/config"
import { prisma } from "../lib/db"

/** `mydocs/plans/2026-09-22-website-visit-stats.md` 가 정한 값. 사이트 방침도 이 숫자를 쓴다. */
const RETENTION_DAYS = 400

const apply = process.argv.includes("--apply")

const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)

const target = new URL(process.env.DATABASE_URL!)
console.log(`대상: ${target.hostname}${target.pathname}`)
console.log(`기준: ${cutoff.toISOString().slice(0, 10)} 이전 방문 (${RETENTION_DAYS}일)`)
console.log(apply ? "모드: 적용\n" : "모드: 미리보기 (--apply 를 붙이면 실제로 지운다)\n")

try {
  const where = { at: { lt: cutoff } }

  const doomed = await prisma.websiteVisit.count({ where })
  const total = await prisma.websiteVisit.count()
  // 가장 오래된 행이 언제인지 함께 보여 준다 — 「0건」 이 기준이 맞아서인지
  // 데이터가 아예 없어서인지 구분된다
  const oldest = await prisma.websiteVisit.findFirst({
    orderBy: { at: "asc" },
    select: { at: true },
  })

  console.log(`  전체 ${total}건 · 가장 오래된 방문 ${oldest?.at.toISOString().slice(0, 10) ?? "(없음)"}`)
  console.log(`  삭제 대상: ${doomed}건`)

  if (!apply) {
    console.log("\n아무것도 바꾸지 않았습니다.")
  } else {
    const deleted = await prisma.websiteVisit.deleteMany({ where })
    console.log(`\n삭제 ${deleted.count}건 · 남은 ${await prisma.websiteVisit.count()}건`)
  }
} finally {
  await prisma.$disconnect()
}
