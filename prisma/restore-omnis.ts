import { PrismaClient } from "../generated/prisma/client"
import { readFileSync, readdirSync } from "fs"
import path from "path"

const prisma = new PrismaClient()

async function main() {
  const omniDir = path.join(process.cwd(), "data", "omnis")
  const files = readdirSync(omniDir).filter((f) => f.endsWith(".md"))

  // 카테고리 매핑
  const categoryMap: Record<string, string> = {
    "기업-개요": "기업정보",
    "재무-현황": "기업정보",
    "주요-제품-서비스": "기업정보",
    "타겟-시장": "기업정보",
    "회사-로고": "기업정보",
    "직원-정보": "인력현황",
    "대표님-이력": "인력현황",
    "addgel-기술-상세": "지식재산권",
    "pdrn-화장품-기술-상세": "지식재산권",
    "뉴로힐-의료기기": "지식재산권",
    "보유-인증-현황": "지식재산권",
    "연구시설-현황": "지식재산권",
    "가점항목-리스트": "기업정보",
    "과제-리스트": "기업정보",
    "지원사업-추진-이력": "기업정보",
  }

  const categories = await prisma.omnisCategory.findMany()
  let restored = 0

  for (const file of files) {
    const slug = file.replace(/_[a-f0-9]+\.md$/, "")
    const text = readFileSync(path.join(omniDir, file), "utf-8")

    // 제목 추출: slug을 한국어 제목으로 변환
    const titleMap: Record<string, string> = {
      "기업-개요": "기업 개요",
      "재무-현황": "재무 현황",
      "주요-제품-서비스": "주요 제품·서비스",
      "타겟-시장": "타겟 시장",
      "회사-로고": "회사 로고",
      "직원-정보": "직원 정보",
      "대표님-이력": "대표님 이력",
      "addgel-기술-상세": "ADDGEL 기술 상세",
      "pdrn-화장품-기술-상세": "PDRN 화장품 기술 상세",
      "뉴로힐-의료기기": "뉴로힐 의료기기",
      "보유-인증-현황": "보유 인증 현황",
      "연구시설-현황": "연구시설 현황",
      "가점항목-리스트": "가점항목 리스트",
      "과제-리스트": "과제 리스트",
      "지원사업-추진-이력": "지원사업 추진 이력",
    }

    const title = titleMap[slug] ?? slug.replace(/-/g, " ")
    const catName = categoryMap[slug] ?? "기업정보"
    const category = categories.find((c) => c.name === catName)
    if (!category) {
      console.log(`  ⚠ 카테고리 "${catName}" 없음 — "${title}" 스킵`)
      continue
    }

    // 이미 존재하면 스킵
    const existing = await prisma.omnisCard.findFirst({ where: { title } })
    if (existing) {
      console.log(`  → "${title}" 이미 존재 — 스킵`)
      continue
    }

    await prisma.omnisCard.create({
      data: {
        categoryId: category.id,
        title,
        content: {
          sections: [{ id: crypto.randomUUID(), type: "text", title: "내용", body: text }],
          text,
        },
        tags: [],
      },
    })

    restored++
    console.log(`  ✓ "${title}" → ${catName}`)
  }

  console.log(`\n✓ 복원 완료: ${restored}개 카드`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
