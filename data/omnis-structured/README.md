# 옴니스 구조화 데이터 (Structured Data)

> 옴니스 카드(.md)는 사람이 읽는 서술형 요약. 이 디렉토리(.json)는 검색·필터·집계·노션 DB 매핑이 가능한 정형 데이터.

생성일: 2026-05-09
출처: `../../docs/raw-converted/` (readitdown으로 XLSX/PDF에서 변환)

## 파일 인덱스

| 파일 | 행 수 | 출처 | 권장 노션 DB 매핑 |
|------|-------|------|---|
| `ip-portfolio.json` | 특허 8 + 상표 5 | 특허 및 상표권_260402.xlsx | 신규 DB: `IP 포트폴리오` |
| `certifications.json` | 4 | 기업인증/*.pdf + 중소기업확인서.pdf | 신규 DB: `보유 인증` |
| `crm-organizations.json` | 18 | CRM_260508.xlsx > 기관마스터 | 신규 DB: `거래처 기관` |
| `crm-contacts.json` | 18 | CRM_260508.xlsx > 컨택포인트 | 신규 DB: `컨택포인트` (기관 relation) |
| `hrp-members.json` | 9 | CRM_260508.xlsx > HRP Membership | 신규 DB: `HRP 회원` (기관 relation) |
| `products.json` | 10 | CRM_260508.xlsx > 제품마스터 | 신규 DB: `제품` |
| `quotes.json` | 13 | CRM_260508.xlsx > 견적 | 신규 DB: `견적/주문` |
| `sample-requests.json` | 8 | CRM_260508.xlsx > 샘플요청 | 신규 DB: `샘플 발송` |
| `sales-transactions.json` | 15 | 2024~2025 세금계산서 정리.xlsx | 신규 DB: `세금계산서/매출` |
| `timeline.json` | 120+ | 260316_하드사이언스_히스토리.xlsx | 신규 DB: `회사 연혁` |
| `support-programs.json` | history 25 + in_review 19 + always_open 5 | 시책 설명회 + 신청서 모음 | 신규 DB: `지원사업` |
| `companies-market.json` | 경쟁사 31 + 글로벌 16 + 시장 16지표 | 타업체정보 + market_size_research | 신규 DB: `타업체정보` + `시장지표` |
| `employees.json` | 10명 | 명함_데이터.csv + 바이오아이코어 신청서 + NTIS 7건 | 신규 DB: `직원` |

## 스키마 규칙

- 모든 JSON 파일에 `schema_version`, `extracted_at`, `source` 메타데이터 필수.
- 날짜는 ISO 8601 (`YYYY-MM-DD`) 형식.
- 통화는 KRW 숫자(원 단위), `currency: "KRW"` 명시.
- 결측값은 `null` (빈 문자열/`"N/A"` 사용 금지).
- 외래키(예: `org_code` → `organizations.code`)는 동일 값으로 일관 유지.

## 노션 DB 매핑 가이드

### 우선순위 1 (자사 핵심 자산)
1. **IP 포트폴리오** — 13건 즉시 등록 가능 (출원/등록번호 기준 unique)
2. **보유 인증** — 4건. 만료일 기반 알림 설정 권장 (중소기업확인서 ~2026-03-31)
3. **거래처 기관 + 컨택포인트** — relation으로 연결, HRP 회원은 별도 status

### 우선순위 2 (운영 데이터)
4. **제품** — 단가 정보 보강 필요 (현재 PRD003 이후 단가 NaN)
5. **견적 + 세금계산서** — 매출 누적 집계용
6. **회사 연혁** — 카테고리 필터(주요/포럼/교육/내부행사/네트워킹)로 뷰 분리

## 데이터 충돌/주의사항

- **사업장 호수**: 정식 호수는 **505호** (사용자 확정, 2026-05-09). 인증서·표준재무제표·벤처기업확인서 등에 기재된 "514호"는 발급기관 측 오기이며 차후 갱신 시 정정 대상. JSON에는 발급 문서 표기를 그대로 두고 별도 `actual_office_address` 필드로 정정값을 명시.
- **여성기업확인서 주소**: 2024-10-07 발급 시점 주소(동탄 우정바이오 1009호) 기준이라 현재 주소와 불일치. 다음 갱신(2027-10-06)때 505호로 정정 필요.
- **HRP 번호 변경**: 원본_HRP 시트는 HRP240xxx, 메인 HRP Membership 시트는 HRP260xxx. 후자(2026 갱신)가 최신.
- **제품 단가 SSOT**: `Downloads/HD_PRICE_GUIDE.docx` (2026-05 PRICE GUIDE)가 공식 단가. CRM 제품마스터의 단가는 historical record. 신규 견적은 PRICE GUIDE 가격 사용.
- **출시 프로모션**: ADDGEL 3종 모두 정가 대비 100K 할인 가격으로 운영 중. 종료 시점 미명시.
- **EAS 거래는 HRP 미가입**: ORG016(이에이에스)은 투자사이지만 HRP 회원에 미포함. 정책 확인 필요.

## 추가 작업

- ✅ 2026-05-11: `support-programs.json`, `companies-market.json`, `employees.json` 작성 완료.
- PDF 추가 변환: `하드사이언스_정리할거/` 의 PPTX(20개), HWPX(20개), 추가 PDF는 추후 처리.
