---
kind: decision
status: active
canonical: mydocs/plans/2026-09-22-website-inquiry-to-crm.md
last_verified: 2026-09-22
---

# 홈페이지 문의를 CRM 견적으로 잇는다 (Omnis 쪽 정본)

상태: 2026-09-22 작업지시자가 알림 수신자를 확정하고 **전부 구현**을 지시했다. 배포 승인은 아직 없다.
사이트 쪽 작업은 `hadd-website` 저장소가 맡는다 —
`hadd-website/mydocs/plans/2026-09-22-contact-to-omnis-inquiry.md`.
**스키마·엔드포인트·알림의 권위는 이 문서다.** 두 문서가 다르면 이쪽을 따른다.

## 왜

홈페이지 `/contact` 의 폼은 백엔드가 없다. 제출하면 `mailto:` 로 방문자의 메일
클라이언트를 열 뿐이라, 메일 앱이 없는 브라우저에서는 아무 일도 일어나지 않고
회사에는 기록이 남지 않는다. Omnis 의 CRM 은 사람이 `/crm/quotes/new` 에서 손으로
채운다. 둘 사이에 다리가 없다.

## 핵심 결정 — 문의함을 한 층 둔다

폼은 아무나 입력할 수 있다. 받은 것을 바로 `CrmOrg`·`CrmContact`·`CrmQuote` 에 넣으면
스팸 한 건이 기관 목록을 더럽히고, 되돌리려면 지워야 한다. 접수 전용 테이블에 먼저
쌓고 **사람이 승인해야** CRM 으로 넘어간다.

```
방문자 → [사이트] POST /api/contact → [Omnis] POST /api/website/inquiries
                                          ↓
                                    WebsiteInquiry (status=NEW)  ← CRM 아님
                                          ↓ Omnis 알림
                                    사람이 /crm/inquiries 에서 검토
                                          ↓ 승인할 때만
                                    CrmOrg · CrmContact · CrmQuote(DRAFT)
```

`orgId`·`contactId`·`quoteId` 가 승인 전까지 전부 `null` 인 것이 "사람 검토" 의 실체다.

## 저장 모양

`prisma/schema.prisma` 의 홈페이지 구역(`WebsitePost` 옆)에 넣는다.

```prisma
enum WebsiteInquiryStatus {
  NEW
  ACCEPTED
  REJECTED
  SPAM
}

/// 홈페이지 /contact 폼이 보낸 문의. **CRM 이 아니다** —
/// 아무나 넣을 수 있는 입력이라, 사람이 승인해야 CrmOrg·CrmContact·CrmQuote 로 넘어간다.
model WebsiteInquiry {
  id           String   @id @default(uuid())
  createdAt    DateTime @default(now())
  name         String
  organization String?
  email        String
  phone        String?
  /// sample | pricing | technical | partnership | etc.
  /// 원본은 사이트 content/ko.ts 의 contact.form.topicOptions.
  /// Prisma enum 으로 두지 않는 이유: 사이트가 항목을 늘릴 때마다 마이그레이션이 붙는다.
  /// 대신 받는 자리(lib/website-inquiry.ts)에서 다섯 값으로 검사한다.
  topic        String
  message      String
  lang         String   @default("ko")
  /// 스팸 판정과 레이트리밋에만 쓴다. 서버 간 호출이라 사이트가 넘겨 준 값이다.
  ip           String?
  userAgent    String?

  status       WebsiteInquiryStatus @default(NEW)
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?

  /// 승인해야 채워진다. 기관·담당자·견적이 지워지면 null 로 풀리지만
  /// status 와 reviewedAt 은 남는다 — "사람이 승인했다" 는 사실이 링크보다 오래 간다.
  orgId     String?
  org       CrmOrg?     @relation(fields: [orgId], references: [id], onDelete: SetNull)
  contactId String?
  contact   CrmContact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  quoteId   String?
  quote     CrmQuote?   @relation(fields: [quoteId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([ip, createdAt])
  @@index([email, createdAt])
}
```

`CrmOrg`·`CrmContact`·`CrmQuote` 에 역관계 한 줄씩(`websiteInquiries WebsiteInquiry[]`)이 붙는다.

`reviewedById` 는 `CrmPayment.createdById` 와 같이 관계 없는 String 으로 둔다 —
`User` 모델을 건드리지 않는다.

**표를 새로 만들 뿐이라 옛 코드가 도는 중에 먼저 적용해도 안전하다.**
AGENTS.md 의 순서대로 운영 DB 에 `pnpm run db:deploy` 를 **먼저** 넣고 머지한다.

## 계약 — 사이트가 부르는 엔드포인트

`POST /api/website/inquiries` · 서버 간 호출. 브라우저가 직접 부르지 않으므로 CORS 를
주지 않는다(`/api/website/posts` 와 다른 점이다 — 거기는 관리 화면 브라우저가 부른다).

```
Authorization: Bearer <WEBSITE_INQUIRY_SECRET>
Content-Type: application/json
```

```json
{
  "name": "홍길동",
  "organization": "○○대학교 ○○연구실",
  "email": "researcher@example.ac.kr",
  "phone": "010-0000-0000",
  "topic": "pricing",
  "message": "…",
  "lang": "ko",
  "ip": "1.2.3.4",
  "userAgent": "Mozilla/5.0 …"
}
```

| 상태 | 본문 | 뜻 |
|---|---|---|
| 201 | `{ "ok": true, "id": "<uuid>" }` | 접수 |
| 200 | `{ "ok": true, "id": "<uuid>", "duplicate": true }` | 같은 것이 이미 들어와 있다 (아래 참조) |
| 400 | `{ "error": "invalid_inquiry", "issues": ["…"] }` | 형식 오류 |
| 401 | `{ "error": "forbidden" }` | 비밀 불일치 |
| 429 | `{ "error": "rate_limited" }` | 같은 IP·이메일이 너무 잦음 |
| 503 | `{ "error": "unavailable" }` | 비밀 미설정 · DB 장애 |

필수는 `name`·`email`·`message`·`topic`. `organization`·`phone` 은 빈 문자열/누락 허용.
길이 상한은 `name` 100 · `organization` 200 · `email` 200 · `phone` 50 · `message` 5000.
`consent` 는 받지 않는다 — 동의 없이는 사이트가 애초에 보내지 않고 Omnis 가 재확인할
수단이 없다. 동의 시각은 `createdAt` 이 곧 그것이다.

### 계약에 더한 것 — 사이트 계획서와 다른 네 곳

**1. 중복 접수 (200 `duplicate`).** 원안에는 멱등성이 없다. 사이트 라우트가 타임아웃으로
끊긴 뒤 재시도하면, 사이트는 앞 요청이 저장됐는지 알 수 없어 같은 문의가 두 번 쌓인다.
폼 더블클릭도 같다. 그래서 **같은 `email` + 같은 `message` 가 5분 안에 있으면 새로 만들지
않고 그 행의 id 를 200 으로 돌려준다.** 사이트는 200 과 201 을 똑같이 "접수됨" 으로 다루면 된다.

**2. `topic` 은 다섯 값만. 모르는 값은 400.** 사이트의 select 가 이미 값을 묶고 있어서,
모르는 값이 온다는 것은 배포 순서가 어긋났다는 뜻이다. 그때 방문자는 사이트의 `mailto`
되돌림을 보므로 문의를 잃지 않는다. 늘릴 때는 **Omnis 를 먼저** 배포한다.

**3. `lang` 은 `ko` | `en` 만.** 기본 `ko`. 검토 화면이 원문 언어를 표시하는 데 쓴다.

**4. `WEBSITE_INQUIRY_SECRET` 이 비어 있으면 503, 열지 않는다.** 환경변수를 빠뜨린 배포가
공개 쓰기 엔드포인트가 되는 것을 막는다. 비교는 `crypto.timingSafeEqual`, 길이가 다르면
바로 401.

### 레이트리밋 — `WebsiteInquiry` 를 직접 센다

레이트리밋 인프라가 없다. 표를 직접 센다.

- 같은 `ip` 로 10분 안에 3건 초과 → 429
- 같은 `email`(소문자로 맞춰 비교)로 24시간 안에 5건 초과 → 429
- **`status` 를 가리지 않고 센다.** SPAM·REJECTED 도 센다 — 검토자가 스팸으로 표시하는
  순간 공격자의 한도가 되살아나면 안 된다
- **`ip` 가 없으면 IP 한도를 건너뛴다.** null 을 한 칸으로 묶으면 IP 를 못 넘긴 요청
  전체가 서로를 막는다. 이메일 한도는 그대로 적용된다

### 실패해도 500 을 내지 않는다

DB 오류는 잡아서 503 `unavailable` 로 바꾼다. 사이트는 그걸 보고 `mailto` 되돌림을 띄운다.

## 알림

```ts
createNotification(
  userId,
  "website_inquiry",
  `새 홈페이지 문의: ${name}${organization ? `(${organization})` : ""}`,
  `${topicLabel} · ${message.slice(0, 80)}`,
  inquiry.id            // actionType 없음 — 단순 통보
)
```

`actionType` 을 주지 않는다. 승인/반려는 알림 버튼이 아니라 검토 화면에서 한다 —
기관을 고르고 담당자를 고르는 판단이 필요해서 예/아니오 두 개로 접히지 않는다.

**수신자 — 작업지시자 확정 (2026-09-22).** 저장소에 이미 있는 것과 같은 모양이다
(`app/api/crm/quotes/[quoteId]/route.ts:50`, 세금계산서 발행 요청이
`department contains "재무"` 로 보낸다):

1. `isActive: true` 이고 `department` 에 `"영업"` 이 들어가는 사용자
2. 1번이 비어 있으면 `role: ADMIN` 전원

로컬 스냅샷 기준 1번은 **영업마케팅팀 1명(상무)** 이다. 한 명뿐이라 휴가·퇴사에 구멍이
나므로 2번 대비책을 둔다. 대표까지 늘 받게 하는 안은 검토했으나 택하지 않았다 —
알림이 늘기만 하고, 영업 담당이 비면 어차피 ADMIN 전원에게 간다.

**알림 클릭 시 라우팅**: `components/layout/notification-bell.tsx:144` 의
`crm_invoice_request` 옆에 한 줄을 더해 `website_inquiry` → `/crm/inquiries/{entityId}`.

## 검토 화면 `/crm/inquiries`

`components/crm/crm-nav.tsx` 의 탭에 **「문의」** 를 맨 앞에 더한다 — 들어오는 것이
먼저다. 권한은 다른 CRM 화면과 같다(로그인만; 사이드바 CRM 은 역할을 가리지 않는다).

- **목록** — `NEW` 먼저, 그 안에서 `createdAt` 내림차순. 처리된 것은 아래로.
- **상세** — 받은 원문 그대로. `ip`·`userAgent`·`lang` 도 보인다(스팸 판정 근거).
- **반려 / 스팸** — `status` 와 `reviewNote` 만 바꾼다. CRM 은 건드리지 않는다.
- **승인** — 아래.

### 승인이 하는 일

한 트랜잭션 안에서:

1. `updateMany({ where: { id, status: NEW }, data: { status: ACCEPTED, reviewedById, reviewedAt } })`
   로 **먼저 선점한다.** `count === 0` 이면 이미 누가 처리한 것이므로 중단한다
   (`lib/notifications.ts` 의 `respondToAction` 과 같은 방식)
2. 기관 — 기존 `CrmOrg` 를 고르거나 새로 만든다. 새로 만들 때 코드는
   `nextCode("ORG", …)` + `createWithUniqueCode`
3. 담당자 — 같은 방식. `nextCode("CT", …)`
4. `CrmQuote` 를 `DRAFT` 로, **품목 없이** 만든다. `quotedAt` 은 승인 시각,
   `code` 는 `nextDatedCode`, `note` 에 문의 id 를 적는다
5. 문의에 `orgId`·`contactId`·`quoteId` 를 채운다

부분 승인으로 기관만 생기고 견적이 없는 상태가 남지 않게 전부 한 트랜잭션이다.

**중복 기관을 덜 만들기.** `CrmOrg.name` 은 `@unique` 다. 승인 화면은 문의의
`organization` 으로 `contains`(대소문자 무시) 검색을 걸어 후보를 먼저 띄운다.
그래도 새로 만들다 이름이 부딪히면 기존 `POST /api/crm/orgs` 와 같은 문구로
409 를 돌려준다 — "같은 이름의 기관이 이미 있습니다".

### 함정 — `quoteCreateSchema` 는 품목 0개를 막는다

`lib/crm.ts:121` 이 `items.min(1, "품목을 하나 이상 넣어 주세요")` 다. DB 제약은 아니라
`CrmQuote` 자체는 품목 없이 만들 수 있다. 승인 경로는 `POST /api/crm/quotes` 를 거치지
않고 트랜잭션 안에서 직접 만들며, 입력 검사는 새 `inquiryAcceptSchema` 를 쓴다.
`quoteCreateSchema` 는 손대지 않는다 — 손으로 쓰는 견적에 빈 품목을 허용할 이유가 없다.

품목 0개 견적이 `/crm/quotes` 목록과 상세에서 깨지지 않는지 **실제로 열어 확인한다**
(`quoteTotals([])` 는 전부 0 을 주지만, 화면이 첫 품목을 읽는 곳이 있을 수 있다).

## 환경변수

| 이름 | 어디 | 값 |
|---|---|---|
| `WEBSITE_INQUIRY_SECRET` | Omnis (Vercel Production) | 사이트의 `INQUIRY_SECRET` 과 같은 값 |
| `INQUIRY_SECRET` | 사이트 (Vercel, 서버 전용) | 위와 같은 값 |

이름은 사이트 제안대로 간다 — 이미 있는 `WEBSITE_ORIGIN`·`WEBSITE_REVALIDATE_SECRET` 과
같은 접두사다. `.env.example` 의 홈페이지 구역에 줄을 더한다. `NEXT_PUBLIC_` 를 쓰지 않는다.

값은 사람이 양쪽 Vercel 에 넣는다. `openssl rand -base64 32`.

## 건드리는 파일

| # | 무엇 | 파일 |
|---|---|---|
| 1 | 모델 · enum · 역관계 | `prisma/schema.prisma` + `prisma/migrations/20260923…_website_inquiry/` |
| 2 | 입력 스키마 · topic 목록 · 레이트리밋 · 승인 스키마 | `lib/website-inquiry.ts` (새로) |
| 3 | 접수 엔드포인트 | `app/api/website/inquiries/route.ts` (새로) |
| 4 | 검토·승인 API | `app/api/crm/inquiries/[inquiryId]/route.ts` (새로) |
| 5 | 알림 클릭 라우팅 | `components/layout/notification-bell.tsx` |
| 6 | 탭 | `components/crm/crm-nav.tsx` |
| 7 | 목록 · 상세 · 승인 화면 | `app/(main)/crm/inquiries/` · `components/crm/inquiry-*.tsx` (새로) |
| 8 | 환경변수 예시 | `.env.example` |

## 순서

사이트가 부를 대상이 먼저 서야 한다.

1. **모델 + 마이그레이션.** 운영 DB 에 `pnpm run db:deploy` 를 먼저 적용하고 머지한다
   (AGENTS.md — 마이그레이션은 운영 배포에 딸려 오지 않는다)
2. **엔드포인트 + 알림.** 여기까지 서면 사이트가 붙기 시작할 수 있다
3. 양쪽 Vercel 에 비밀 등록 → 프리뷰에서 왕복 확인
4. **검토 화면 + 승인 → 견적**
5. 개인정보처리방침 원문 (사람) — 아래

## 먼저 정해야 하는 것

| 누가 | 무엇 |
|---|---|
| 작업지시자 | **개인정보처리방침.** 이 작업 뒤 이름·이메일·연락처·IP 가 Omnis DB 에 쌓인다. 지금까지는 `mailto:` 라 회사 서버에 남지 않았다. 수집 항목·목적·보관기간·파기를 적은 원문이 공개 전에 올라가야 한다. 이 계획서의 범위 밖이고 원문은 사람이 가지고 있다 |
| 작업지시자 | **보관기간.** 방침에 적을 값이 정해지면 오래된 `SPAM`·`REJECTED` 를 지우는 일이 따라붙는다. 지금은 넣지 않는다 |

## 검증 기준

| 확인 | 방법 |
|---|---|
| 정상 접수 | 로컬 dev 에 `curl` 로 POST → `WebsiteInquiry` 1건 · 알림 1건 |
| 비밀 불일치 | 틀린 Bearer → 401, DB 0건 |
| 비밀 미설정 | `WEBSITE_INQUIRY_SECRET` 없이 기동 → 503, DB 0건 |
| 형식 | 이메일 형식 오류 · `message` 5001자 · 모르는 `topic` · 모르는 `lang` → 각각 400 |
| 중복 | 같은 email+message 를 연달아 두 번 → 201 다음 200 `duplicate`, DB 1건 |
| 레이트리밋 | 같은 IP 로 10분 안에 4건 → 4번째 429. 3건을 SPAM 으로 바꾼 뒤 1건 더 → **여전히 429** |
| 승인 | 승인 전 `orgId`·`contactId`·`quoteId` 가 전부 null → 승인 후 세 개가 채워지고 `CrmQuote.status = DRAFT`, 품목 0개 |
| 두 번 승인 | 같은 문의를 두 탭에서 승인 → 기관·견적이 하나만 생긴다 |
| 품목 0 견적 | `/crm/quotes` 목록과 상세를 실제로 연다 |
| 품질 게이트 | `pnpm run verify` · `pnpm run build` · 화면은 `narrow-audit.mjs` |

**거부되어야 하는 경우를 함께 넣는다** — 401·400·429·두 번 승인이 그것이다.

## 하지 않는 것

- CAPTCHA · BotID. 허니팟과 체류시간은 사이트가 건다. 뚫려도 CRM 이 아니라 문의함에
  쌓일 뿐이다. 실제로 쌓이기 시작하면 그때 붙인다
- 문의에 대한 회신 기능. 담당자가 메일로 답한다
- 폼 필드 추가(제품·수량). 이탈이 늘고, 담당자가 견적에서 어차피 정한다
- 채팅방 글 · 메일 알림. 이번에는 Omnis 알림만
