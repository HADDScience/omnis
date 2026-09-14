// 카드 제안을 업무 하나로 직접 돌려 본다 (화면 없이).
//
//   npx tsx scripts/try-card-proposal.ts [--task <이름 일부>] [--apply]
//
// --apply 없이는 제안만 만들고 지운다. 붙여서 돌리면 제안을 남긴다.
import "dotenv/config"
import { prisma } from "@/lib/db"
import { proposeFromTask, acceptanceStats } from "@/lib/card-proposals"

const args = process.argv.slice(2)
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const keep = args.includes("--apply")

async function main() {
  const q = opt("--task")
  const task = await prisma.task.findFirst({
    where: { ...(q ? { name: { contains: q } } : {}), messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, status: true, _count: { select: { messages: true } } },
  })
  if (!task) throw new Error("대화가 있는 업무를 찾지 못했습니다")
  console.log(`업무: ${task.name} (${task.status}, 메시지 ${task._count.messages})`)

  const before = await acceptanceStats()
  console.log(`수락률 전: ${before.decided}건 판단 · 자동=${before.auto}`)

  const t0 = Date.now()
  const r = await proposeFromTask(task.id, { trigger: "manual" })
  console.log(`결과: 제안 ${r.created}건${r.skipped ? ` (건너뜀: ${r.skipped})` : ""} · ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const ps = await prisma.cardProposal.findMany({ where: { triggerTaskId: task.id }, orderBy: { createdAt: "desc" } })
  for (const p of ps) {
    console.log(`\n── [${p.status}] ${p.title}`)
    console.log(`   이유: ${p.reason}`)
    console.log(`   대상: ${p.cardId ? "기존 카드 " + p.cardId : "새 카드"}`)
    const secs = (p.content as { sections?: { title: string; body: string }[] }).sections ?? []
    for (const s of secs) console.log(`   ### ${s.title}\n   ${s.body.replace(/\n/g, "\n   ").slice(0, 400)}`)
  }

  if (!keep && ps.length > 0) {
    await prisma.cardProposal.deleteMany({ where: { triggerTaskId: task.id } })
    console.log("\n(--apply 가 없어 제안을 지웠습니다)")
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
