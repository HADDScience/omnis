---
kind: snapshot
status: active
canonical: mydocs/plans/2026-09-22-website-inquiry-to-crm.md
last_verified: 2026-09-22
---

# 홈페이지 문의 → CRM 견적 — 구현 결과

브랜치 `feat/website-inquiry`. **푸시·배포 전.** 운영 DB 마이그레이션도 아직이다.

| 커밋 | 무엇 |
|---|---|
| `1756d73` | 계획서 |
| `7e3691e` | 팀·직급을 홈페이지 「팀 : 하드」 와 맞춤 |
| `b4aecca` | `WebsiteInquiry` 모델 · enum · 마이그레이션 |
| `c8138e5` | `POST /api/website/inquiries` · 알림 |
| `867946f` | 검토 화면 · 「견적으로 만들기」 · 3년 파기 스크립트 |

---

## 1. 팀·직급

`npx tsx scripts/set-team-positions.ts --apply` (로컬 DB)

```
대상: localhost/omnis
모드: 적용

  → 허채정  (없음) · 대표  →  경영진 · CEO · CTO
  → 김경훈  (없음) · COO  →  영업마케팅팀 · CMO
  → 윤훈  영업마케팅팀 · 상무  →  영업마케팅팀 · CAO
  = 김아리  연구개발팀 · 팀장
  → 노혜린  제품개발팀 · 과장  →  제품개발팀 · 팀장
  = 허찬  연구지원/재무팀 · 팀장
  = 정우창  AI개발팀 · 사원
  → 박소정  (없음) · 인턴  →  제품개발팀 · 연구원
  → 주용석  (없음) · 인턴  →  AI개발팀 · 인턴

적용 6건 / 대상 9명
```

**운영 DB 에는 아직 돌리지 않았다.**

## 2. 접수 엔드포인트 — 실제 HTTP (로컬 dev)

```
Authorization 없음                        → 401
Bearer wrong                              → 401 {"error":"forbidden"}
name:"" email:"nope" topic:"unknown"
  message:"" lang:"fr"                    → 400 invalid_inquiry, issues 5건
정상                                       → 201 {"ok":true,"id":"91003a33-…"}
같은 email+message 재전송(대소문자 다름)     → 200 {"ok":true,"id":"91003a33-…","duplicate":true}
같은 ip 2·3번째                            → 201 / 201
같은 ip 4번째                              → 429 {"error":"rate_limited"}
그 3건을 전부 SPAM 으로 바꾼 뒤 재시도        → 여전히 429
ip 필드 없이                               → 201  (IP 한도 건너뜀)
```

400 의 `issues`:

```json
["name: 이름이 없습니다","email: 이메일 형식이 아닙니다",
 "topic: Invalid option: expected one of \"sample\"|\"pricing\"|\"technical\"|\"partnership\"|\"etc\"",
 "message: 내용이 없습니다","lang: Invalid option: expected one of \"ko\"|\"en\""]
```

**거부되어야 하는 경우가 실제로 거부된다** — 401 · 400 · 429, 그리고 스팸 처리 뒤에도 429.

## 3. 사이트와의 실제 왕복

사이트(`hadd-website`, `next start -p 3277`)를 `OMNIS_API_BASE=http://localhost:3001/api/website`
로 띄우고 **브라우저에서 폼을 실제로 채워 제출**했다. 목킹이 아니다.

폼: `문의가 접수되었습니다. / 영업일 기준 1~2일 내에 담당자가 회신드립니다.`

Omnis DB 에 선 행:

```
id           = "da1ca48b-a062-4a5f-94fc-e890d1a71813"
createdAt    = "2026-09-22T06:24:05.224Z"
name         = "박실증"
organization = "연세대학교 의과대학 신경과학교실"
email        = "siljeung@yonsei.ac.kr"
phone        = "010-9876-5432"
topic        = "pricing"
message      = "뉴런 스페로이드 배양용으로 애드젤 5ml 20개 견적 부탁드립니다. …"
lang         = "ko"
ip           = "::ffff:127.0.0.1"
userAgent    = "Mozilla/5.0 (Macintosh; …) Chrome/153.0.0.0 Safari/537.36"
status       = "NEW"
reviewedById = null   reviewedAt = null   reviewNote = null
orgId        = null   contactId  = null   quoteId    = null
```

`consent` 는 저장되지 않았다(계약대로 사이트가 보내지 않는다).
승인 전 `orgId`·`contactId`·`quoteId` 가 전부 null 이다 — 「사람 검토」 가 실제로 걸려 있다.

알림 3건, 확정한 규칙대로:

```
허채정 (경영진 CEO · CTO)     | 새 홈페이지 문의: 박실증(연세대학교 의과대학 신경과학교실)
윤훈   (영업마케팅팀 CAO)      | (같음)
김경훈 (영업마케팅팀 CMO)      | (같음)
```

알림을 누르면 `/crm/inquiries/{id}` 로 간다 — 브라우저에서 확인했다.

## 4. 검토 → 견적 (브라우저)

「견적으로 만들기」 → 기관 검색칸에 **문의의 소속이 미리 들어가 있음** →
`«성균관대학교 생명과학과» 기관으로 새로 만들기` → 유형 `대학` →
담당자 검색칸에 **문의한 사람 이름이 미리 들어가 있음** → `«김연구» 담당자로 새로 만들기` →
메모 → `견적 만들기` → 견적 상세로 이동.

사람이 타이핑한 글자: **0자.** 클릭만 했다.

```
문의:   ACCEPTED | reviewedAt 2026-09-22T06:12:55.832Z
기관:   ORG029 성균관대학교 생명과학과 UNIVERSITY
담당자: CT028 김연구 | email: yeongu@skku.edu | phone: 010-1234-5678   ← 문의에서 옮겨졌다
견적:   HADD260922-016 DRAFT | 품목 0
견적 note: "홈페이지 문의 (69597ed1-…)\n애드젤 5ml 10개 견적 부탁드립니다. …"
```

### 품목 0개 견적이 깨지지 않는다

계획서에서 확인하기로 한 항목이다. `/crm/quotes` 목록과 상세를 실제로 열었다 —
목록에 한 줄로 서고, 상세는 품목 표가 비고 `공급가 ₩0 · 소계 ₩0 · 부가세 10% ₩0 · 실 합계 ₩0`.
`비고` 에 문의 본문이 들어가 있어 담당자가 무엇을 채울지 그 화면에서 읽는다.

### 두 번 승인

같은 문의에 `PATCH accept` 두 개를 동시에 던졌다:

```
a → 201 {"ok":true,"quoteId":"79a91246-…","quoteCode":"HADD260922-015"}
b → 409 {"error":"이미 처리된 문의입니다"}
```

DB 확인 — 기관 1 · 담당자 1 · 견적 1. 하나도 겹치지 않았다.

### 나머지 거부 경로

```
기관 이름 중복        → 409 {"error":"같은 이름의 기관이 이미 있습니다", org:{id,name}}
기관 미지정           → 400 "기관을 고르거나 새 이름을 주세요 (둘 중 하나)"
action 이 accept/reject 아님 → 400 "action 은 accept 또는 reject 입니다"
스팸 처리             → 200 {"ok":true,"status":"SPAM"}
이미 처리된 것을 또    → 409 "이미 처리된 문의입니다"
```

> 기관 중복 409 는 그 뒤 승인 API 를 단순화하면서 `POST /api/crm/orgs` 쪽으로 옮겼다.
> 위 출력은 옮기기 전에 잰 것이다. 지금은 화면이 EntityPicker 로 기관을 먼저 만들고
> 승인에는 id 만 넘기므로, 같은 409 를 기존 기관 생성 경로가 낸다.

## 5. 3년 파기

`npx tsx scripts/purge-website-inquiries.ts` (미리보기)

```
대상: localhost/omnis
기준: 2023-09-22 이전 접수분 (3년)
모드: 미리보기 (--apply 를 붙이면 실제로 지운다)

  삭제 대상 (NEW·REJECTED·SPAM): 0건
  본문·연락처만 비울 대상 (ACCEPTED): 0건

아무것도 바꾸지 않았습니다.
```

3년 지난 문의가 아직 없으니 **0건이 맞는 답이다.** `--apply` 는 돌리지 않았다 —
지울 것이 없어 돌려도 아무 일이 없고, 그러면 「지워진다」 를 확인한 것이 아니다.
**실제 삭제·파기 동작은 아직 실측하지 않았다.**

## 6. 품질 게이트

```
$ npx tsc --noEmit
(출력 없음)

$ npx eslint .
✖ 44 problems (0 errors, 44 warnings)      ← 새 파일에는 경고 0. 전부 기존 파일

$ pnpm run build
✓ Compiled successfully in 25.1s
✓ Generating static pages using 11 workers (58/58) in 133.5ms
├ ƒ /api/crm/inquiries/[inquiryId]
├ ƒ /crm/inquiries
├ ƒ /crm/inquiries/[inquiryId]
exit=0
```

### 좁은 뷰포트

```
$ BASE_URL=http://localhost:3001 AUDIT_USER=팀장 AUDIT_PASS=… \
  ROUTES="/crm/inquiries,/crm/inquiries/<NEW>,/crm/inquiries/<ACCEPTED>" node scripts/narrow-audit.mjs

· 320px  overflow=0 bleed=0 clip=0 ellip=0   (세 화면 모두)
· 280px  overflow=0 bleed=0 clip=0 ellip=0   (세 화면 모두)
✗ 240px  상세 1곳 clip=1
✗ 200px  세 화면 clip=1
```

**넘침(overflow)과 뚫고 나감(bleed)은 모든 폭에서 0이다.** 잘리는 것은 전부
공용 헤더의 마지막 빵부스러기 하나다:

```
{"sel": "span.truncate.text-[13px].font-semibold.text-foreground — \"문의\"", "cut": 13, "w": 9}
```

내 컴포넌트가 아니라 `components/layout/header.tsx` 가 240px 이하에서 하는 일이고,
**기존 화면도 같다** — 같은 조건으로 잰 `/crm/samples` 는 320px 에서 이미 잘린다
(`clip=1`). 헤더를 고치는 것은 이 작업의 범위 밖이라 손대지 않았다.

목록의 `line-clamp-2` 말줄임은 의도한 것이다(본문 미리보기).
터치 타깃 44px 미만은 문의 목록 6개 — 같은 조건의 `/crm/quotes` 는 12개다.

## 아직 안 한 것

| 무엇 | 왜 |
|---|---|
| 운영 DB 마이그레이션 (`pnpm run db:deploy`) | 사용자 승인 대기. **머지보다 먼저** 해야 한다 |
| 운영 DB 팀·직급 적용 | 사용자 승인 대기 |
| 푸시 · PR · 배포 | 사용자 승인 대기 |
| `WEBSITE_INQUIRY_SECRET` 실값 | 사용자가 양쪽 Vercel 에 같은 값을 넣는다 |
| 파기 스크립트의 실제 삭제 실측 | 3년 지난 데이터가 없다 |
| 개인정보처리방침 | 사이트 쪽 작업. 국외이전 사실은 전달했다 (Neon `ap-southeast-1` 싱가포르) |

---

# 2차 — 무엇을 만들지는 문의 유형이 먼저 고른다

PR #65, 머지 커밋 `a79194b`. 운영 배포 완료.

## 왜 고쳤나

운영에서 샘플 신청(`topic=sample`)으로 들어온 문의에 **견적이 만들어졌다.** 작업지시자가
그 견적을 지웠고, `onDelete: SetNull` 이 `inquiry.quoteId` 를 null 로 풀었다
(설계대로 동작한 것이다 — `status` 는 `ACCEPTED` 로 남았다). 그 문의와 기관 `ORG067 테스트`
는 지웠다.

## 유형별 기본값

```
「샘플 요청」 → [샘플요청으로 만들기 ⌄]   ⌄ 안: 견적으로 만들기 · 기관·담당자만 등록
「견적 문의」 → [견적으로 만들기 ⌄]
「기술 문의」 → [기관·담당자만 등록 ⌄]
```

화면에서 유형 3건을 넣고 그대로 뜨는 것을 확인했다.

## 샘플 경로 실측 (클릭만으로)

```
[sample] 유형시험-sample → status=ACCEPTED
  기관=ORG027 sample 시험기관 | 담당자=CT026 sample@example.com 010-0000-0001
  견적=- | 샘플요청=HADD260922-016
    샘플 status=PENDING referral="홈페이지 문의" product=(비움)
    request="sample 유형으로 들어온 문의입니다. 애드젤 관련 문의드립니다."
```

견적이 아니라 샘플요청이 섰고, 담당자에 문의의 이메일·연락처가 그대로 옮겨졌다.

## 거부되어야 하는 경우

```
outcome:"wat"   → 400 Invalid option: expected one of "quote"|"sample"|"none"
outcome 누락     → 400 (같음)
같은 문의 두 번   → 409 이미 처리된 문의입니다
outcome:"none"  → 201, quoteId·sampleId 둘 다 null, 기관만 연결
```

## 게이트

```
$ npx tsc --noEmit      (출력 없음)
$ npx eslint .          ✖ 43 problems (0 errors, 43 warnings) — 새 코드 경고 0
$ pnpm run build        ✓ Compiled successfully in 22.1s
```

### 좁은 뷰포트

```
320px  overflow=0 bleed=0 clip=0   (세 화면 모두)
280px  상세 2곳 clip=1
200px  세 화면 clip=1
```

**넘침·뚫림은 모든 폭에서 0.** 200px 스크린샷에서 분할 버튼(기본 동작 + ⌄)이 붙어 있고
반려·스팸이 아래로 줄바꿈되는 것을 눈으로 확인했다.

잘리는 것은 이번에도 공용 헤더의 마지막 빵부스러기다. 1차보다 넓은 폭(280px)에서 잘리는
이유는 시험 이름이 길어서다(`유형시험-pricing`) — `components/layout/header.tsx` 의
`truncate` 이고 내 컴포넌트가 아니다.

## 운영 확인

```
WebsiteInquiry: 0 건 (sampleId 열 읽힘)
기관: 66 | 담당자: 27 | 견적: 13 | 샘플요청: 15
이름에 테스트/시험/test 가 든 기관: 없음

POST https://omnis.haddscience.com/api/website/inquiries -d '{}'  → 401 forbidden
GET  https://omnis.haddscience.com/crm/inquiries                  → 307 (로그인)
```

운영 시험 데이터(문의 `테스트`, 기관 `ORG067 테스트`, 담당자 1명, 알림 3건)는 지웠다.
기관 66곳은 전부 실제 데이터다.
