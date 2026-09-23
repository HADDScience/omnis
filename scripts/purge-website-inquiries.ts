/**
 * 홈페이지 문의의 보관기간을 집행한다 — **접수일로부터 3년**.
 *
 * 개인정보처리방침에 "3년 뒤 파기한다" 고 적는 이상 실제로 지우는 것이 있어야 한다.
 * 방침만 쓰고 지우지 않으면 지키지 못할 약속이 된다.
 *
 * 두 갈래로 다르게 다룬다:
 *
 * - `NEW` · `REJECTED` · `SPAM` — **행째로 지운다.** CRM 으로 가지 않았으므로 남길 근거가 없다.
 * - `ACCEPTED` — 행은 남기고 **사람에 관한 것만 비운다.** 기관·담당자·견적으로 옮겨 갔고 그쪽은
 *   거래 기록으로서 상법·국세기본법의 기간을 따로 따른다. 문의함 행까지 지우면 「사람이
 *   승인했다」 는 사실과 그 시각이 사라진다 — orgId 를 FK + SetNull 로 둔 것과 같은 방향이다.
 *
 * `reviewNote` 도 비운다. 담당자가 자유롭게 쓰는 칸이라 「전화로 통화, 김OO 교수」 처럼
 * 방문자 개인정보가 들어갈 수 있다. 「왜 그렇게 처리했는가」 는 이어진 견적·샘플요청의
 * note 에 남고, 「사람이 언제 처리했는가」 는 status·reviewedAt 이 지킨다.
 *
 * 크론이 없어 손으로 돌린다. 한 해에 몇 번 돌릴 일이라 스케줄러를 붙이지 않았다.
 *
 *   npx tsx scripts/purge-website-inquiries.ts           # 무엇이 지워질지만 보여준다
 *   npx tsx scripts/purge-website-inquiries.ts --apply   # 실제로 지운다
 */
import "dotenv/config"
import { prisma } from "../lib/db"

/** 작업지시자 확정(2026-09-22). 전자상거래법의 소비자 불만·분쟁처리 기록 보관기간과 같은 길이. */
const RETENTION_YEARS = 3

const apply = process.argv.includes("--apply")

const cutoff = new Date()
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS)

const target = new URL(process.env.DATABASE_URL!)
console.log(`대상: ${target.hostname}${target.pathname}`)
console.log(`기준: ${cutoff.toISOString().slice(0, 10)} 이전 접수분 (${RETENTION_YEARS}년)`)
console.log(apply ? "모드: 적용\n" : "모드: 미리보기 (--apply 를 붙이면 실제로 지운다)\n")

try {
  const where = { createdAt: { lt: cutoff } }

  const doomed = await prisma.websiteInquiry.count({
    where: { ...where, status: { in: ["NEW", "REJECTED", "SPAM"] } },
  })
  // 이미 비운 것을 다시 세지 않는다 — email 이 빈 문자열인 행이 처리 끝난 표시다.
  // (빈 이메일은 접수 단계에서 막히므로 실제 문의가 여기 걸리는 일은 없다)
  const toRedact = await prisma.websiteInquiry.count({
    where: { ...where, status: "ACCEPTED", email: { not: "" } },
  })

  console.log(`  삭제 대상 (NEW·REJECTED·SPAM): ${doomed}건`)
  console.log(`  개인정보만 비울 대상 (ACCEPTED): ${toRedact}건`)

  if (!apply) {
    console.log("\n아무것도 바꾸지 않았습니다.")
  } else {
    const deleted = await prisma.websiteInquiry.deleteMany({
      where: { ...where, status: { in: ["NEW", "REJECTED", "SPAM"] } },
    })
    const redacted = await prisma.websiteInquiry.updateMany({
      where: { ...where, status: "ACCEPTED", email: { not: "" } },
      data: {
        name: "(파기됨)",
        organization: null,
        email: "",
        phone: null,
        message: "(보관기간 경과로 파기)",
        ip: null,
        userAgent: null,
        reviewNote: null,
      },
    })
    console.log(`\n삭제 ${deleted.count}건 · 파기 ${redacted.count}건`)
  }
} finally {
  await prisma.$disconnect()
}
