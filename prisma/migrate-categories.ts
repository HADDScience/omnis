import { PrismaClient } from "../generated/prisma/client"

const prisma = new PrismaClient()

/**
 * 기존 8개 카테고리를 3개로 축약:
 * - 기업정보: 기업 개요, 매출 현황, 제품 정보, 경쟁사 분석, 시장 동향
 * - 인력현황: 인력 현황
 * - 지식재산권: 기술 현황, 인증 현황
 */
async function main() {
  // 매핑: 기존 카테고리 → 새 카테고리
  const mergeMap: Record<string, string> = {
    "기업 개요": "기업정보",
    "매출 현황": "기업정보",
    "제품 정보": "기업정보",
    "경쟁사 분석": "기업정보",
    "시장 동향": "기업정보",
    "인력 현황": "인력현황",
    "기술 현황": "지식재산권",
    "인증 현황": "지식재산권",
  }

  const newCategories = [
    { name: "기업정보", icon: "🏢", sortOrder: 1 },
    { name: "인력현황", icon: "👥", sortOrder: 2 },
    { name: "지식재산권", icon: "📜", sortOrder: 3 },
  ]

  // 1. 새 카테고리 생성 (이미 있으면 skip)
  for (const cat of newCategories) {
    await prisma.omnisCategory.upsert({
      where: { name: cat.name },
      update: { icon: cat.icon, sortOrder: cat.sortOrder },
      create: cat,
    })
  }
  console.log("✓ 새 카테고리 3개 생성/업데이트 완료")

  // 2. 기존 카테고리의 카드를 새 카테고리로 이동
  const existingCategories = await prisma.omnisCategory.findMany({
    include: { cards: true },
  })

  for (const cat of existingCategories) {
    const targetName = mergeMap[cat.name]
    if (!targetName || targetName === cat.name) continue

    const target = existingCategories.find((c) => c.name === targetName)
      ?? await prisma.omnisCategory.findUnique({ where: { name: targetName } })

    if (!target) continue

    if (cat.cards.length > 0) {
      await prisma.omnisCard.updateMany({
        where: { categoryId: cat.id },
        data: { categoryId: target.id },
      })
      console.log(`  → "${cat.name}" → "${targetName}": ${cat.cards.length}개 카드 이동`)
    }
  }

  // 3. 빈 구 카테고리 삭제
  const oldNames = Object.keys(mergeMap).filter((n) => !newCategories.some((c) => c.name === n))
  for (const name of oldNames) {
    const cat = await prisma.omnisCategory.findUnique({ where: { name } })
    if (!cat) continue
    const cardCount = await prisma.omnisCard.count({ where: { categoryId: cat.id } })
    if (cardCount === 0) {
      await prisma.omnisCategory.delete({ where: { id: cat.id } })
      console.log(`  ✗ "${name}" 삭제`)
    } else {
      console.log(`  ⚠ "${name}" 카드 ${cardCount}개 남음 — 수동 확인 필요`)
    }
  }

  console.log("✓ 카테고리 마이그레이션 완료")
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
