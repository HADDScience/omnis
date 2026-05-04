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

  // ─── 7. HADD DB (Omnis) 카드 — 3 카테고리 8개 ────────────────────
  const categoryByName: Record<string, string> = {}
  for (const c of await prisma.omnisCategory.findMany({ select: { id: true, name: true } })) {
    categoryByName[c.name] = c.id
  }

  const teamLead = await prisma.user.findUniqueOrThrow({ where: { name: "팀장" } })

  const cards = [
    {
      category: "기업정보",
      title: "회사 개요 (익명 데모 ver.)",
      tags: ["회사", "개요", "비전"],
      content: `# 회사 개요\n\n**업종**: 첨단 바이오 생체소재·3차원 세포배양 플랫폼\n**창업 단계**: 초기 R&D 중소기업\n**구성원**: 5인 (전 직원이 실험·규제 대응·과제·문서화를 end-to-end 수행)\n\n## 미션\n- 직원의 머리가 하나로 연결된 듯 정보가 흐르는 사내 운영\n- "이거 어디 있어?" 질문이 사라지는 환경\n\n## 핵심 비전\n- 채팅 한 줄 = 업무 카드 1건\n- 사무 오버헤드는 AI에게 위임\n`,
    },
    {
      category: "기업정보",
      title: "재무·매출 현황 (예시)",
      tags: ["재무", "매출", "분기"],
      content: `# 분기 매출 (데모용 가상치)\n\n| 분기 | 매출 (천원) | 신규 계약 |\n|------|------------|-----------|\n| 2026 Q1 | 312,000 | 4건 |\n| 2025 Q4 | 287,500 | 3건 |\n| 2025 Q3 | 244,800 | 2건 |\n\n## 자금 운용\n- 정부 R&D 과제 비중: 62%\n- 자체 매출: 28%\n- 투자 유치: 10%\n`,
    },
    {
      category: "기업정보",
      title: "보유 인증·연구시설 현황",
      tags: ["인증", "연구시설", "운영"],
      content: `# 보유 인증\n\n- ISO 9001:2015 (품질경영시스템)\n- 벤처기업 확인서\n- 연구개발전담부서 인정서\n- 여성기업 확인서\n\n# 연구시설 현황\n\n- 세포배양실 1실 (BSC × 2, CO₂ Incubator × 3)\n- 분석실 1실 (HPLC, 광학현미경, 라만 분광기)\n- 사무실 1실 (개발 워크스테이션 5대)\n`,
    },
    {
      category: "인력현황",
      title: "조직도·역할 매트릭스",
      tags: ["조직", "역할", "구성원"],
      content: `# 조직 구성 (5인 데모)\n\n| 이름 | 역할 | 주 담당 |\n|------|------|---------|\n| 팀장 | ADMIN | 의사결정·과제 수주·외부 미팅 |\n| 부팀장 | ADMIN | 인허가·과제 신청서 총괄 |\n| 사원1 | MEMBER | R&D·문서화·시스템 운영 |\n| 사원2 | MEMBER | 실험·시제품 |\n| 사원3 | MEMBER | 행정·서류 |\n\n## End-to-end 역할 구조\n초기 단계라 분업 미정착 → 누구나 실험·규제 대응·과제 신청서·상표권 관리·보고를 동시 수행\n`,
    },
    {
      category: "인력현황",
      title: "채용·교육 현황",
      tags: ["채용", "교육", "역량"],
      content: `# 진행 중 교육\n\n- 사원1: AI 활용 노코드 데이터 분석 (GBSA, 14h, 출석률 100%)\n- 사원2: 실험 데이터 분석 SOP v3 사내 교육\n- 사원3: 행정 자동화 (RPA 기초) 사내 스터디\n\n## 채용 계획\n- 2026 H2: 시스템 운영 인력 1명, 인허가 인력 1명 검토 중\n`,
    },
    {
      category: "지식재산권",
      title: "특허 포트폴리오 (출원·등록 5건)",
      tags: ["특허", "IP", "출원"],
      content: `# 출원·등록 현황 (데모)\n\n| 출원 번호 | 명칭 | 상태 | 출원일 |\n|-----------|------|------|--------|\n| 10-2026-0012345 | 3차원 오가노이드 배양 키트 | 등록 | 2025-08-12 |\n| 10-2026-0034567 | 라만 G-peak 자동 분석 알고리즘 | 심사 중 | 2025-11-04 |\n| 10-2026-0045678 | 생체소재 코팅 조성물 | 출원 | 2026-02-21 |\n| 10-2026-0056789 | 마이크로 플레이트 자동 패턴 | 출원 | 2026-03-15 |\n| 10-2026-0067890 | 셀-프리 단백질 발현 시스템 | 출원 준비 | 2026-04-30 |\n\n## IP 전략\n- 핵심 플랫폼 기술은 PCT 진입 검토\n- 제조 노하우는 영업비밀로 관리\n`,
    },
    {
      category: "지식재산권",
      title: "상표권·디자인권",
      tags: ["상표", "브랜드"],
      content: `# 상표권\n\n- HADD Science (워드마크, 등록 완료)\n- 제품 A 브랜드 로고 (디자인권, 출원 중)\n- 제품 B 패키지 디자인 (출원 검토)\n\n# 사용 가이드\n- 외부 자료 사용 시 영문/한글 병기 우선\n- 컬러 코드: Electric Blue #2A2BFF, White #FFFFFF\n`,
    },
    {
      category: "지식재산권",
      title: "논문·학회 발표 이력",
      tags: ["논문", "학회", "발표"],
      content: `# 2026 논문/발표\n\n- *J. Tissue Eng. Regen. Med.* (IF 4.5) — 3D 오가노이드 안정성 평가, 게재 (2026-03)\n- 한국조직공학재생의학회 — 라만 분광 기반 세포 분류, 구두 발표 (2026-05 예정)\n- BIO KOREA 2026 — 부스 참가 + 포스터 1편 (2026-06 예정)\n\n# 외부 협력\n- 서울대 의공학과 (공동연구 1건)\n- 한국생명공학연구원 (시험분석 위탁 3건)\n`,
    },
  ]

  for (const card of cards) {
    const categoryId = categoryByName[card.category]
    if (!categoryId) continue
    await prisma.omnisCard.create({
      data: {
        categoryId,
        title: card.title,
        content: { markdown: card.content } as object,
        tags: card.tags,
        updatedById: teamLead.id,
      },
    })
  }

  console.log(
    `✓ 익명 데모 시드 완료 — 사용자 ${users.length}, 카테고리 ${categories.length}, 프로젝트 ${projectDefs.length}, 업무 ${tasks.length}, Omnis 카드 ${cards.length}`,
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
