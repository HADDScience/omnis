---
kind: canonical
status: active
canonical: mydocs/tech/crm.md
last_verified: 2026-09-16
---

# CRM — 기관 · 견적 · 샘플 · 출고 · 재고 · 생산

엑셀 시트 여러 장으로 돌던 영업·재고 장부를 옮겨 온 영역이다. 모델은
`prisma/schema.prisma` 의 `Crm*`, 계산은 `lib/crm.ts`, 화면은 `app/(main)/crm/`,
쓰기는 `app/api/crm/`.

**모델 하나하나의 "왜"는 스키마 주석에 있다.** 이 문서는 그것을 옮겨 적지 않는다.
여기 담는 것은 **모델 사이를 가로지르는 규칙** — 어느 것이 어느 것을 만드는지,
무엇을 믿고 무엇을 믿지 않는지다.

## 흐름

```
CrmOrg ─┬─ CrmContact ─────────────────────┐
        ├─ CrmMembership (HRP, 할인 제안)   │
        │                                   ↓
        ├─ CrmQuote ── CrmQuoteItem ──→ CrmShipment ──→ CrmStockMove(OUT)
        │                    ↑                              ↑
        └─ CrmSampleRequest ─┘                              │
                                                            │
                     CrmProduction ── OUT(원료) + IN(완제품) ┘
                          ↑
                     CrmProduct (isMaterial 로 원료/완제품이 갈린다)
```

기관(`CrmOrg`)이 모든 것의 뿌리다. 견적·샘플요청·출고·세금계산서가 전부 기관에
매달린다. 엑셀이 기관명·담당자명 **문자열**로 시트를 잇던 것을 전부 FK 로 바꿨고,
그래서 "담당자명에 직함을 쓰지 말라" 같은 규칙이 사라졌다 — 직함은 별도 칸이다.

## 지켜야 하는 것

### 1. 현재고는 어디에도 저장하지 않는다

```
현재고 = Σ CrmStockMove(IN) − Σ CrmStockMove(OUT)
```

요약 칸을 두지 않는다. `lib/crm.ts` 의 `stockBalance()` 하나만 쓴다.

엑셀은 요약 칸을 따로 두고 출고를 "별도 관리" 했다. 그 결과 **출고 기록 23건이
있는데도 총 출고량이 0 으로 남아 있었다.** 요약 칸이 있으면 언젠가 장부와 어긋나고,
어긋난 순간 어느 쪽이 맞는지 아무도 모른다.

### 2. 장부 줄은 사건에서 자동으로 나온다 — 같은 트랜잭션 안에서

| 사건 | 만들어지는 장부 줄 |
|---|---|
| 출고 `POST /api/crm/shipments` | 완제품 **OUT** 1줄 (`shipmentId` 로 되짚어진다) |
| 생산 `POST /api/crm/productions` | 원료 **OUT** + 완제품 **IN**, 두 줄 (`productionId`) |
| 사람이 직접 `POST /api/crm/stock` | 1줄. `shipmentId`·`productionId` 가 **비어 있다** |

앞의 둘은 `prisma.$transaction` 안에서 만들어진다. 출고만 저장되고 장부가 빠지는
상태가 생기지 않는다. 화면에서 이동 내역의 "직접 적은 줄"과 "사건에서 나온 줄"을
가르는 기준도 이 두 칸이다(`fromRecord`).

**생산이 원료와 완제품을 잇는 유일한 고리다.** 이게 없으면 "DNA 를 썼는데 제품이
어디서 왔는지"를 아무도 모른 채 두 장부가 따로 논다. 엑셀이 그랬다.

### 3. 재고 실사는 뺄셈을 사람에게 시키지 않는다

화면(`components/crm/stock-panel.tsx`)에 "더하기(입고)"와 "센 값으로 맞추기(실사)"
두 모드가 있다. 실사를 고르면 **센 값과 장부의 차이만큼** 장부 줄을 적는다. 사람이
현재고를 보고 뺄셈해서 넣는 일이 없다. 차이가 0 이면 아무것도 적지 않는다.

### 4. 단위는 품목이 정한다

`CrmProduct.stockUnit` — 원료는 `GRAM`, 완제품은 `PIECE`.

예전에는 원료도 "DNA 5g 15개"처럼 개로 셌다. 5g 병과 4.5g 병이 섞이면 개수만으로는
몇 그램인지 알 수 없고, **생산에 쓰는 것은 그램이다.** 그래서 `CrmStockMove.quantity`
는 `Decimal(12,3)` 이다 — 정수로 두면 4.5g 을 적을 수 없다.

합산의 부동소수 오차는 소수 셋째 자리에서 자른다(장부 정밀도와 같게).

### 5. 모르는 값을 1 로 가정하지 않는다

완제품 한 개에 드는 원료:

```
gramsPerUnit = volumeMl × concentrationPct / 100      # 1wt% = 1ml 당 0.01g
```

`volumeMl` 이나 `concentrationPct` 가 비어 있으면 **`null` 을 준다.** 1 로 가정하면
화면은 그럴듯한 숫자를 보여 주지만 재고가 조용히 틀어진다. 계산을 안 하는 편이 낫다.

이 값은 **계산용이다. 화면에 찍을 때만 반올림한다** — `gramsPerUnit` 자체를 미리
자르면 소요량이 틀어진다. (`0.022199999999999998g` 로 나오던 것을 표시 단계에서만
소수 넷째 자리로 줄였다.)

### 6. 견적 금액 식은 한 곳에만 있다

`lib/crm.ts` 의 `quoteTotals()`:

```
공급가 = Σ 수량 × 단가
할인   = min(max(discount, 0), 공급가)     ← 음수 소계가 생기지 않게
소계   = 공급가 − 할인
부가세 = round(소계 × vatRate / 100)
합계   = 소계 + 부가세
```

엑셀에서는 이 식이 셀 수식으로 흩어져 있었고 **13건 중 7건에서 할인이 소계에
반영되지 않았다.** 화면·API·이식 스크립트가 전부 이 함수만 쓰게 해서 같은 일이
다시 생기지 않게 한다.

`CrmMembership`(HRP)이 활성이면 할인을 **제안**하지만 강제하지 않는다.
`CrmQuote.discountAmount` 에는 **실제로 깎인 금액만** 담는다 — 엑셀은 회원이면
400,000 을 자동으로 적었는데 13건 중 8건은 소계에서 빠지지 않았다(단가에 녹인 것으로
보인다).

### 7. 단가는 견적에 복사된다

`CrmQuoteItem.unitPrice` 는 견적 당시 단가의 **사본**이다. `CrmProduct.unitPrice` 를
고쳐도 지난 견적 금액은 변하지 않는다. 지난 견적서를 다시 열었을 때 그때 보낸 금액과
달라지면 안 되기 때문이다.

### 8. 코드는 "최대값 + 1", 충돌은 DB 가 막는다

`ORG001` · `CT001` · `PRD001` · `SH001` · `HADD260904-001` · `MFG260904-001`.

읽고 쓰는 사이가 열려 있어 두 사람이 동시에 만들면 같은 번호를 노린다. 테이블을
잠그는 대신 **unique 제약에 부딪힌 쪽만 번호를 다시 뽑아 재시도**한다
(`lib/crm-server.ts` 의 `createWithUniqueCode`, 최대 5회).

실제로 났던 일이다 — 만들기 버튼이 두 번 눌려 둘 다 `ORG024` 를 시도했고 한쪽이
500 으로 떨어졌다.

날짜 코드(`HADD{YYMMDD}-{일련}`)의 날짜는 **UTC 자정** 기준으로 다룬다. 지역 시간으로
읽으면 시간대에 따라 하루가 밀린다.

### 9. 품목은 지우지 않고 보관한다

`CrmProduct.archived = true`. 재고·제품 목록에서 사라지고 지난 견적·출고 기록은
그대로 남는다.

행을 지우면 그 품목을 참조하는 견적 항목과 출고가 같이 깨진다. 2026-09-09 에
애드젤 5ml(1ml × 5ea)와 고정제를 내렸을 때도 보관 처리했다 — 각각 견적 5건·출고 6건,
출고 1건이 걸려 있었다.

## 화면

| 경로 | 무엇 |
|---|---|
| `/crm` | CRM 홈 |
| `/crm/orgs`, `/crm/orgs/[orgId]` | 기관·담당자 |
| `/crm/quotes`, `/crm/quotes/new`, `/crm/quotes/[quoteId]` | 견적 |
| `/crm/samples`, `/crm/samples/new` | 샘플요청 |
| `/crm/inventory` | 재고·생산. 원료와 완제품이 한 화면에 |

재고 화면의 완제품은 **제품 → 타입 → 용량** 세 단으로 묶는다. 평평한 목록에서는
애드젤이 시린지 5ml · 시린지 2ml · 바이알 5ml · 세트 · 동결건조로 다섯 줄에 흩어져
"애드젤이 통틀어 몇 개인지"를 사람이 눈으로 더해야 했다. `kind` 가 빈 품목
(라이브젤 · 고정제)에 "기타" 같은 이름을 지어 붙이지 않는다 — 없는 분류를 만드는
셈이라 소제목 없이 제품 바로 아래 둔다. 용량 정렬은 `spec` 문자열이 아니라
`volumeMl` 숫자로 한다(`10ml` 이 `1ml` 옆에 붙지 않게).

## 이 문서 밖

- 모델별 칸의 뜻과 그 칸이 왜 있는지 — `prisma/schema.prisma` 의 `Crm*` 주석
- 세금계산서(`TaxInvoice`)와 회사 정보 — [`company-context.md`](company-context.md)
- 엑셀에서 옮겨 올 때 밟은 함정 — [`../plans/archives/2026-09-04-crm.md`](../plans/archives/2026-09-04-crm.md) ·
  [`../working/2026-09-04-crm-1~3단계.md`](../working/2026-09-04-crm-1~3단계.md)
- 재고 화면 그룹화의 전후 실측 — [`../working/2026-09-09-narrow-viewport-and-inventory.md`](../working/2026-09-09-narrow-viewport-and-inventory.md)
