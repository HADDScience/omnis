// 빈 카드 서랍을 채우는 씨앗 배치 — 완료된 업무를 훑어 카드 제안을 만든다.
//
//   npx tsx scripts/seed-card-proposals.ts              # dry-run: 몇 건이 대상인지만
//   npx tsx scripts/seed-card-proposals.ts --apply      # 실제로 제안을 만든다
//   npx tsx scripts/seed-card-proposals.ts --apply --limit 20 --min-messages 5
//
// 왜 필요한가. AI 가 카드를 갱신하려면 갱신할 카드가 있어야 하는데 지금 0장이다.
// 이미 쌓인 업무 대화에서 초기 카드를 뽑아 두면 그 뒤로는 업무 완료 트리거가 유지한다.
// 배경: mydocs/plans/2026-09-10-ai-maintained-cards.md
import "dotenv/config"
import { prisma } from "@/lib/db"
import { proposeFromTask, acceptanceStats, AUTO_APPLY_MIN_DECIDED } from "@/lib/card-proposals"

const args = process.argv.slice(2)
const opt = (k: string, d: number) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d }
const apply = args.includes("--apply")
const LIMIT = opt("--limit", 30)
const MIN_MESSAGES = opt("--min-messages", 4)

async function main() {
  const stats = await acceptanceStats()
  console.log(`지금: 카드 ${await prisma.omnisCard.count()}장 · 미처리 제안 ${stats.pending}건 · 자동반영 ${stats.auto ? "켬" : "끔"}`)
  if (stats.auto) {
    console.log("⚠ 자동 반영이 켜져 있습니다 — 이 배치의 제안이 사람 확인 없이 바로 카드가 됩니다.")
  }

  // 대화가 어느 정도 있는 완료 업무. 이미 제안을 만든 업무는 proposeFromTask 가 스스로 거른다.
  const tasks = await prisma.task.findMany({
    where: {
      status: "DONE",
      archived: false,
      cardProposals: { none: {} },
      messages: { some: {} },
    },
    orderBy: { updatedAt: "desc" },
    take: LIMIT * 3,
    select: { id: true, name: true, _count: { select: { messages: true } } },
  })
  // e2e 시나리오가 만든 업무는 뺀다 — 제목이 `[MMDDHHmm]` 로 시작한다. 시험 자료가 카드가 되면 안 된다.
  const isScenario = (name: string) => /^\[\d{8}\]/.test(name)
  const targets = tasks
    .filter((t) => t._count.messages >= MIN_MESSAGES && !isScenario(t.name))
    .slice(0, LIMIT)

  console.log(`대상 업무 ${targets.length}건 (메시지 ${MIN_MESSAGES}개 이상, 최근 완료순)`)
  if (!apply) {
    for (const t of targets.slice(0, 10)) console.log(`  · ${t.name} (${t._count.messages})`)
    if (targets.length > 10) console.log(`  … 외 ${targets.length - 10}건`)
    console.log("\n--apply 를 붙이면 실제로 제안을 만듭니다.")
    return
  }

  let created = 0
  let skipped = 0
  for (const [i, t] of targets.entries()) {
    const r = await proposeFromTask(t.id, { trigger: "seed" })
    created += r.created
    if (r.created === 0) skipped++
    console.log(`[${i + 1}/${targets.length}] ${t.name.slice(0, 40)} → ${r.created > 0 ? `제안 ${r.created}` : r.skipped}`)
    if (r.skipped?.startsWith("미처리 제안")) {
      console.log("  미처리 제안이 한도에 닿아 멈춥니다. 화면에서 처리한 뒤 다시 돌리세요.")
      break
    }
  }

  const after = await acceptanceStats()
  console.log(`\n제안 ${created}건 생성 · 지식 없음 ${skipped}건`)
  console.log(`미처리 ${after.pending}건. 화면에서 확인하세요: /omnis/proposals`)
  console.log(`자동 반영까지 판단 ${Math.max(AUTO_APPLY_MIN_DECIDED - after.decided, 0)}건 남음`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
