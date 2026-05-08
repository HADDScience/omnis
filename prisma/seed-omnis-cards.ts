/**
 * 일회성 시드 — OmnisCard 6개 + Task 3개 추가 (사용자 시각 검증용).
 * 실행: npx tsx prisma/seed-omnis-cards.ts
 */
import { PrismaClient } from "../generated/prisma/client"

const prisma = new PrismaClient()

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function textSection(title: string, body: string) {
  return { id: uid("sec"), type: "text", title, body }
}

function keyvalueSection(title: string, pairs: { key: string; value: string }[]) {
  return { id: uid("sec"), type: "keyvalue", title, pairs }
}

function tableSection(title: string, headers: string[], rows: string[][]) {
  return { id: uid("sec"), type: "table", title, headers, rows }
}

async function main() {
  const cats = await prisma.omnisCategory.findMany()
  const byName = (n: string) => cats.find((c) => c.name === n)!

  const someUser = await prisma.user.findFirst({ where: { role: "ADMIN" } })
  const updatedById = someUser?.id ?? null

  // ─── OmnisCards ──────────────────────────────────────────
  const cards = [
    {
      categoryId: byName("기업정보").id,
      title: "회사 개요",
      tags: ["회사", "비전"],
      content: {
        sections: [
          textSection(
            "비전",
            "HADD Science는 세포·라만 융합 R&D 플랫폼 회사로, 합성생물학과 광학 분석을 통합한 차세대 진단 솔루션을 만듭니다.",
          ),
          keyvalueSection("기본 정보", [
            { key: "설립", value: "2024-03" },
            { key: "본사", value: "경기도 수원시 영통구" },
            { key: "대표자", value: "김아리" },
            { key: "직원", value: "5명 (정규직 3, 인턴 2)" },
          ]),
        ],
      },
    },
    {
      categoryId: byName("기업정보").id,
      title: "재무 현황",
      tags: ["재무", "BEP"],
      content: {
        sections: [
          textSection(
            "요약",
            "2025 Q3에 BEP 도달. 2026 Q1 Pre-A 라운드 마감, 18개월 runway 확보.",
          ),
          tableSection(
            "분기별 매출 (백만원)",
            ["분기", "매출", "비용", "순익"],
            [
              ["2024 Q4", "12", "45", "-33"],
              ["2025 Q1", "28", "52", "-24"],
              ["2025 Q2", "61", "63", "-2"],
              ["2025 Q3", "94", "88", "+6"],
              ["2025 Q4", "118", "97", "+21"],
            ],
          ),
        ],
      },
    },
    {
      categoryId: byName("기업정보").id,
      title: "인증 · 시설",
      tags: ["인증", "장비"],
      content: {
        sections: [
          keyvalueSection("인증 현황", [
            { key: "벤처기업", value: "2024-08 ~ 2027-08" },
            { key: "기업부설연구소", value: "2024-09 인증" },
            { key: "여성기업", value: "2025-02 인증" },
            { key: "ISO 9001", value: "2025-11 갱신" },
          ]),
          tableSection(
            "주요 장비",
            ["장비명", "모델", "구입년도"],
            [
              ["BSC", "Esco AC2-4S1", "2024"],
              ["HPLC", "Agilent 1260", "2025"],
              ["Raman", "Renishaw inVia", "2025"],
              ["Plate Reader", "Tecan Spark", "2025"],
            ],
          ),
        ],
      },
    },
    {
      categoryId: byName("인력현황").id,
      title: "조직도 · 역할",
      tags: ["조직", "RACI"],
      content: {
        sections: [
          textSection(
            "조직 구성",
            "공동대표 2명 + 정규 1명 + 인턴 2명. 플랫(flat) 구조, 주간 동기화 회의로 우선순위 조율.",
          ),
          tableSection(
            "RACI 매트릭스",
            ["업무", "김아리", "노혜린", "정우창", "주용석", "박소정"],
            [
              ["연구개발", "A", "C", "R", "R", "R"],
              ["마케팅·세일즈", "C", "A/R", "C", "I", "I"],
              ["IT 시스템", "I", "C", "A/R", "I", "I"],
              ["행정·총무", "C", "A", "I", "R", "R"],
            ],
          ),
        ],
      },
    },
    {
      categoryId: byName("인력현황").id,
      title: "채용 · 교육",
      tags: ["JD", "역량"],
      content: {
        sections: [
          textSection(
            "2026 채용 계획",
            "시스템 운영 1명, 인허가 전문가 1명. 공고는 잡코리아·랩짹·LinkedIn 동시 게재.",
          ),
          textSection(
            "역량 매트릭스",
            "기술(생물·광학·SW) / 분석 / 커뮤니케이션 / 자가학습 / 협업 / 도메인 6축으로 분기 평가.",
          ),
        ],
      },
    },
    {
      categoryId: byName("지식재산권").id,
      title: "특허 포트폴리오",
      tags: ["특허", "출원"],
      content: {
        sections: [
          tableSection(
            "특허 5건",
            ["제목", "출원번호", "상태", "PCT"],
            [
              ["라만 기반 세포 활성도 측정법", "10-2025-0078234", "심사대기", "예정"],
              ["미세유체 분리 칩", "10-2025-0089112", "OA 응답중", "준비"],
              ["AI 기반 스펙트럼 분류", "10-2026-0012567", "출원", "—"],
              ["광학 모듈 광원 제어", "10-2026-0034789", "출원", "—"],
              ["세포·시약 자동 분주", "10-2026-0045123", "준비", "—"],
            ],
          ),
        ],
      },
    },
  ]

  for (const c of cards) {
    await prisma.omnisCard.create({
      data: {
        categoryId: c.categoryId,
        title: c.title,
        tags: c.tags,
        content: c.content,
        updatedById,
      },
    })
    console.log(`✓ 카드: ${c.title}`)
  }

  // ─── 추가 Task 3개 (검증용) ──────────────────────────────
  const projects = await prisma.project.findMany({ take: 2 })
  const owner = await prisma.user.findFirst({ where: { role: "MEMBER" } })
  const instructor = await prisma.user.findFirst({ where: { role: "ADMIN" } })

  if (owner && instructor) {
    const tasks = [
      {
        name: "주간 회고 KPT 정리",
        slug: `kpt-${Date.now().toString(36)}`,
        priority: "NORMAL" as const,
        background: "이번 주 KPT 정리 후 #전체 공유 필요.",
        projectId: projects[0]?.id ?? null,
      },
      {
        name: "특허 명세서 v2 검토",
        slug: `patent-v2-${Date.now().toString(36)}`,
        priority: "HIGH" as const,
        background:
          "변리사 1차 검토 후 명세서 수정안 확인. PCT 출원 일정 영향 있음.",
        projectId: projects[1]?.id ?? null,
      },
      {
        name: "시약 발주 (Q2)",
        slug: `reagent-q2-${Date.now().toString(36)}`,
        priority: "LOW" as const,
        background: "Q2 시약 재고 확인 후 발주서 작성.",
        projectId: null,
      },
    ]
    for (const t of tasks) {
      await prisma.task.create({
        data: {
          name: t.name,
          slug: t.slug,
          priority: t.priority,
          background: t.background,
          projectId: t.projectId,
          status: "TODO",
          ownerId: owner.id,
          instructorId: instructor.id,
        },
      })
      console.log(`✓ 업무: ${t.name}`)
    }
  }

  console.log("\n✅ 시드 완료")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
