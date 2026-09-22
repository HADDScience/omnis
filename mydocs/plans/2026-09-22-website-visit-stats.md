---
kind: decision
status: active
canonical: mydocs/plans/2026-09-22-website-visit-stats.md
last_verified: 2026-09-22
---

# 홈페이지 방문 통계를 Omnis 에 쌓는다 (Omnis 쪽 정본)

상태: 2026-09-22 작업지시자가 **Omnis 에 직접 쌓는 쪽**을 골랐고 구현을 지시했다. 배포 승인은 아직 없다.
사이트 쪽(비콘·전달 경로·관리 화면)은 `hadd-website` 저장소가 맡는다.
**스키마·엔드포인트의 권위는 이 문서다.** 두 문서가 다르면 이쪽을 따른다.

## 왜

haddscience.com 은 방문 데이터를 **한 건도 모으고 있지 않다.** `@vercel/analytics` 도
GA 도 없고, Vercel Web Analytics 는 프로젝트에서 꺼져 있다(2026-09-22 확인:
`web_analytics_not_enabled`). "얼마나 들어오는지"를 물으면 답할 근거가 없다.

Vercel Web Analytics 대신 Omnis 에 쌓는다. 조회용 Vercel 토큰을 환경변수로 들고 다닐
필요가 없고, 보존 기간과 집계 방식을 플랜이 아니라 우리가 정한다. 관리 화면은 이미
Omnis SSO 로 로그인하므로 읽는 길도 새로 만들 것이 없다.

## 개인정보 — 쿠키도 IP 도 남기지 않는다

회사 사이트라 동의 배너 없이 굴러야 한다. 그래서 **쿠키를 쓰지 않고, IP 원본을 저장하지
않는다.** 방문자 구분은 하루짜리 해시로 한다.

```
visitorHash = HMAC-SHA256(WEBSITE_VISIT_SECRET, "<YYYY-MM-DD(KST)>|<IP>|<UA>") 앞 16바이트
```

- 해시는 **사이트 쪽에서 만든다.** Omnis 는 IP 도 UA 도 받지 않는다 — 받지 않으면 샐 수도 없다.
- 날짜가 키에 들어가므로 **어제와 오늘을 이어 붙일 수 없다.** 같은 사람이 이틀 오면 2명으로 센다.
  "오늘 몇 명"은 셀 수 있고 그 이상은 못 센다 — 우리가 필요한 건 그것뿐이다.
- 기기(`mobile`/`desktop`)는 사이트가 UA 를 보고 판정해서 보낸다. UA 문자열 자체는 보내지 않는다.
- 유입은 **호스트만**(`google.com`) 남긴다. 전체 URL 에는 검색어가 붙어 오는 경우가 있다.

## 모양

```
브라우저(공개 페이지)  navigator.sendBeacon
  → [사이트] POST /api/hit          IP·UA 로 해시를 만들고 봇을 거른다
  → [Omnis]  POST /api/website/visits   공유 비밀(Bearer) · CORS 없음
  → Neon WebsiteVisit
관리 화면 → [Omnis] GET /api/website/stats   SSO Bearer (requireWebsiteUser)
```

CORS 를 주지 않는 이유는 문의(`/api/website/inquiries`)와 같다 — 브라우저가 Omnis 를 직접
부를 수 있으면 봇이 사이트를 건너뛰고 숫자를 부풀린다. 같은 `/api/website/` 아래여도
관리 화면이 읽는 `posts`·`stats` 와는 성격이 다르다.

### 스키마

```prisma
model WebsiteVisit {
  id           String   @id @default(uuid())
  at           DateTime @default(now())
  path         String   /// "/ko/news/170271833" — 질의문자·해시는 사이트가 떼고 보낸다
  lang         String   /// "ko" | "en"
  visitorHash  String   /// 그날 한정 해시. 날짜가 바뀌면 같은 사람도 다른 값이다
  referrerHost String?  /// "google.com". 내부 이동은 null
  device       String   /// "mobile" | "desktop"

  @@index([at])
  @@index([path, at])
}
```

**원본 행을 그대로 둔다.** 일별 집계 표를 먼저 만들지 않는 이유는, 고유 방문자를 세려면
어차피 해시 집합이 필요하고(`COUNT(DISTINCT visitorHash)`), 지금 규모(글 154건 · 하루
수백 건)에서는 원본이 더 싸고 나중에 질문이 바뀌어도 답할 수 있기 때문이다. 행이 많아지면
그때 집계 표를 얹는다 — 반대 순서는 되돌리기 어렵다.

보존은 **400일**. 작년 같은 달과 비교하려면 1년 + 여유가 필요하다. 오래된 행은
`DELETE FROM "WebsiteVisit" WHERE at < now() - interval '400 days'` 로 지운다(수동 또는 cron).

### 엔드포인트

| 경로 | 인증 | 하는 일 |
|---|---|---|
| `POST /api/website/visits` | 공유 비밀 `WEBSITE_VISIT_SECRET` (Bearer) | 한 건 적는다. 본문은 `{path, lang, visitorHash, referrerHost?, device}` |
| `GET /api/website/stats?days=30` | SSO Bearer (`requireWebsiteUser`) | 합계 · 일별 추이 · 인기 경로 · 유입 · 기기 |

하루 경계는 **KST** 다(`at AT TIME ZONE 'Asia/Seoul'`). UTC 로 자르면 한국 시간 오전 9시
전에 들어온 방문이 어제로 넘어간다.

비밀이 없으면 POST 는 503 이다 — 빠뜨린 배포가 공개 쓰기 엔드포인트가 되면 안 된다.
문의 쪽과 같은 판단이다.

## 단계

1. 스키마 + 마이그레이션 `20260922020000_website_visit`
2. `lib/website-visits.ts` — 적기 · 통계 질의
3. `POST /api/website/visits` · `GET /api/website/stats`
4. 사이트 쪽(다른 저장소) 비콘 · `/api/hit` · 관리 화면 패널
5. 운영 DB 에 `pnpm run db:deploy` **먼저**, 그 다음 머지

## 사람이 해야 하는 것

- `WEBSITE_VISIT_SECRET` 을 **Omnis 와 사이트 양쪽** Vercel 환경변수에 같은 값으로 넣는다
- 운영 DB 마이그레이션 적용

## 한계 (미리 적는다)

- **숫자는 켠 날부터다.** 지난 방문은 복원할 수 없다.
- 자바스크립트를 끈 방문과 일부 봇은 안 잡힌다. 대신 봇이 숫자를 부풀리지 않는다.
- 폰과 PC 로 들어온 같은 사람은 2명이다. 쿠키를 쓰지 않는 대가다.
- 프록시·회사 공용 IP 뒤의 여러 사람은 UA 가 같으면 1명으로 합쳐진다.
