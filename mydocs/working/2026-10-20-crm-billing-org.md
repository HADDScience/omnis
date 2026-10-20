---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-20-crm-billing-org.md
last_verified: 2026-10-20
---

# CRM 청구처 — 구현 · 로컬 검증

계획: [`../plans/2026-10-20-crm-billing-org.md`](../plans/2026-10-20-crm-billing-org.md) · 브랜치 `feat/crm-billing-org`
대상 DB: 로컬 `localhost:5433/omnis`(운영 스냅샷). 운영 DB 는 건드리지 않았다.

## 바뀐 것

| 파일 | 무엇 |
|---|---|
| `prisma/schema.prisma` · `migrations/20261020000000_crm_billing_org` | `CrmOrg.billingOrgId`(NULL 허용, 기본값 없음, 자기 참조 FK `ON DELETE SET NULL`) |
| `lib/crm.ts` | `orgUpdateSchema`(PATCH 전용) · `billingOrgProblem`(자기 자신 · 두 단계 거부) |
| `app/api/crm/orgs/[orgId]/route.ts` | 청구처 검증 후 저장. 거부는 400 |
| `components/crm/billing-org-field.tsx` · `crm/orgs/[orgId]/page.tsx` | 기관 상세 제목 아래 「세금계산서 받는 곳」. 남의 청구처인 기관에는 고르는 칸 대신 「대신 받는 기관」 목록 |
| `lib/tax-invoice-save.ts` · `lib/crm-invoice-match.ts` | 잇기가 청구처를 둔 기관의 견적까지 본다. 다른 기관 후보는 자기 견적만 |
| `crm/quotes/[quoteId]/page.tsx` | 받는 곳 아래 「세금계산서는 ○○ 앞으로」. 후보 계산서는 청구처 앞 것을 먼저 |
| `scripts/backfill-billing-org.ts` · `scripts/verify-billing-org.ts` | 백필(가천대 1쌍) · 규칙 시험 |
| `mydocs/tech/crm.md` 규칙 10 · `company-context.md` | 규칙 · 가천대 사례 갱신 |

계획과 달라진 것: 견적 상세에도 청구처를 한 줄 보이게 했다. 계획 3단계의 후보 정렬을 화면에서 확인할 수 있게 하려는 것이다.

## 실측

### 마이그레이션

```
$ npx prisma migrate deploy
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
All migrations have been successfully applied.
$ npx prisma migrate diff --from-url <로컬> --to-schema-datamodel prisma/schema.prisma --script
-- This is an empty migration.
```

### 품질 게이트

```
$ pnpm run verify
✖ 43 problems (0 errors, 43 warnings)      ← 경고 43건은 변경 전 main 과 같은 기존 파일
exit 0
```

### 규칙 시험 — 거부되어야 하는 경우 포함

```
$ npx tsx scripts/verify-billing-org.ts
[1] 청구처로 둘 수 없는 것
✓ 자기 자신 → true
✓ 청구처가 또 청구처를 둔 기관 → true
✓ 이미 남의 청구처인 기관에 청구처를 둔다 → true
✓ 없는 기관 → true
✓ 학과 → 산학협력단 (허용) → null

[2] 산학협력단 앞 계산서 → 학과 견적
✓ 청구처 없음 — 기관은 산학협력단 그대로 → ["가천대학교 산학협력단","사업자번호"]
✓ 청구처 없음 — 견적 → null
✓ 청구처 없음 — 다른 기관 후보 (학과 이름으로 한 번) → [{"orgName":"가천대 의과대학","quoteCode":"HADD-학과"}]
✓ 청구처 있음 — 기관은 산학협력단 그대로 → ["가천대학교 산학협력단","사업자번호"]
✓ 청구처 있음 — 견적 → "HADD-학과"
✓ 청구처 있음 — 다른 기관 후보 (학과 이름으로 한 번) → [{"orgName":"가천대 의과대학","quoteCode":"HADD-학과"}]

[3] 청구처가 있어도 잇지 않아야 하는 것
✓ 합계가 다르면 → null
✓ 90일이 넘으면 → null
✓ 다른 기관 앞 계산서가 학과 견적을 다른 기관 후보로 두 번 내지 않는다 → 1

전부 통과
```

### 빈값 — 바꾸기 전과 같은가

매출 세금계산서 전부를 `matchOrg → matchQuote → quotesElsewhere` 로 다시 잇고 결과를 비교했다
(승인번호 · 기관 · 방법 · 견적 · 다른 기관 후보). 기준선은 코드를 바꾸기 전에 뽑았다.

```
청구처 비어 있음 vs 바꾸기 전:  차이 없음 (32건)

$ npx tsx scripts/backfill-billing-org.ts
대상 local — 찍기만 (--apply 없음)
→ 채울 것 가천대 의과대학 → 가천대학교 산학협력단
청구처가 채워진 기관 0 / 전체 66
$ npx tsx scripts/backfill-billing-org.ts --apply
✓ 채움 가천대 의과대학 → 가천대학교 산학협력단
청구처가 채워진 기관 1 / 전체 66
$ npx tsx scripts/backfill-billing-org.ts --apply        ← 다시 돌려도 같다
= 이미 가천대 의과대학 → 가천대학교 산학협력단

백필 뒤 vs 바꾸기 전:
< 20250305-10250305-62931139	가천대학교 산학협력단	사업자번호	-	HADD250305-005
> 20250305-10250305-62931139	가천대학교 산학협력단	사업자번호	HADD250305-005	-
```

달라진 것은 가천대 2025-03-05 한 장뿐이다. 「다른 기관에 맞는 견적이 있다」에서 학과 견적 `HADD250305-005` 연결로 바뀌었다.
이 비교는 잇기 **계획**이다. 이미 저장된 `TaxInvoice.quoteId` 는 바꾸지 않았다.

### API

```
$ curl -X PATCH localhost:3100/api/crm/orgs/x -d '{"billingOrgId":null}'
{"error":"인증 필요"} 401
```

## 남은 것

- [ ] 로그인한 화면 확인: 기관 상세에서 청구처 고르기 · 되돌리기, 거부 토스트, 견적 상세의 한 줄과 후보 정렬
- [ ] `narrow-audit` 320~200px — `/crm/orgs/<가천대 의과대학>` · `/crm/quotes/<HADD250305-005>`. 로그인 정보가 필요하다
- [x] 운영 반영 (2026-10-20 작업지시자 「운영 반영해줘」) — PR #93

  ```
  $ prisma migrate status   (Neon)
  Following migration have not yet been applied:
  20261020000000_crm_billing_org
  $ prisma migrate deploy
  All migrations have been successfully applied.
  $ npx tsx scripts/backfill-billing-org.ts --target prod
  → 채울 것 가천대 의과대학 → 가천대학교 산학협력단
  청구처가 채워진 기관 0 / 전체 68
  $ npx tsx scripts/backfill-billing-org.ts --target prod --apply
  ✓ 채움 가천대 의과대학 → 가천대학교 산학협력단
  청구처가 채워진 기관 1 / 전체 68
  $ gh pr checks 93
  verify pass · e2e pass · Vercel omnis-hadd pass · omnis-demo pass
  ```
- [ ] 운영에서 가천대 2025-03-05 계산서를 견적 상세의 「이 세금계산서가 맞아요」로 잇기 — 사람이 한다
