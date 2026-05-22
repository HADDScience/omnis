/**
 * 임베딩 백필 — 기존 옴니스 카드·업무·주간보고·채팅을 EmbeddingChunk에 채운다.
 * 실행: npm run db:embed
 *
 * 멱등(idempotent): contentHash 비교로 이미 임베딩된 항목은 Gemini 호출을 건너뛴다.
 * 중간에 일부가 실패(예: rate limit)하면 다시 실행하면 남은 것만 처리된다.
 */
import "dotenv/config"
import { prisma } from "../lib/db"
import { syncEmbeddings, type EmbeddingSource } from "../lib/embeddings"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function run(
  label: string,
  source: EmbeddingSource,
  ids: string[]
): Promise<void> {
  console.log(`\n▶ ${label}: ${ids.length}건`)
  let ok = 0
  let fail = 0
  for (let i = 0; i < ids.length; i++) {
    try {
      await syncEmbeddings(source, ids[i])
      ok++
    } catch (err) {
      fail++
      console.error(
        `  ✗ ${source}:${ids[i]}`,
        err instanceof Error ? err.message : err
      )
    }
    if ((i + 1) % 10 === 0 || i === ids.length - 1) {
      console.log(`  ${i + 1}/${ids.length} (성공 ${ok}, 실패 ${fail})`)
    }
    // Gemini 무료 티어 rate limit 보호
    await sleep(300)
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)")
  }
  console.log("임베딩 백필 시작 — 변경분만 재임베딩(해시 비교)")

  const cards = await prisma.omnisCard.findMany({ select: { id: true } })
  await run(
    "옴니스 카드",
    "OMNIS_CARD",
    cards.map((c) => c.id)
  )

  const tasks = await prisma.task.findMany({
    where: { archived: false },
    select: { id: true },
  })
  await run(
    "업무",
    "TASK",
    tasks.map((t) => t.id)
  )

  const reports = await prisma.weeklyReport.findMany({ select: { id: true } })
  await run(
    "주간보고",
    "WEEKLY_REPORT",
    reports.map((r) => r.id)
  )

  const messages = await prisma.chatMessage.findMany({
    where: { kind: "NORMAL" },
    select: { id: true },
  })
  await run(
    "채팅 메시지",
    "CHAT_MESSAGE",
    messages.map((m) => m.id)
  )

  const total = await prisma.embeddingChunk.count()
  console.log(`\n✅ 백필 완료 — EmbeddingChunk 총 ${total}개`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
