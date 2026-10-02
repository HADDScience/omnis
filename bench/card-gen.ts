// 카드 실험 — 운영과 같은 파이프라인(proposeFromTask → applyProposal)으로 로컬 DB 에 카드를 채운다.
//
//   CARD_MAX_PENDING=100000 npx tsx bench/card-gen.ts [--limit N] [--concurrency 3]
//
// 완료된 업무를 완료 순서(updatedAt)대로 돌려, 운영에서 업무가 끝날 때마다 제안이 생기고
// 사람이 전부 수락했다고 가정한 상태를 만든다. 로컬 DB 에서만 돈다 (localhost 가 아니면 멈춘다).
import "dotenv/config"
import { prisma } from "@/lib/db"
import { proposeFromTask, applyProposal } from "@/lib/card-proposals"

const args = process.argv.slice(2)
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  const url = process.env.DATABASE_URL ?? ""
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("로컬 DB 가 아닙니다 — 멈춥니다")
  // MAX_PENDING 은 모듈을 읽을 때 정해진다 — 여기서 바꾸면 늦다. 실행할 때 env 로 준다.
  if (Number(process.env.CARD_MAX_PENDING ?? 30) < 10000) throw new Error("CARD_MAX_PENDING=100000 을 주고 돌린다 (쌓인 제안 30건에서 멈추지 않게)")

  const limit = Number(opt("--limit") ?? 0)
  const concurrency = Number(opt("--concurrency") ?? 3)
  const started = new Date()

  const tasks = await prisma.task.findMany({
    where: { status: "DONE", messages: { some: {} } },
    orderBy: { updatedAt: "asc" },
    select: { id: true, name: true },
    ...(limit > 0 ? { take: limit } : {}),
  })
  console.log(`업무 ${tasks.length}건 · 동시 ${concurrency}`)

  let i = 0, created = 0, applied = 0
  const skipped: Record<string, number> = {}
  async function worker() {
    while (i < tasks.length) {
      const t = tasks[i++]
      const r = await proposeFromTask(t.id, { trigger: "experiment" })
      if (r.skipped) skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1
      created += r.created
      const pending = await prisma.cardProposal.findMany({ where: { triggerTaskId: t.id, status: "PENDING" }, select: { id: true } })
      for (const p of pending) { const a = await applyProposal(p.id, { auto: true }); if ("cardId" in a) applied++ }
      if (r.created > 0) console.log(`  [${i}/${tasks.length}] ${t.name} → 제안 ${r.created}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  const usage = await prisma.geminiUsage.groupBy({
    by: ["endpoint"], where: { createdAt: { gte: started } },
    _sum: { promptTokens: true, candidateTokens: true }, _count: true,
  })
  console.log(`\n제안 ${created} · 반영 ${applied} · 카드 ${await prisma.omnisCard.count()}장`)
  console.log("건너뜀", skipped)
  console.log("사용량", JSON.stringify(usage))
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
