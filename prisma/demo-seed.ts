/**
 * 공모전 데모용 익명 시드.
 *
 * 기본 seed.ts와 달리 카테고리·제품·기존 업무를 모두 익명화한 채
 * 캡처 가능한 상태를 만든다. 정우창(필자)은 본인 신원이라 그대로 사용.
 */

import "dotenv/config"
import { PrismaClient } from "../generated/prisma/client"
import { hashSync } from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  // ─── 0. 기존 데이터 정리 (FK 의존 순서) ────────────────────────
  await prisma.notification.deleteMany()
  await prisma.checklist.deleteMany()
  await prisma.task.deleteMany()
  await prisma.chatMessage.deleteMany()
  await prisma.weeklyReport.deleteMany()
  await prisma.omnisCard.deleteMany()
  await prisma.omnisCategory.deleteMany()
  await prisma.project.deleteMany()
  // Product는 모델명 확인 필요 — 직접 SQL 없이 시도
  try {
    // @ts-ignore - 동적
    await (prisma as any).product?.deleteMany?.()
  } catch (_) {}
  await prisma.chatRoom.deleteMany()
  await prisma.user.deleteMany()

  // ─── 1. 사용자 — 시연용 익명 5인 ────────────────────────────
  const users = [
    { name: "팀장", role: "ADMIN" as const },
    { name: "부팀장", role: "ADMIN" as const },
    { name: "사원1", role: "MEMBER" as const },
    { name: "사원2", role: "MEMBER" as const },
    { name: "사원3", role: "MEMBER" as const },
  ]
  for (const u of users) {
    await prisma.user.create({
      data: { name: u.name, role: u.role, passwordHash: hashSync(process.env.SEED_PASSWORD ?? "changeme", 10) },
    })
  }

  // ─── 2. 채팅방 ─────────────────────────────────────────────────
  await prisma.chatRoom.create({
    data: { id: "default-room", name: "사내 채팅 (익명 데모)" },
  })

  // ─── 3. 옴니스 카테고리 ─────────────────────────────────────────
  const categories = [
    { name: "기업정보", icon: "🏢", sortOrder: 1 },
    { name: "인력현황", icon: "👥", sortOrder: 2 },
    { name: "지식재산권", icon: "📜", sortOrder: 3 },
  ]
  for (const c of categories) {
    await prisma.omnisCategory.create({ data: c })
  }

  // ─── 4. 제품/제품군 — 익명 라벨 ────────────────────────────────
  const products = [
    { name: "제품 A", color: "#3B82F6", sortOrder: 0 },
    { name: "제품 B", color: "#10B981", sortOrder: 1 },
    { name: "제품 C", color: "#8B5CF6", sortOrder: 2 },
    { name: "공통 R&D", color: "#EC4899", sortOrder: 3 },
  ]
  for (const p of products) {
    try {
      // @ts-ignore - product 모델
      await (prisma as any).product?.create?.({ data: p })
    } catch (_) {}
  }

  // ─── 5. 프로젝트 ───────────────────────────────────────────────
  // 운영 프로젝트(공통) + 지원사업 3건(제품별) — 캔버스에서 product↔project↔task 의 다중 갈래를 검증
  const productByName: Record<string, string> = {}
  try {
    // @ts-ignore
    const all = await (prisma as any).product?.findMany?.()
    for (const p of all ?? []) productByName[p.name] = p.id
  } catch (_) {}

  const projectDefs = [
    { name: "전사 자원 관리 시스템 구축", productName: null as string | null },
    { name: "지원사업 — 바이오 소재 실증연구", productName: "제품 B" },
    { name: "지원사업 — 공급망 안정화", productName: "제품 A" },
    { name: "제품 B 인허가 추진", productName: "제품 B" },
    { name: "제품 C 시안 검토", productName: "제품 C" },
  ]
  const projectByName: Record<string, { id: string }> = {}
  for (const def of projectDefs) {
    const created = await prisma.project.create({
      data: {
        name: def.name,
        productId: def.productName ? productByName[def.productName] ?? null : null,
      },
    })
    projectByName[def.name] = created
  }

  // ─── 6. 데모 업무 카드 — 칸반 채우기 (할 일/진행 중/리뷰/완료) ──
  const me = await prisma.user.findUniqueOrThrow({ where: { name: "사원1" } })
  const aDoc = await prisma.user.findUniqueOrThrow({ where: { name: "팀장" } })
  const bMng = await prisma.user.findUniqueOrThrow({ where: { name: "부팀장" } })
  const dIntern = await prisma.user.findUniqueOrThrow({ where: { name: "사원2" } })
  const eIntern = await prisma.user.findUniqueOrThrow({ where: { name: "사원3" } })

  const today = new Date()
  const addDays = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return d
  }

  const tasks = [
    // ─ 지원사업 — 공급망 안정화 (제품 A) ─
    { title: "공급망 안정화 신청서 검토", status: "IN_PROGRESS" as const, deadline: addDays(1), ownerId: bMng.id, instructorId: aDoc.id, slug: "지원-공급망-신청서", product: "제품 A", project: "지원사업 — 공급망 안정화" },
    { title: "공급망 시장조사 보고서 초안", status: "TODO" as const, deadline: addDays(5), ownerId: eIntern.id, instructorId: bMng.id, slug: "지원-공급망-시장조사", product: "제품 A", project: "지원사업 — 공급망 안정화" },
    // ─ 제품 A 운영 ─
    { title: "제품 A 시제품 라벨 검토", status: "IN_PROGRESS" as const, deadline: addDays(2), ownerId: me.id, instructorId: aDoc.id, slug: "제품-A-시제품-라벨", product: "제품 A", project: "전사 자원 관리 시스템 구축" },

    // ─ 지원사업 — 바이오 소재 실증연구 (제품 B) ─
    { title: "매출액 산정 자료 정리", status: "IN_PROGRESS" as const, deadline: addDays(0), ownerId: me.id, instructorId: aDoc.id, slug: "지원-바이오-매출-산정", product: "제품 B", project: "지원사업 — 바이오 소재 실증연구" },
    { title: "제피 성분 자료조사·기술동향", status: "TODO" as const, deadline: addDays(2), ownerId: eIntern.id, instructorId: aDoc.id, slug: "지원-바이오-기술동향", product: "제품 B", project: "지원사업 — 바이오 소재 실증연구" },
    { title: "가산점 서류 zip 제출(여성기업·IP 5건)", status: "REVIEW" as const, deadline: addDays(1), ownerId: me.id, instructorId: bMng.id, slug: "지원-바이오-가산점", product: "공통 R&D", project: "지원사업 — 바이오 소재 실증연구" },
    // ─ 제품 B 인허가 ─
    { title: "제품 B 인허가 일정표 작성", status: "REVIEW" as const, deadline: addDays(0), ownerId: bMng.id, instructorId: aDoc.id, slug: "제품-B-인허가-일정표", product: "제품 B", project: "제품 B 인허가 추진" },
    { title: "제품 B 인증 리스트 조사", status: "DONE" as const, deadline: addDays(-7), ownerId: bMng.id, instructorId: aDoc.id, slug: "제품-B-인증-리스트", product: "제품 B", project: "제품 B 인허가 추진" },
    // ─ 제품 B R&D ─
    { title: "라만 G-peak 분석 프로그램 검토", status: "TODO" as const, deadline: addDays(7), ownerId: me.id, instructorId: aDoc.id, slug: "제품-B-라만-g-peak", product: "제품 B", project: "전사 자원 관리 시스템 구축" },

    // ─ 제품 C 시안 검토 ─
    { title: "제품 C 시안 디자인 1차 검토", status: "TODO" as const, deadline: addDays(4), ownerId: dIntern.id, instructorId: bMng.id, slug: "제품-C-시안-1차", product: "제품 C", project: "제품 C 시안 검토" },
    { title: "제품 C 분기 보고서 초안 검토 의뢰", status: "DONE" as const, deadline: addDays(-3), ownerId: aDoc.id, instructorId: bMng.id, slug: "제품-C-분기-보고서", product: "제품 C", project: "제품 C 시안 검토" },

    // ─ 공통 R&D / 운영 ─
    { title: "가벽 블라인드 설치", status: "TODO" as const, deadline: addDays(3), ownerId: me.id, instructorId: bMng.id, slug: "공통-가벽-블라인드", product: "공통 R&D", project: "전사 자원 관리 시스템 구축" },
    { title: "주간 업무보고 정리·공유", status: "IN_PROGRESS" as const, deadline: addDays(2), ownerId: me.id, instructorId: aDoc.id, slug: "공통-주간-업무보고", product: "공통 R&D", project: "전사 자원 관리 시스템 구축" },
    { title: "명함 6인 분할 업로드", status: "REVIEW" as const, deadline: addDays(0), ownerId: me.id, instructorId: bMng.id, slug: "공통-명함-분할", product: "공통 R&D", project: "전사 자원 관리 시스템 구축" },
    { title: "사내 지식베이스 카테고리 정리", status: "DONE" as const, deadline: addDays(-2), ownerId: me.id, instructorId: aDoc.id, slug: "공통-지식베이스-카테고리", product: "공통 R&D", project: "전사 자원 관리 시스템 구축" },
  ]

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        name: t.title,
        slug: t.slug,
        status: t.status,
        deadline: t.deadline,
        ownerId: t.ownerId,
        instructorId: t.instructorId,
        projectId: projectByName[t.project].id,
        productId: productByName[t.product] ?? null,
      },
    })
  }

  console.log(
    `✓ 익명 데모 시드 완료 — 사용자 ${users.length}, 카테고리 ${categories.length}, 프로젝트 ${projectDefs.length}, 업무 ${tasks.length}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
