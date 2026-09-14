---
kind: decision
status: superseded
canonical: mydocs/plans/2026-09-14-notion-company-data.md
last_verified: 2026-09-14
---

# 2026-09-14 — Notion 회사 데이터 이식 (추출 완료)

> 확인 결과와 이후 설계는 `mydocs/plans/2026-09-14-company-context.md` 로 넘어갔다. 이 문서는 추출 기록으로 남긴다.

원본: Notion ARI(SKKU) 워크스페이스의 「옴니스(전사적 자원관리 DB)」.
작업지시자 지시: **데이터만 먼저 추출하고, 확인받은 뒤 넣는다. 그대로 옮기지 말고 담기에 맞는 구조로.**

**아직 아무것도 넣지 않았다.** 추출물은 저장소 밖 `~/work/omnis-import/notion/` 에 있다(권한 700). 개인정보가 들어 있어 저장소에 두지 않는다.

## 추출 방법

`~/.claude.json` 의 omnis-local 프로젝트 MCP 설정에 있던 `NOTION_TOKEN`(통합 이름 「HADD MCP」)으로
Notion API 를 직접 읽었다. 목차 DB 8행 → 각 행 본문 → 본문 안의 인라인 DB 3개까지.

그 MCP 설정은 이름과 명령이 밀려 연결되지 않는 상태다 — 서버 이름이 `npx`, 명령이 `-y` 로 들어가 있다.

## 무엇이 있었나

목차 DB 는 8행뿐이고, 실제 자료는 그 행들의 본문과 하위 DB 에 있다.

| 노션 항목 | 카테고리 | 상태 | 알맹이 |
|---|---|---|---|
| 기업 개요 | 기업일반 | 최신 | 회사명·홈페이지·업종·사업자등록번호·설립일·상시근로자·매출·주소 3곳 + 대표·과장 개인 연락처 |
| 재무현황 | 재무 | 최신 | 자산·자본·부채(25.12.31) · 연도별 매출(실적 2 · 예상 1 · 추정 1) · 제품별 매출 v1/v2 · 세금계산서 2건 · 2026 YTD |
| 타 업체 정보 (3D Organoid) | 기업일반 | 최신 | **하위 DB 41행** — 경쟁·시장 기업. 12개 속성 |
| 직원 정보 | 인사 | 갱신필요 | **하위 DB 11행** — 13개 속성 · 조직도 hwpx · 직원 xlsx · 조직도 이미지 |
| 회사 로고 | 자료실 | 갱신필요 | 로고 9종 용도표 + 이미지 9장 |
| 주요 제품·서비스 | 기업일반 | 갱신필요 | 제품 3종 설명 (애드젤 · PDRN 화장품 · 뉴로힐) |
| HADD Science History | 실적 | 갱신필요 | 이름과 달리 이력이 아니라 **2026년 추진 계획** — 과제 7 · 전시/학술 4 |
| 보유 IP 현황 | IP | 갱신필요 | 하위 DB — **읽지 못함** (연결된 원본 DB 가 통합에 공유돼 있지 않다) |

목차 DB 의 속성: 파일유형(로고·소개자료·제안서·증빙서류·양식·기타) · 태그(과제용·인증용·내부용) ·
담당자 · 기준일(2026-03-23 ~ 04-24) · 상태(최신 3 · 갱신필요 5).

### 타 업체 정보 41행

| | 값 |
|---|---|
| 분류 | Global 16 · Media & Culture gel 9 · 오가노이드 회사 7 · Culture chip & dish 6 · CRO 3 |
| 속성 3개 이상 채움 | 25 |
| 이름(+분류)만 | 16 — 전부 Global |
| 동물대체시험법 | O 3 · X 22 · 빈칸 16 |
| 국가 | 따로 칸이 없고 이름 괄호 안에 적혀 있다 — "Lonza Group AG (스위스)" |
| 금액·규모 표기 | 전부 글자 — 자본금 "1억 4천" · 매출 "435억" · 업력 "2017년(8년차)" · 사원 "21명(중소)" |

### 직원 정보 11행

| | 값 |
|---|---|
| 소속 | 하드사이언스 6 · 성균관대학교 3 · EAS 2 |
| 속성 | 이름 · 소속 · 직책 · 재직상태 · 학력 · 전공 · 담당 업무 · 과학기술인번호(NTIS) · 이메일 · 연락처 · 생년월일 · 입사일 · 서명(파일) |
| 옴니스 User 와 대조 | 9명은 있다. **사니 아마르 · 현튜이 2명은 없다** (성균관대 연구원) |
| 서명 이미지 | 8명 |

## 옴니스와 대조해서 나온 것

1. **매출 숫자 두 벌은 부가세 차이다.** 기업 개요는 2024년 3.96 · 2025년 38.2 백만원,
   재무현황은 3.6 · 34.75 백만원이다. 3.6 × 1.1 = 3.96, 34.75 × 1.1 = 38.23. 기업 개요가 부가세 포함,
   재무현황이 공급가다. 모순이 아니라 기준이 다르다.
2. **세금계산서 2건이 CRM 에 없다.** 2026-04-16 가천대학교 산학협력단(라이브젤, 275,000원) ·
   2026-04-17 영사이언스(애드젤·라이브젤, 3,410,000원). CRM 의 가장 최근 견적은 2025-12-12 이고
   2026년 4월 견적·출고는 0건, 영사이언스는 기관으로도 등록돼 있지 않다.
3. **허채정 · 김아리 연락처가 같은 번호로 적혀 있다.** 기업 개요에는 허채정 번호가 다르게 적혀 있어
   직원 정보 쪽 한 칸이 틀린 것으로 보인다.
4. **입사일이 11명 전부 빈칸이다.**
5. **박소정 · 주용석은 옴니스에서 비활성인데 노션에는 재직으로 적혀 있다.**
6. **주요 제품에 라이브젤이 없다.** 재무현황에는 라이브젤 매출이 있고, 옴니스 `Product` 에도 라이브젤이 있다.
   목록이 낡았다(상태 「갱신필요」와 맞다).
7. **「HADD Science History」의 2026 추진 과제가 지원사업 엑셀과 겹친다** — 디딤돌 · 바이오아이코어 · 메디바이오.

## 제안 — 어디에 담나

기준은 앞서 정한 것과 같다. **세는 것은 모델, 읽는 것은 카드, 파일은 NAS, 이미 정본이 있는 것은 옮기지 않는다.**
하나를 더한다. **지원서에 글자 그대로 들어가는 값(사업자등록번호 등)은 AI 가 고쳐 쓰는 카드에 두지 않는다.**
카드는 9-14부터 AI 가 갱신하므로, 거기 두면 번호 한 자리가 바뀌어도 모른다.

| 노션 | 옴니스 자리 | 이유 |
|---|---|---|
| 기업 개요 — 사업자번호·설립일·업종·주소·홈페이지 | **`CompanyProfile`** (한 행) | 지원서에 그대로 들어가는 값. 정확해야 하고 AI 가 바꾸면 안 된다 |
| 기업 개요 — 대표·과장 휴대폰·생년월일·이메일 | 여기서 빼서 `StaffProfile` 로 | 회사 소개에 섞인 개인정보 |
| 기업 개요 상시근로자 · 재무현황 자산/자본/부채/연도별 매출 | **`CompanyYear`** (연도당 한 행) | 연도별로 쌓이는 수치. 매출은 공급가로 저장하고 부가세 포함은 계산한다. 실적·예상·추정을 구분한다 |
| 재무현황 — 제품별 매출 v1/v2 · YTD | 저장하지 않는다 | 신청서 버전마다 달라지는 추정표다. 실적은 CRM 거래에서 센다 |
| 재무현황 — 세금계산서 2건 | **CRM 견적·출고로** (따로 확인) | 실제 거래인데 CRM 에 빠져 있다 |
| 타 업체 정보 41 | **`MarketCompany`** | `CrmOrg` 는 거래처다. 섞으면 옴니스 질문의 "거래 기관 N곳" 이 부풀려진다. 금액·업력은 표기가 제각각이라 원문 글자로 두고, 국가는 이름 괄호에서 떼어 칸으로 |
| 직원 정보 11 | **`StaffProfile`** (User 에 선택 연결) · **ADMIN 만 열람** | User 에 없는 사람(외부 연구원)이 있어 User 를 늘리지 않는다. AI 도구에는 이름·소속·직책·담당업무만 연다 |
| 직원 서명 이미지 8 | **넣지 않는다.** NAS 경로만 | 서명은 문서에 찍히는 것이라 DB·검색·AI 어디에도 두지 않는다 |
| 조직도 hwpx · 직원 xlsx · 로고 이미지 9 | NAS 파일 + 참조 | 파일은 파일로 |
| 회사 로고 용도표 | 카드 (표기·브랜드) | 읽는 것. 파일은 NAS 를 가리킨다 |
| 주요 제품·서비스 | 카드 (제품), `Product` 에 연결 | 서술. 낡아 있어 AI 갱신 대상으로 둔다 |
| HADD Science History (2026 계획) | 연혁 모델(`CompanyRecord`)의 **계획** 상태 행 | `mydocs/plans/2026-09-10-company-records.md`. 지원사업 엑셀과 겹치는 3건은 엑셀이 정본 |
| 보유 IP 현황 | 옮기지 않는다 | `ip` 스키마(상표 16 · 특허 11)가 정본이다. 읽지도 못했다 |
| 목차의 상태·기준일·담당자·태그 | 각 레코드의 `asOf` · `reviewStatus` · `owner` · `usage[]` | 과제용·인증용·내부용 태그는 지원서 작성 때 거를 기준이 된다 |

### 모델 초안

```prisma
/// 회사 기본정보 — 지원서에 글자 그대로 들어가는 값. AI 가 쓰지 않는다.
model CompanyProfile {
  id            String   @id @default("hadd")
  nameKo        String
  nameEn        String?
  bizRegNo      String   // 사업자등록번호
  industry      String?  // 업종
  industryCode  String?  // 국세청 업종코드
  foundedOn     DateTime?
  homepage      String?
  hqAddress     String?  // 본사
  labAddress    String?  // 연구소
  partnerAddress String? // 연구협력기관
  asOf          DateTime
  updatedById   String?
  updatedAt     DateTime @updatedAt
}

/// 연도별 수치. 매출은 공급가(원). 실적·예상·추정을 섞지 않는다.
model CompanyYear {
  year          Int      @id
  basis         String   // 실적 · 예상 · 추정
  revenueKrw    BigInt?  // 공급가
  assetsKrw     BigInt?
  equityKrw     BigInt?
  liabilitiesKrw BigInt?
  headcount     Int?     // 상시근로자
  asOfDate      DateTime?
  source        String?  // 근거 문서 (결산재무제표 · 신청서 v2 …)
  updatedAt     DateTime @updatedAt
}

/// 시장·경쟁 기업. 거래처(CrmOrg)와 섞지 않는다.
model MarketCompany {
  id            String   @id @default(uuid())
  name          String
  country       String?  // 이름 괄호에서 뗀 것
  segment       String?  // Global · Media & Culture gel · 오가노이드 회사 · Culture chip & dish · CRO
  homepage      String?
  products      String?  // 주력상품
  industry      String?
  ceo           String?
  foundedRaw    String?  // "2017년(8년차)" 원문
  capitalRaw    String?  // "1억 4천" 원문
  revenueRaw    String?
  headcountRaw  String?
  animalAlternative Boolean? // 동물대체시험법
  address       String?
  note          String?
  source        String   @default("notion")
  updatedAt     DateTime @updatedAt
  @@unique([name])
}

/// 인력 프로필. User 가 아닌 사람(외부 연구원)도 담는다. ADMIN 만 연다.
model StaffProfile {
  id            String   @id @default(uuid())
  userId        String?  @unique
  user          User?    @relation(fields: [userId], references: [id])
  name          String
  affiliation   String   // 하드사이언스 · 성균관대학교 · EAS
  position      String?
  employment    String   @default("재직")
  education     String?
  major         String?
  duties        String?
  ntisNo        String?  // 과학기술인번호
  email         String?
  phone         String?  // 넣을지 확인 필요
  birthDate     DateTime? // 넣을지 확인 필요
  joinedOn      DateTime?
  signaturePath String?  // NAS 경로만. 이미지는 DB 에 두지 않는다
  updatedAt     DateTime @updatedAt
}
```

### 이식 방법

`scripts/import-notion-company.ts` — CRM·연혁 이식과 같이 **dry-run 이 기본, `--apply` 로 쓴다.**
dry-run 은 들어갈 행과 위 대조 결과를 찍는다. 멱등은 이름·연도 기준 upsert.

## 확인할 것

1. **모델 넷(`CompanyProfile` · `CompanyYear` · `MarketCompany` · `StaffProfile`)으로 갈지.**
2. **직원 생년월일·휴대폰을 넣을지.** 지원서에 필요하면 ADMIN 만 보게 넣고, 아니면 빼는 것을 권한다.
   서명 이미지는 어느 쪽이든 넣지 않는다.
3. **매출을 공급가 기준으로 저장**하고 부가세 포함은 계산하는 것.
4. **세금계산서 2건을 CRM 에 추가**할지 (영사이언스는 기관부터 만든다).
5. **노션이 앞으로도 원본인지.** 원본으로 남으면 반복 동기화 스크립트로, 이식 뒤 옴니스가 원본이면 한 번만 옮기고 편집 화면을 만든다.
6. 틀린 값 — 허채정·김아리 같은 연락처, 박소정·주용석 재직 여부 — 을 어느 쪽으로 고칠지.
