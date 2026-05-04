import { PrismaClient } from "../generated/prisma/client"

const prisma = new PrismaClient()

async function main() {
  // 1. Fetch categories and products
  const categories = await prisma.taskCategory.findMany()
  const products = await prisma.product.findMany()

  const catMap = Object.fromEntries(categories.map((c) => [c.name, c.id]))
  const prodMap = Object.fromEntries(products.map((p) => [p.name, p.id]))

  // ─── 프로젝트 → 제품 매핑 ─────────────────────────────
  const projectProductMap: Record<string, string> = {
    "바이오아이코어사업": prodMap["애드젤"],
    "2차 메디바이오 제안서": prodMap["화장품"],
    "화성시 2026년 공급망 확대 사업화 R&D 지원사업": prodMap["뉴로힐"],
    "신진 연구인력 채용지원사업 연구개발계획서": prodMap["애드젤"],
    "뉴로힐 메디바이오 제안서 작성": prodMap["뉴로힐"],
    "의료진단 AI": prodMap["치매진단플랫폼"],
    "2026 중소기업 비즈니스 융합성장 지원사업 신청": prodMap["애드젤"],
  }

  // 프로젝트 제품 연결
  const projects = await prisma.project.findMany()
  let projectUpdated = 0
  for (const proj of projects) {
    const productId = projectProductMap[proj.name]
    if (productId) {
      await prisma.project.update({
        where: { id: proj.id },
        data: { productId },
      })
      projectUpdated++
      console.log(`  프로젝트 "${proj.name}" → ${products.find((p) => p.id === productId)?.name}`)
    }
  }
  console.log(`✓ 프로젝트 ${projectUpdated}개 제품 연결 완료\n`)

  // ─── 업무 → 카테고리 매핑 (키워드 기반) ────────────────
  const categoryRules: { keywords: string[]; category: string }[] = [
    // 연구실험
    { keywords: ["실험", "분석", "합성", "평가", "테스트", "G-peak", "Raman", "organoid", "ISSCR", "그래핀"], category: "연구실험" },
    // 제품개발
    { keywords: ["제품화", "제품개발", "패키지 제작", "ViVOGEL", "Syringe type", "피부-화장품"], category: "제품개발" },
    // 과제펀딩
    { keywords: ["과제", "지원사업", "리스트업", "제안서", "사업계획서", "서식", "신청서", "연구개발계획서", "기대효과", "바이오아이코어", "초기창업패키지", "바이오의료기술", "치매극복", "메디바이오", "차별성 검토", "실증 목표", "현황표", "소부장"], category: "과제펀딩" },
    // 인허가 특허
    { keywords: ["인증", "인허가", "상표권", "특허", "IP 나래", "지적 재산권"], category: "인허가 특허" },
    // 학회 발표
    { keywords: ["학회", "포스터", "PPT 만들기", "발표"], category: "학회 발표" },
    // 사업화
    { keywords: ["판매", "출시", "시장", "영업", "사업화", "리플렛", "명함", "시안 제작", "홍보", "현수막", "회사소개", "재고", "출고", "공급망", "인포그래픽", "영업망", "경쟁력", "고도화", "먼데이피칭", "예시안"], category: "사업화" },
    // 교육 네트워크
    { keywords: ["교육", "NEXT Bio", "행사 참여"], category: "교육 네트워크" },
    // 행정 관리
    { keywords: ["대시보드", "노션", "옴니스", "DB 구축", "비품", "택배", "떡", "차량", "모니터", "파일 정리", "성과 엑셀", "문서화", "복구", "주소 변경", "스킬 ID", "To Do", "파일 재검토", "결과 정리"], category: "행정 관리" },
  ]

  function matchCategory(taskName: string): string | null {
    for (const rule of categoryRules) {
      for (const keyword of rule.keywords) {
        if (taskName.includes(keyword)) {
          return rule.category
        }
      }
    }
    return null
  }

  // 업무 카테고리 매핑
  const tasks = await prisma.task.findMany()
  let taskUpdated = 0
  let taskSkipped = 0

  for (const task of tasks) {
    const categoryName = matchCategory(task.name)
    if (categoryName && catMap[categoryName]) {
      await prisma.task.update({
        where: { id: task.id },
        data: { categoryId: catMap[categoryName] },
      })
      taskUpdated++
    } else {
      taskSkipped++
      console.log(`  ⚠ 매칭 실패: "${task.name}"`)
    }
  }

  console.log(`\n✓ 업무 ${taskUpdated}개 카테고리 배정 완료`)
  console.log(`  ⚠ ${taskSkipped}개 매칭 실패 (수동 확인 필요)`)

  // 결과 요약
  console.log("\n─── 카테고리별 업무 수 ───")
  for (const cat of categories) {
    const count = await prisma.task.count({ where: { categoryId: cat.id } })
    console.log(`  ${cat.name}: ${count}개`)
  }

  const unassigned = await prisma.task.count({ where: { categoryId: null } })
  console.log(`  미배정: ${unassigned}개`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
