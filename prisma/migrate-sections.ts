import { PrismaClient } from "../generated/prisma/client"

const prisma = new PrismaClient()

/**
 * 기존 text-only 카드를 sections 배열 형식으로 변환
 * { text: "...", status: "..." } → { status: "...", sections: [{ type: "text", ... }] }
 */
async function main() {
  const cards = await prisma.omnisCard.findMany()
  let migrated = 0
  let skipped = 0

  for (const card of cards) {
    const content = card.content as Record<string, unknown> | null
    if (!content) {
      skipped++
      continue
    }

    // 이미 sections가 있으면 skip
    if (Array.isArray(content.sections)) {
      skipped++
      continue
    }

    const sections: unknown[] = []

    if (typeof content.text === "string" && content.text.trim()) {
      sections.push({
        id: crypto.randomUUID(),
        type: "text",
        title: "내용",
        body: content.text,
      })
    }

    const newContent: Record<string, unknown> = {
      sections,
      text: content.text, // git 호환용 유지
    }
    if (typeof content.status === "string") newContent.status = content.status

    await prisma.omnisCard.update({
      where: { id: card.id },
      data: { content: newContent as never },
    })

    migrated++
    console.log(`  ✓ "${card.title}" → ${sections.length}개 섹션`)
  }

  console.log(`\n✓ 마이그레이션 완료: ${migrated}개 변환, ${skipped}개 스킵`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
