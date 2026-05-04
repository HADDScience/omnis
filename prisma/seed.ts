import "dotenv/config"
import { PrismaClient } from "../generated/prisma/client"
import { hashSync } from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  // ─── 사용자 시드 ─────────────────────────────────────
  const users = [
    { name: "김아리", role: "ADMIN" as const },
    { name: "노혜린", role: "ADMIN" as const },
    { name: "정우창", role: "MEMBER" as const },
    { name: "주용석", role: "MEMBER" as const },
    { name: "박소정", role: "MEMBER" as const },
  ]

  for (const u of users) {
    await prisma.user.upsert({
      where: { name: u.name },
      update: {},
      create: {
        name: u.name,
        role: u.role,
        passwordHash: hashSync(process.env.SEED_PASSWORD ?? "changeme", 10),
      },
    })
  }

  console.log("✓ 사용자 5명 생성 완료")

  // ─── 기본 채팅방 ────────────────────────────────────
  await prisma.chatRoom.upsert({
    where: { id: "default-room" },
    update: {},
    create: {
      id: "default-room",
      name: "하드사이언스 인턴방",
    },
  })

  console.log("✓ 기본 채팅방 생성 완료")

  // ─── 옴니스 카테고리 ────────────────────────────────
  const categories = [
    { name: "기업정보", icon: "🏢", sortOrder: 1 },
    { name: "인력현황", icon: "👥", sortOrder: 2 },
    { name: "지식재산권", icon: "📜", sortOrder: 3 },
  ]

  for (const c of categories) {
    await prisma.omnisCategory.upsert({
      where: { name: c.name },
      update: {},
      create: c,
    })
  }

  console.log("✓ 옴니스 카테고리 3개 생성 완료")

  // ─── 제품 시드 ──────────────────────────────────────
  const products = [
    { name: "애드젤", color: "#3B82F6", sortOrder: 0 },
    { name: "라이브젤", color: "#10B981", sortOrder: 1 },
    { name: "뉴로힐", color: "#8B5CF6", sortOrder: 2 },
    { name: "화장품", color: "#EC4899", sortOrder: 3 },
    { name: "치매진단플랫폼", color: "#F59E0B", sortOrder: 4 },
  ]

  for (const p of products) {
    await prisma.product.upsert({
      where: { name: p.name },
      update: {},
      create: p,
    })
  }

  console.log("✓ 제품 5개 생성 완료")

  // ─── 업무 카테고리 시드 ─────────────────────────────
  const taskCategories = [
    { name: "연구실험", icon: "🔬", color: "#DBEAFE", sortOrder: 0 },
    { name: "제품개발", icon: "🛠️", color: "#D1FAE5", sortOrder: 1 },
    { name: "과제펀딩", icon: "💰", color: "#FEF3C7", sortOrder: 2 },
    { name: "인허가 특허", icon: "📋", color: "#E0E7FF", sortOrder: 3 },
    { name: "학회 발표", icon: "🎤", color: "#FCE7F3", sortOrder: 4 },
    { name: "사업화", icon: "📈", color: "#CCFBF1", sortOrder: 5 },
    { name: "교육 네트워크", icon: "🎓", color: "#EDE9FE", sortOrder: 6 },
    { name: "행정 관리", icon: "🏛️", color: "#F3F4F6", sortOrder: 7 },
  ]

  for (const tc of taskCategories) {
    await prisma.taskCategory.upsert({
      where: { name: tc.name },
      update: {},
      create: tc,
    })
  }

  console.log("✓ 업무 카테고리 8개 생성 완료")

  // ─── 기본 프로젝트 ──────────────────────────────────
  const woochang = await prisma.user.findUnique({ where: { name: "정우창" } })
  if (woochang) {
    await prisma.project.upsert({
      where: { id: "default-project" },
      update: {},
      create: {
        id: "default-project",
        name: "전사적 자원 관리 시스템 구축",
        purpose: "전사적 자원 관리 자동화 시스템 구축을 통한 생산성 향상",
        goal: "노션 기반 통합 대시보드 구축 및 회사 지식 집합체(옴니스) 운영",
        startDate: new Date("2026-03-23"),
        deadline: new Date("2026-06-23"),
        status: "진행 중",
        priority: "HIGH",
      },
    })
    console.log("✓ 기본 프로젝트 생성 완료")
  }

  // ─── Task 샘플 deadline 보강 (T5: Inspector 마감 라인 검증용) ─────
  // 기존 task 중 deadline이 null인 3건에 D-3 / D-0 / 지연 마감 설정
  const DAY_MS = 86_400_000
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0)
  const deadlineSamples = [
    { offsetDays: 3 }, // D-3 (미래)
    { offsetDays: 0 }, // 오늘
    { offsetDays: -1 }, // 어제 (지연)
  ]

  const tasksWithoutDeadline = await prisma.task.findMany({
    where: { deadline: null, archived: false },
    orderBy: { createdAt: "asc" },
    take: deadlineSamples.length,
    select: { id: true, name: true },
  })

  for (let i = 0; i < tasksWithoutDeadline.length; i++) {
    const t = tasksWithoutDeadline[i]
    const s = deadlineSamples[i]
    const targetDeadline = new Date(today.getTime() + s.offsetDays * DAY_MS)
    await prisma.task.update({
      where: { id: t.id },
      data: { deadline: targetDeadline },
    })
  }
  if (tasksWithoutDeadline.length > 0) {
    console.log(
      `✓ Task deadline 보강 ${tasksWithoutDeadline.length}건 (D-3 / D-0 / 지연)`,
    )
  } else {
    console.log("… deadline 보강 대상 task 없음 (모두 이미 deadline 있음)")
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
