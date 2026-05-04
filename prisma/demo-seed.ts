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
      tags: ["회사", "개요", "비전", "기술플랫폼"],
      content: `# 회사 개요

> 본 페이지는 시연용 익명 데모 데이터입니다. 실제 기업 수치는 별도 비공개 카드로 관리됩니다.

## 기본 정보

| 항목 | 내용 |
|------|------|
| 업종 | 첨단 바이오 생체소재 · 3차원 세포배양 플랫폼 |
| 창업 | 2024-11 (초기 R&D 중소기업, 24개월차) |
| 본사 | 경기도 수원시 영통구 (도이실로 277) |
| 구성원 | 5인 (ADMIN 2 · MEMBER 3) |
| 사업자 분류 | 중소기업 · 벤처기업 · 여성기업 · 연구개발전담부서 인정 |

## 사업 영역

1. **3D 오가노이드 키트** — 지방세포·간세포·신경세포 라인업, 연구용 전용 (RUO)
2. **생체소재 코팅 솔루션** — 세포 부착·분화 유도용 ECM-mimetic 표면 처리
3. **라만 분광 기반 분석 SaaS** — G-peak·D-band 자동 분류 (사내 자체 알고리즘)

## 핵심 기술 플랫폼

- **OrgaMatrix™** (코드명) — 마이크로웰 기반 균일 오가노이드 형성 기술
- **RamanFlow™** — 라만 분광 신호 실시간 자동 분류
- **CellChat AI** — 본 시스템(Omnis)에서 사용 중인 채팅 기반 업무 자동화 엔진

## 미션·비전

- **미션**: 분업이 정착되기 전 단계의 R&D 중소기업도 *대기업 수준의 정보 흐름*을 유지하는 운영 모델 정립
- **비전**: 3년 내 경기지역 바이오 SaaS 톱5, 5년 내 PCT 출원 누적 20건

## 시장 위치

| 지표 | 우리 | 업계 평균 (5년차 미만) |
|------|------|----------------------|
| 오가노이드 균일도 (CV) | 8.4% | 12~18% |
| 1배치 turn-around | 11일 | 14~21일 |
| 1인당 IP 출원 누적 | 1.0건 | 0.3~0.5건 |

## 주요 수상·인증

- 2026 GBSA 업무 적용 우수사례 공모전 출품 (본 사례)
- 경기도경제과학진흥원 챔프(CHAMP+) 후보 풀 등록 (2026-04)
- 벤처기업 확인서 (제2026-경기-12345호, 2025-09-14)

## 운영 철학 (사내 합의)

> "한 사람이 조사한 정보는 즉시 모두의 정보가 된다."

- **Information lives where it's used** — 카톡 한 줄이 곧 업무 카드, 곧 검색 가능한 지식
- **End-to-end 책임** — 분업이 아닌 협업, 누구나 실험부터 보고까지
- **AI는 사무 오버헤드 처리만** — 의사결정은 사람, 문서화는 AI
`,
    },
    {
      category: "기업정보",
      title: "재무·매출 현황 (2026 Q1 누적)",
      tags: ["재무", "매출", "분기", "투자"],
      content: `# 재무·매출 현황 (데모용 가상 수치)

> 마지막 갱신: 2026-04-30 · 회계 담당: 부팀장 · 출처: 사내 ERP + 세무 대리인 보고서

## 매출 추이 (분기별, 단위: 천원)

| 분기 | 매출 | 영업이익 | 순이익 | 신규 계약 |
|------|-----:|---------:|-------:|----------:|
| 2024 Q4 | 38,200 | -42,800 | -45,100 | 1건 |
| 2025 Q1 | 71,500 | -29,300 | -31,200 | 2건 |
| 2025 Q2 | 142,300 | -8,400 | -10,800 | 3건 |
| 2025 Q3 | 244,800 | 12,600 | 9,400 | 2건 |
| 2025 Q4 | 287,500 | 31,200 | 24,800 | 3건 |
| **2026 Q1** | **312,400** | **48,700** | **39,200** | **4건** |

→ 2025 Q3에 손익분기 (BEP) 진입, 2026 Q1 영업이익률 15.6% 달성

## 매출 구성 (2026 Q1)

| 카테고리 | 비중 | 비고 |
|----------|-----:|------|
| 정부 R&D 과제 | 62% | 산업부 1건, 중기부 2건, 경기도 1건 |
| 자체 제품 매출 | 28% | OrgaMatrix™ 키트 + 라이센싱 |
| 분석 위탁 용역 | 7% | 외부 기관 시험분석 3건 |
| 기타 (이벤트 등) | 3% | BIO KOREA 부스 매출 등 |

## R&D 투자

| 연도 | 매출 대비 R&D 비율 | 절대값 (천원) |
|------|---------:|--------------:|
| 2025 | 41.2% | 200,800 |
| 2026 (예상) | 35.0% | 437,000 |

→ 매출 성장에 따라 R&D 절대 투자는 늘리되 비율은 점진적으로 30% 후반대로 안정화

## 자금 조달 이력

| 시점 | 라운드 | 규모 | 투자자 |
|------|--------|-----:|--------|
| 2024-11 | Pre-Seed | 50,000 | 창업자 + 엔젤 1인 |
| 2025-06 | Seed | 300,000 | 경기창조경제혁신센터 펀드 + 엔젤 3인 |
| 2026-Q3 (예정) | Pre-A | 1,500,000 | (검토 중) |

## 운영 자금 현황

- 현금 잔고: 412,800천원 (2026-04-30 기준)
- 월평균 burn rate: 28,500천원
- runway: 약 14.5개월 (Pre-A 라운드 없이도 유지 가능)

## 다음 분기 전망 (2026 Q2)

- 신규 계약: 진행 중 5건 (예상 매출 +180,000)
- BIO KOREA 부스 (2026-06) 신규 리드 50건 목표
- 위험: 산업부 과제 1건의 단계 평가 결과(6월) — 미통과 시 매출 -45,000 영향
`,
    },
    {
      category: "기업정보",
      title: "보유 인증·연구시설 현황",
      tags: ["인증", "연구시설", "운영", "장비"],
      content: `# 보유 인증

## 정부·공공 인증

| 인증명 | 등록번호 | 발급일 | 만료/갱신 |
|--------|----------|--------|-----------|
| 벤처기업 확인서 | 제2026-경기-12345호 | 2025-09-14 | 2028-09-13 |
| 연구개발전담부서 인정서 | 인정 제2025-04567호 | 2025-04-22 | (영구) |
| 여성기업 확인서 | 제2026-여성-08901호 | 2026-01-10 | 2029-01-09 |
| 기업부설연구소 신고증 | 제2025-기업-23456호 | 2025-07-08 | 2028-07-07 |

## 품질·환경 인증

| 인증명 | 표준 | 인증일 | 갱신 주기 |
|--------|------|--------|-----------|
| ISO 9001 | 2015 | 2026-02-12 | 3년 (2029-02 갱신) |
| ISO 14001 | 2015 | 추진 중 | 2026 Q3 인증 예정 |

## 시험·인허가 (제품 단위)

- **OrgaMatrix™ 키트**: GMP 등급 RUO 출하 가능 (FDA 510(k) 미신청)
- **라만 분석 SaaS**: 의료기기 미해당 (연구 도구 분류)

# 연구시설 현황 (총 면적 198㎡)

## 1. 세포배양실 (BSL-2, 56㎡)

| 장비 | 모델 | 구입연도 | 잔여수명 | 비고 |
|------|------|---------|---------:|------|
| BSC Class II | Esco AC2-4S1 | 2024 | 8년 | 메인 작업대 |
| BSC Class II | Esco AC2-4S1 | 2025 | 9년 | 백업 작업대 |
| CO₂ Incubator | Thermo Heracell 150i × 3 | 2024-2025 | 9-10년 | 셀라인별 분리 운영 |
| 액체질소 탱크 | Taylor-Wharton LS750 | 2025 | 12년 | 셀뱅크 보관 |
| 도립 현미경 | Olympus IX73 + DP74 | 2025 | 10년 | 라이브 이미징 |

## 2. 분석실 (47㎡)

| 장비 | 모델 | 구입연도 | 잔여수명 | 사용처 |
|------|------|---------|---------:|--------|
| HPLC | Agilent 1260 Infinity II | 2024 | 8년 | 코팅 화합물 분석 |
| 라만 분광기 | Renishaw inVia + Leica | 2025 | 10년 | G-peak 분석 (자체 SW 연동) |
| 광학현미경 | Olympus BX53 | 2025 | 10년 | 일반 형태 관찰 |
| 마이크로플레이트 리더 | Tecan Spark | 2024 | 7년 | OD/형광/luminescence |

## 3. 사무·개발실 (45㎡)

- 개발 워크스테이션 5대 (Dell Precision 3680, RTX 4090 × 2)
- 회의실 (8인용) + 보조 화이트보드
- NAS 서버 (Synology DS1621+, 32TB) — 사내 데이터·코드 저장소

## 4. 공용 공간 (50㎡)

- 휴게실, 자재 창고, 폐기물 보관소

# 안전·운영

- BSL-2 운영 매뉴얼 v2.3 (2026-02 개정)
- 분기별 안전 점검 (마지막: 2026-04-15, 무지적)
- 산업안전보건교육 연 4회 이수 (전 직원)
- 화학물질 관리 대장 사내 전산화 완료 (Omnis 카드 연동 예정)
`,
    },
    {
      category: "인력현황",
      title: "조직도·역할 매트릭스",
      tags: ["조직", "역할", "구성원", "RACI"],
      content: `# 조직 구성 (5인, end-to-end 협업 모델)

> 분업이 정착되기 전 단계라 정해진 라인이 아닌 **상황별 RACI**로 운영합니다.

## 인원 구성

| 이름 | 권한 | 입사 | 주 책임 영역 |
|------|------|------|--------------|
| 팀장 | ADMIN | 2024-11 | 의사결정 · 과제 수주 · 외부 미팅 · IP 전략 |
| 부팀장 | ADMIN | 2025-02 | 인허가 · 과제 신청서 총괄 · 회계 감독 |
| 사원1 | MEMBER | 2025-05 | R&D · 문서화 · 시스템 운영 (Omnis 담당) |
| 사원2 | MEMBER | 2025-09 | 실험 · 시제품 제작 · 품질 관리 |
| 사원3 | MEMBER | 2026-02 | 행정 · 서류 · 외부 커뮤니케이션 |

## RACI 매트릭스 (주요 업무 11종)

| 업무 | 팀장 | 부팀장 | 사원1 | 사원2 | 사원3 |
|------|:----:|:-----:|:-----:|:-----:|:-----:|
| 과제 신청서 작성 | A | R | C | C | I |
| 인허가 대응 | C | A/R | I | I | I |
| 실험 SOP 작성 | I | I | A/R | C | I |
| 시제품 생산 | I | I | C | A/R | I |
| 매출 인보이스 발행 | A | R | I | I | C |
| 외부 미팅 응대 | A/R | C | I | I | C |
| 사내 문서화 (Omnis) | C | C | A/R | C | C |
| 행정 서류 (4대보험 등) | I | C | I | I | A/R |
| IP 출원 검토 | A | R | C | I | I |
| 위기 대응 (장비 고장 등) | C | A | R | R | C |
| 채용 면접 | A | R | C | I | I |

> R = Responsible · A = Accountable · C = Consulted · I = Informed

## 보고 라인 & 회의체

| 회의 | 주기 | 참석자 | 산출물 |
|------|------|--------|--------|
| 주간 운영 회의 | 매주 월 09:30 | 전원 | 주간보고 (Omnis 자동 초안) |
| IP 검토 회의 | 격주 수 14:00 | 팀장·부팀장·사원1 | 출원 결정/보류 결정 |
| 실험 리뷰 | 매주 금 10:00 | 사원1·사원2 | 다음 주 실험 plan |
| 분기 OKR 점검 | 분기 첫 월 | 전원 | OKR 갱신 카드 (Omnis) |

## End-to-end 운영 원칙

- **누구나 검토자가 될 수 있다** — 직급 우선이 아닌 도메인 지식 우선
- **출장 시 백업** — 모든 RACI의 R/A 역할은 사전에 백업 1인 지정 (Omnis 카드 명시)
- **신규 프로세스 도입 절차** — 사원 1인 제안 → 1주 시범 운영 → 회고 → 정식 SOP 등록
`,
    },
    {
      category: "인력현황",
      title: "채용·교육 현황 (2026 H1)",
      tags: ["채용", "교육", "역량", "OKR"],
      content: `# 진행 중 교육 (2026 Q2)

| 대상 | 과정명 | 기관 | 시간 | 진행률 | 산출 의무 |
|------|--------|------|-----:|-------:|-----------|
| 사원1 | AI 활용 노코드 데이터 분석 (1차) | 경기도경제과학진흥원 GBSA아카데미 | 14h | **100%** (수료) | 사내 적용 사례 보고 |
| 사원1 | LLM 프롬프트 엔지니어링 심화 | 자체 학습 + 사내 스터디 | 20h | 60% | Omnis 프롬프트 v3 개정 |
| 사원2 | 라만 분광 신호 분석 워크숍 | Renishaw KOREA | 8h | 100% | 분석 SOP v3 작성 |
| 사원2 | GMP 기초 (RUO 등급) | 한국바이오협회 e-러닝 | 16h | 75% | RUO 출하 체크리스트 |
| 사원3 | RPA 기초 (Power Automate) | 마이크로소프트 무료 강좌 | 12h | 40% | 행정 자동화 케이스 1건 |
| 부팀장 | 정부 R&D 과제 신청서 작성 실무 | 산업기술진흥원 (KIAT) | 16h | 100% | 차기 신청서 적용 |

## 교육 캘린더 (예정)

| 시작 | 과정 | 대상 | 우선순위 |
|------|------|------|:--------:|
| 2026-05-15 | AI 활용 노코드 데이터 분석 (2차) | 사원1 | High |
| 2026-06-03 | ISO 14001 내부심사원 양성 | 부팀장 | Mid |
| 2026-06-20 | 세포배양 advanced (오가노이드) | 사원2 | High |
| 2026-07-10 | 영문 학회 발표 트레이닝 | 사원1·사원2 | Mid |

# 채용 계획 (2026 H2)

## 1. 시스템 운영 인력 1명 (Mid-level)

- **포지션**: System Operations Engineer
- **JD 요약**: 사내 인프라 (NAS·Omnis·CI/CD) 운영, 관측·백업·복구 자동화
- **필수 역량**: Linux 시스템 관리 3년+, Docker·Postgres 실무, 모니터링 (Grafana/Prometheus)
- **우대**: NextAuth/Prisma 운영 경험, 한국어 문서화 능력
- **목표 시점**: 2026-08 합류

## 2. 인허가·규제 대응 인력 1명 (Senior)

- **포지션**: Regulatory Affairs Specialist
- **JD 요약**: 의료기기 1·2등급 인허가, 식약처 GMP 대응
- **필수 역량**: 인허가 실무 5년+, RUO ↔ 의료기기 분류 판단
- **우대**: 미국 FDA 510(k) 경험, 영문 dossier 작성
- **목표 시점**: 2026-10 합류

# 핵심 역량 매트릭스

| 역량 영역 | 팀장 | 부팀장 | 사원1 | 사원2 | 사원3 |
|----------|:----:|:------:|:-----:|:-----:|:-----:|
| 분자생물학 | ★★★★ | ★★ | ★★★ | ★★★★ | ★ |
| 인허가·규제 | ★★ | ★★★★★ | ★★ | ★ | ★★ |
| 데이터 분석·AI | ★★ | ★★ | ★★★★★ | ★★ | ★ |
| 행정·재무 | ★★★ | ★★★★ | ★★ | ★ | ★★★★ |
| 영문 커뮤니케이션 | ★★★★ | ★★★ | ★★★ | ★★ | ★★ |
| 시스템 운영 | ★ | ★ | ★★★★★ | ★ | ★ |

## 2026 OKR — Objective: "End-to-end 역량을 5명 모두 ★★★ 이상으로"

- KR1 — 사원3의 데이터 분석 ★ → ★★★ (RPA 자동화 1건 구현)
- KR2 — 사원2의 인허가·규제 ★ → ★★★ (RUO 체크리스트 + 사내 교육 진행)
- KR3 — 부팀장의 데이터 분석 ★★ → ★★★ (BI 대시보드 1개 본인 빌드)
- KR4 — 전 직원의 영문 커뮤니케이션 평균 +1 단계 (학회 발표 1건씩 의무화)
`,
    },
    {
      category: "지식재산권",
      title: "특허 포트폴리오 (출원·등록 5건)",
      tags: ["특허", "IP", "출원", "PCT"],
      content: `# 특허 포트폴리오 — 2026-04-30 기준

> 본 데이터는 시연용 가상 출원번호입니다. 실제 데이터는 별도 비공개 카드로 관리됩니다.

## 누적 현황

- 출원: 5건 (등록 1, 심사 중 1, 출원 2, 출원 준비 1)
- 발명자: 5명 전원이 1건 이상 등재
- 평균 출원 lead time (착안 → 출원): 47일

## 상세 목록

### 1. 3차원 오가노이드 배양 키트 ✅ 등록

| 항목 | 내용 |
|------|------|
| 출원번호 | 10-2026-0012345 |
| 등록번호 | 10-2787654 |
| 출원일 | 2025-04-12 |
| 등록일 | 2026-01-23 |
| 발명자 | 팀장, 사원2 |
| 청구항 | 16개 (독립 3 + 종속 13) |
| 핵심 청구항 요약 | 마이크로웰 형태와 ECM 코팅을 결합해 균일도 CV ≤ 10%의 오가노이드를 1배치 11일 이내 형성 |
| 라이선스 | 비독점 1건 진행 중 (제약사 A) |

### 2. 라만 G-peak 자동 분석 알고리즘 ⏳ 심사 중

| 항목 | 내용 |
|------|------|
| 출원번호 | 10-2026-0034567 |
| 출원일 | 2025-11-04 |
| 발명자 | 사원1, 팀장 |
| 청구항 | 12개 (독립 2 + 종속 10) |
| 핵심 청구항 요약 | 라만 신호 G-peak·D-band 비율을 입력으로 받아 세포 분화 단계를 4단계로 자동 분류하는 ML 파이프라인 |
| 심사 상태 | OA 1차 수령 (2026-04-12), 응답 기한 2026-06-12 |

### 3. 생체소재 코팅 조성물 📤 출원

| 항목 | 내용 |
|------|------|
| 출원번호 | 10-2026-0045678 |
| 출원일 | 2026-02-21 |
| 발명자 | 팀장, 사원2, 사원1 |
| 청구항 | 10개 |
| 핵심 청구항 요약 | RGD 모티프와 헤파린 유사 분자를 조합해 세포 부착·분화를 동시에 유도하는 코팅액 조성 |

### 4. 마이크로 플레이트 자동 패턴 📤 출원

| 항목 | 내용 |
|------|------|
| 출원번호 | 10-2026-0056789 |
| 출원일 | 2026-03-15 |
| 발명자 | 사원2, 부팀장 |
| 청구항 | 8개 |
| 핵심 청구항 요약 | 96/384 well 마이크로플레이트의 라벨링·QR 자동 인쇄 + 실험 결과 자동 매핑 시스템 |

### 5. 셀-프리 단백질 발현 시스템 📝 출원 준비

| 항목 | 내용 |
|------|------|
| 잠정 명칭 | 셀-프리 단백질 발현 효율 최적화 시스템 |
| 발명자 후보 | 사원1, 팀장, 부팀장 |
| 예상 출원일 | 2026-05-22 |
| 청구항 초안 | 7개 (작성 중) |
| 비고 | PCT 동시 출원 검토 중 |

## IP 전략 요약

### 출원 vs 영업비밀 결정 기준

| 기술 유형 | 결정 |
|-----------|------|
| 수율·균일도 등 측정 가능한 성능 우위 | **특허 출원** (역설계 가능) |
| 제조 공정 내 노하우 (배지 조성 비율 등) | **영업비밀** (Omnis 비공개 카드) |
| AI 모델 가중치 | **영업비밀** + 모델 카드 등록 |

### 국제 출원 (PCT)

- 우선권 12개월 활용
- 우선 진입 국가: US, EP, JP, CN
- 5번 셀-프리 단백질 발현은 PCT 직접 출원 검토 중

### 라이선싱 정책

- **비독점 라이선스** 우선 (수익 다각화)
- **독점**은 신약 개발 등 대규모 투자 동반 시에만 검토
- 라이선싱 의사결정 RACI: 팀장(A) · 부팀장(R) · 사원1(C)
`,
    },
    {
      category: "지식재산권",
      title: "상표권·디자인권 현황",
      tags: ["상표", "디자인", "브랜드", "사용가이드"],
      content: `# 상표권 (Trademark)

## 등록·출원 현황

| 마크 | 분류 | 출원번호 | 상태 | 등록/출원일 |
|------|------|----------|------|-------------|
| **HADD Science** (워드마크) | 류 5/9/42 | 40-2026-0089012 | ✅ 등록 | 2025-12-04 |
| **HADD Science** (도형 결합) | 류 5/9/42 | 40-2026-0089013 | ✅ 등록 | 2025-12-04 |
| **OrgaMatrix™** | 류 5 | 40-2026-0123456 | ⏳ 심사 중 | 2026-02-18 |
| **RamanFlow™** | 류 9/42 | 40-2026-0123457 | ⏳ 심사 중 | 2026-02-18 |
| **CellChat AI** | 류 9/42 | 40-2026-0145678 | 📝 출원 준비 | 2026-05 예정 |

## 국제 출원 (마드리드 협정)

- HADD Science 워드마크 → US/EP/JP 마드리드 출원 (2026 Q3 검토)
- 비용 추정: 약 12,000천원 (3국 + 대리인 비용 포함)

# 디자인권 (Design)

| 명칭 | 출원번호 | 상태 | 출원일 |
|------|----------|------|--------|
| OrgaMatrix™ 키트 외관 | 30-2026-0034567 | ⏳ 심사 중 | 2026-03-08 |
| 제품 패키지 라벨 | 30-2026-0045678 | 📤 출원 | 2026-04-12 |
| 사용자 매뉴얼 표지 | 30-2026-0056789 | 📝 출원 검토 | - |

# 브랜드 사용 가이드 (사내 SOP v1.2)

## 워드마크 사용 규칙

- 영문 단독 사용 시: **HADD Science** (스페이스 1칸, 두 단어 모두 단음절 강조)
- 한글 병기 시: **HADD Science (하드사이언스)** — 첫 등장 시 1회만 병기
- 약어 사용: **HADD** (3회 이상 등장 시 두 번째부터 약어 가능)

## 컬러 팔레트

| 용도 | 이름 | HEX | RGB | 사용 비율 |
|------|------|-----|-----|----------:|
| Primary | Electric Blue | #2A2BFF | 42 / 43 / 255 | 60% |
| Secondary | Pure White | #FFFFFF | 255 / 255 / 255 | 30% |
| Accent | Slate Black | #0F172A | 15 / 23 / 42 | 8% |
| Alert | Amber | #F59E0B | 245 / 158 / 11 | 2% |

## 타이포그래피

- 국문: Pretendard Variable (700 / 500 / 400)
- 영문: Inter (700 / 500 / 400)
- 코드/모노: JetBrains Mono

## 로고 클리어 스페이스

- 워드마크 좌우/상하 최소 여백: 마크 높이의 50%
- 최소 크기: 인쇄물 12mm, 디지털 24px

## 금지 사항

- 로고 회전·기울임·그림자 효과
- 컬러 변경 (단색 그레이스케일은 허용)
- 다른 브랜드와 인접 배치 (로고 구분선 필수)

# 외부 사용 신청

- 미디어·기사 사용 시: 사원3에게 사전 통보 (Omnis "외부 노출 카드")
- 협력사 자료 사용 시: 라이선스 합의서 첨부 후 팀장 승인
`,
    },
    {
      category: "지식재산권",
      title: "논문·학회 발표 이력",
      tags: ["논문", "학회", "발표", "협력"],
      content: `# 논문·학회 발표 이력 (2025-2026)

## 게재 논문 (피어 리뷰)

| 저널 | IF | 제목 | 게재 시점 | 인용 (2026-04 기준) |
|------|---:|------|-----------|--------------------:|
| *J. Tissue Eng. Regen. Med.* | 4.5 | 3D 오가노이드 안정성 평가 — 균일도 CV 8.4% 달성 | 2026-03 | 12 |
| *Biomaterials Science* | 6.1 | RGD-헤파린 코팅 조성물의 세포 부착 효율 비교 | 2025-11 | 28 |
| *Anal. Chem.* (under review) | 7.4 | 라만 G-peak 기반 ML 분류 — 4단계 분화 식별 | 2026-04 투고 | - |

## 학회 발표

| 학회 | 형태 | 제목 | 시점 |
|------|------|------|------|
| 한국조직공학재생의학회 (TERMIS-KR 2025) | 포스터 | 마이크로웰 기반 오가노이드 균일도 향상 | 2025-09 |
| 한국바이오협회 신년 심포지엄 | 구두 | 초기 R&D 중소기업의 운영 모델 — 본 사례 | 2026-01 |
| 한국조직공학재생의학회 (TERMIS-KR 2026) | 구두 | 라만 분광 기반 세포 분류 자동화 | **2026-05-22 예정** |
| BIO KOREA 2026 | 부스 + 포스터 | OrgaMatrix™ 시연 + 새로운 코팅 조성물 | **2026-06-04~06 예정** |
| TERMIS World Congress 2026 (Lisbon) | 포스터 (검토) | 영문 abstract 작성 중 | **2026-09 예정** |

## 발표 자료 사내 보관

- 사내 NAS: \`/research/presentations/2025/\`, \`/research/presentations/2026/\`
- Omnis 연결 카드: 학회별 카드 1개 + 발표 후 회고 카드 1개

# 외부 협력 기관

## 공동 연구 (활성)

| 기관 | 분야 | 형태 | 시작일 | 상태 |
|------|------|------|--------|------|
| 서울대 의공학과 ○○○ 교수 | 오가노이드 + 미세유체 | 정부 과제 컨소시엄 | 2025-04 | 진행 중 (월 1회 미팅) |
| 한국생명공학연구원 (KRIBB) | 단백질 발현 시스템 | MOU + 시험분석 위탁 | 2025-11 | 진행 중 |
| 경희대 약학대학 △△△ 교수 | 라만 분광 + AI | 비공식 협력 | 2026-02 | 정식 MOU 검토 |

## 시험분석 위탁 (단발성)

| 기관 | 항목 | 횟수 | 비용 (천원) |
|------|------|----:|-----------:|
| 한국화학연구원 (KRICT) | 단백질 정제 | 2회 | 4,800 |
| KRIBB | 단백질 발현 효율 | 3회 | 7,200 |
| ㈜한국기술표준원 | RUO 등급 시험 | 1회 | 2,300 |

## 향후 협력 검토

- **국립암센터** — 오가노이드 응용 임상 자문 (2026 H2 미팅 예정)
- **삼성서울병원 임상의학연구소** — 환자 유래 오가노이드 (PDO) 협력 가능성
- **카이스트 바이오및뇌공학과** — 라만 + AI 알고리즘 박사 후 연구원 영입 검토

# 외부 발신 가이드

- 학회·논문 외부 노출 시 사원3에게 사전 통보 → Omnis "외부 노출 카드" 자동 등록
- 공저자 합의 RACI: 제1저자(R) · 교신저자(A) · 공저자(C) · 사원3(I, 행정 트래킹)
- 발표 자료 디자인은 부팀장이 검토 (브랜드 가이드 일관성 유지)
`,
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
