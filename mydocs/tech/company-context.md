---
kind: canonical
status: active
canonical: mydocs/tech/company-context.md
last_verified: 2026-09-15
---

# 회사 Context — HADD DB 의 회사 · 인력 · 연혁 · 세금계산서

PR #11(회사 Context) · PR #13(서명·직인 보관)에서 들어왔다. 무엇을 왜 골랐는지는 설계 문서
[plans/2026-09-14-company-context.md](../plans/2026-09-14-company-context.md) 가 정본이고,
이 문서는 **지금 코드가 어떻게 생겼는가**를 적는다.

**옴니스가 원본이다.** 노션 「옴니스(전사적 자원관리 DB)」 는 한 번 옮기고 끝났다. 고칠 때는 옴니스 화면에서 고친다.

## 모델 (`prisma/schema.prisma`)

| 모델 | 무엇 | 요점 |
|---|---|---|
| `CompanyProfile` | 회사 기본정보 한 행(id `hadd`) | 사업자 형태 `bizType` 은 「개인과세사업자」 (2026년 법인 전환 안 함 — 작업지시자) |
| `CompanyYear` | 연도별 재무 · 인원 | `(year, basis)` 유일. 금액은 원, 매출은 **공급가액**(부가세 제외) |
| `CompanyRecord` | 연혁 · 실적 | `kind` 8종 · `dedupeKey` 로 이식 멱등 · 원문 기간 `periodRaw` 를 화면에 쓴다 |
| `StaffProfile` · `StaffAsset` | 인력 · 서명/직인 이미지 | 관리자만. 실물은 NAS, DB 에는 키만 |
| `MarketCompany` | 시장 · 경쟁 기업 | 거래처(`CrmOrg`)와 섞지 않는다 — 섞으면 「거래 기관 N곳」 이 부풀려진다 |
| `TaxInvoice` · `TaxInvoiceItem` | 홈택스 전자세금계산서 | 승인번호 유일 · `direction` 매출/매입 · `readBy` text/vision · 기관 · 견적 연결 |

### 매출의 세 단계 — 확정 · 잠정 · 계획

- `FigureBasis` 에는 **`CONFIRMED`(결산서) · `PLANNED`(예상 · 추정)** 두 값만 있다.
- **잠정(`PROVISIONAL`)은 저장하지 않는다.** 결산 전인 해의 세금계산서 공급가액 합을 매번 센다(`lib/company-context.ts` `invoiceRevenue`).
  라벨은 `BASIS_LABEL` 에만 있다. 저장하면 세금계산서가 늘 때마다 두 곳이 어긋난다.
- 두 수가 다르면 확정이 이긴다. `/omnis/company` 는 확정 연도 옆에 세금계산서 합과의 차이를 적는다
  (2025 결산 307,481,423 · 세금계산서 합 307,478,823 · 차이 2,600원).
- 제품 · 용역을 따로 센다. 2025년은 용역이 약 89%다 — 합쳐 적으면 제품 실적이, 제품만 적으면 매출이 틀린다.

### `CompanyRecord.kind`

`GRANT` 지원사업 · `AWARD` 수상 · `EXHIBITION` 학회·전시 · `FORUM` · `EDUCATION` · `NETWORKING` · `INTERNAL` 내부행사 · `MILESTONE` 주요 사건.
특허 · 상표는 `ip` 스키마가 정본이라 담지 않는다. 연혁과 상세 시트(지원사업 · 수상 · 학회)의 날짜가 다르면 상세 시트가 정본이다.

## 화면

| 경로 | 누가 | 무엇 |
|---|---|---|
| `/omnis` | 전원 | HADD DB 랜딩 타일 — 회사 · 연혁 · 시장기업, 관리자에게만 인력 |
| `/omnis/company` | 전원 읽기 · 관리자 편집 | 기본정보 · 연도별 재무(확정 · 잠정 · 계획). 편집 입력 규칙 `lib/schemas/company.ts` 를 폼과 API 가 같이 쓴다. 잠정은 저장 불가. 활동 기록에는 바뀐 **칸 이름만** |
| `/omnis/records` | 전원 | 연혁 · 실적 |
| `/omnis/market` | 전원 | 시장기업 |
| `/omnis/staff` | **관리자** | 인력 · 서명/직인 복사 · 파일 받기 · 바꾸기/올리기 |
| `/omnis/context` | 전원 | Context 그래프 (아래) |
| `/crm/invoices` | 전원 | 세금계산서 목록 · 올리기 · 원본 열기 |

연혁 · 인력 · 시장기업 편집 화면은 아직 없다(2026-09-14 기준 미착수).

## CRM 세금계산서 올리기

`POST /api/crm/invoices` 를 두 번 부른다. 저장은 `lib/tax-invoice-save.ts` 하나로, 이식 스크립트도 같은 길을 쓴다.

```
mode=preview  읽기 → 기관 · 견적 잇기 계획(planInvoice) → 저장 막는 사유(saveBlockers). 아무것도 저장하지 않는다
   ↓ 사람이 확인 (AI 판독이면 원본과 대조했다는 체크)
mode=confirm  서버가 같은 파일을 다시 읽는다 → 저장(NAS 원본 → DB) → 활동 기록 crm.invoice.uploaded
```

- **읽기 두 단** (`lib/tax-invoice.ts`)
  1. `unpdf` 로 글자 조각과 좌표를 꺼내 칸을 좌표로 배정한다. 로컬 `pdftotext` 는 Vercel 에 없다.
  2. 글자가 없거나 검산이 틀리면 Gemini 에 파일을 그대로 보인다(`readBy = "vision"`).
- **검산**은 둘 다 같다: 품목 공급가 합 = 공급가액, 공급가액 + 세액 = 합계.
- **브라우저가 보낸 판독값을 믿지 않는다.** confirm 에서 다시 읽은 승인번호 · 합계가 미리보기(`expectApprovalNo` · `expectTotal`)와 다르면 409.
- **AI 판독은 `acceptVision=1` 없이 저장하지 않는다**(409). AI 판독은 읽을 때마다 한 번 더 부른다(장당 약 4원).
- 형식 PDF · PNG · JPG, 4MB 이하(`MAX_UPLOAD_BYTES`).
- 방향: 공급자 사업자번호가 우리(503-52-46329)면 매출.
- pdf.js 가 넘긴 버퍼를 떼어 가므로(transfer) 글자 판독에는 사본을 넘긴다 — 같은 버퍼를 비전에 넘기면 빈 파일이 간다.
- NAS 의 `docs/processed/*.md` 변환본은 쓰지 않는다. 공급자와 공급받는자를 뒤바꿔 적은 사례가 있다.
- 자동으로 잇지 않고 표시만 하는 경우가 있다 — 2025-03-05 가천대학교 산학협력단 세금계산서와 「가천대 의과대학」 견적은 서로 다른 기관이다(작업지시자).

## Context 그래프 (`lib/context-graph.ts` · `/omnis/context`)

- 대상 하나를 가운데 두고 **한 단계**만 펼친다. 실선 = 외래키, 점선 = 임베딩 유사도 0.7 이상. 옆에 AI 가 읽는 조각.
- **LLM 호출이 없다.** 외래키 조회와 이미 저장된 임베딩 사이 거리뿐이라 GraphRAG 가 아니다(설계 2차 결정 1).
- 채팅 조각은 이웃 후보에서 뺀다 — 넣으면 이웃 40개가 전부 채팅이었다. 업무 스레드 조각은 패널에만.
- 새 모델(연혁 · 세금계산서 · 기관 · 인력)은 임베딩이 없어 점선이 없다. **인력은 개인정보라 앞으로도 임베딩하지 않는다.**
- 인력 노드는 관리자에게만 보인다(`loadNeighborhood(key, { isAdmin })`).

## 옴니스 AI · MCP 도구 (`lib/company-tools.ts`)

`lib/omnis-mcp.ts` 의 도구 6개가 부른다. 화면의 옴니스 질문(`lib/omnis-ask.ts`)도 같은 `runTool` 을 쓴다.

| 도구 | 무엇 |
|---|---|
| `company_profile` | 기본정보 · 연도별 재무(확정 · 잠정 · 계획) |
| `list_company_records` | 연혁 · 실적 (`query` · `kind` · `year`) |
| `list_tax_invoices` | 세금계산서 · 연도별 매출 합 (`year` · `org`) |
| `list_staff` | 인력 |
| `list_market_companies` | 시장기업 |
| `get_context` | 그래프 이웃 (`node` 또는 `query`) |

**개인정보는 도구로 내보내지 않는다.** `list_staff` 는 이름 · 소속 · 직급 · 하드사이언스 직함 · 담당 · 학력 · 4대보험 · 입사일만 읽는다.
연락처 · 이메일 · 생년월일 · 과학기술인번호(NTIS) · 서명 · 직인은 조회 자체를 하지 않는다.
도구 결과는 모델 공급자와 외부 MCP 커넥터로 나가기 때문이다. 필요하면 관리자가 인력 화면에서 본다.
비재직 4명은 이름 · 소속 · 비재직 표시만 옮겼다.

## 서명 · 직인 보관 (`lib/staff-assets.ts`)

- **운영 폴더: NAS `/HADD Science/08. 개인정보/옴니스 서명·직인`.** 첨부파일 폴더(`옴니스 첨부파일/files`)가 아니다 — 작업지시자 결정(2026-09-14).
- 로컬은 `SYNOLOGY_STAFF_ASSETS_PATH` 로 `_dev` 아래 폴더를 가리킨다. 비어 있으면 운영 경로를 쓴다.
- 키 `<staffId>/<signature|seal>-<md5 앞 12자>.<png|jpg>`. 내용이 같으면 키가 같아 다시 쓰지 않는다.
- 형식은 파일 앞 바이트로 확인한다(PNG · JPG). 브라우저가 붙인 MIME 은 믿지 않는다.
- 폴더 첫 사용 때 `읽어주세요.txt` 를 만든다. 이미 있으면 건드리지 않는다.
- **예전 키 `staff/…`** 는 첨부파일 폴더 기준으로 읽고 지운다. `scripts/move-staff-assets.ts` 가 읽기 → 새 폴더 쓰기 → md5 대조 → DB 키 변경 → 예전 파일 삭제 순으로 옮긴다.
- **관리자만.** `app/api/company/staff-assets/[assetId]`(복사 · 받기) · `app/api/company/staff/[staffId]/assets`(올리기 · 바꾸기)는 ADMIN 이 아니면 403.
  꺼내거나 바꿀 때마다 활동 기록 `staff.asset.copied` · `downloaded` · `uploaded` · `replaced`.
  「이 제출 서류에 누구 서명이 쓰였나」 를 되짚으려고 남긴다.
- **폴더 권한은 코드가 좁히지 못한다.** 옴니스는 NAS 에 WebDAV 계정 하나로 붙고, ACL 은 WebDAV 로 바꿀 수 없다.
  DSM 에서 `08. 개인정보/옴니스 서명·직인` 권한을 손으로 좁혀야 한다(2026-09-14 기준 미착수).

## 이식 스크립트 (`scripts/import-company-context.ts`)

```bash
npx tsx scripts/import-company-context.ts                        # dry-run — 들어갈 행과 대조표만
npx tsx scripts/import-company-context.ts --apply                # 쓴다 (서명 · 세금계산서는 NAS 에 올린다)
npx tsx scripts/import-company-context.ts --only records,staff   # 일부만
```

- 입력은 저장소 밖 `~/work/omnis-import`(`OMNIS_IMPORT_DIR`). 개인정보가 있어 저장소에 두지 않는다.
- 멱등이다 — 연혁은 `dedupeKey`, 인력 · 시장기업은 이름, 연도는 `(연도, 단계)` 로 upsert.
- AI 판독 세금계산서는 `--accept-vision` 이 있어야 저장한다(사람이 확인한 뒤).
- 로컬 공용 DB `omnis` 에는 `--i-know-this-is-shared` 없이 쓰지 않는다.
- **어느 NAS 폴더에 올라가는지는 실행 환경의 설정이 정한다.** 2026-09-14 에 로컬 설정으로 돌려 서명 · 세금계산서가
  `옴니스 첨부파일/_dev/files` 에 올라간 적이 있다. 운영은 `옴니스 첨부파일/files` 다.

## 배포 순서와 데모

- **운영 DB 에 `prisma migrate deploy` 먼저, 머지 나중.** Vercel 운영 빌드는 마이그레이션을 돌리지 않는다.
  새 표를 읽는 코드가 먼저 나가면 화면이 없는 표를 읽다 오류가 난다. 회사 Context 마이그레이션은 `20260914030000_company_context`.
- **데모(`NEXT_PUBLIC_IS_DEMO`)에는 NAS 가 없다.** 세금계산서 올리기 · 원본 열기 · 서명 복사/받기/올리기 API 는
  `demoStorageBlocked()`(`lib/demo.ts`)로 403, 화면은 버튼 대신 안내. 데모 데이터는 `prisma/demo-seed.ts` 의 가상 데이터이고 서명은 없다.
  자세한 건 [manual/ux-rules.md](../manual/ux-rules.md) 「시연 데모 환경」.

## 관련

- 설계 · 결정: [plans/2026-09-14-company-context.md](../plans/2026-09-14-company-context.md)
- 겪은 문제: [troubleshootings/pr-traps-2026-09.md](../troubleshootings/pr-traps-2026-09.md) PR #11 · #13
- MCP 도구 전체: [omnis-mcp.md](omnis-mcp.md)
