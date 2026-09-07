---
kind: decision
status: active
canonical: mydocs/plans/2026-09-07-one-domain.md
last_verified: 2026-09-07
---

# 2026-09-07 — 한 도메인으로: haddscience.vercel.app → haddscience.com

작업지시자 결정: `/` 홈페이지 · `/admin` 홈페이지 어드민 · `/hub` 허브 · `/omnis` 옴니스 를 **전부 경로**로,
허브는 홈페이지 빌드에 포함. 나중에 DNS 로 `haddscience.com` 을 붙인다.

## 실측 (2026-09-07)

| 앱 | 저장소 | 지금 어디 | 형태 | 경로 이전 비용 |
|---|---|---|---|---|
| 홈페이지 `/` `/admin` | hadd-website | GitHub Pages(haddscience.github.io) + Synology | 정적 export | 없음 — 루트 그대로 |
| 허브 `/hub` | hadd-hub | GitHub Pages `/hub` | 정적 export, **이미 basePath /hub** | 없음 — out/ 복사 |
| 옴니스 `/omnis` | omnis | Vercel `omnis-hadd` | 서버 앱 (Next 16, NextAuth, Prisma) | **여기 전부** |

옴니스에서 바뀌어야 하는 것 (grep 실측):

| 무엇 | 수 | 처리 |
|---|---|---|
| 클라이언트 `fetch("/api/…")` | 80 | basePath 는 fetch 에 안 붙는다 → `apiUrl()` 한 곳으로 |
| 절대경로 href / push / redirect | 53 | `<Link>`·`router` 는 자동. `NextResponse.redirect(new URL("/…"))` 만 손봄 |
| 인증 URL 참조 | 19 | NextAuth `basePath` + `NEXTAUTH_URL` |
| DB `File.path = /api/files/<id>/raw` | 저장값 | 그릴 때 붙인다 (DB 는 안 건드림) |
| MCP issuer `url.origin + /api/ip-mcp` | 1 | 프록시 뒤라 origin 이 omnis-hadd 다 → `PUBLIC_URL` env 로 |
| `.well-known` 루트 rewrite | 4 | 루트 도메인(홈페이지 프로젝트)의 vercel.json 으로 옮김 |
| SSO 앱 목록 origin (hub·ip-platform·website-admin) | lib/sso.ts | 새 origin 추가 (옛것은 유지) |
| 구글·카카오 OAuth 콜백 | 콘솔 | **작업지시자** — `https://haddscience.vercel.app/omnis/api/auth/callback/{google,kakao}` |
| MCP 커넥터 | claude.ai | issuer 가 바뀌므로 재연결 (개인 토큰은 무관) |
| 허브·ip-platform 이 부르는 옴니스 주소 | 각 저장소 lib | 새 주소로 |

## 구조

```
haddscience.vercel.app   ← Vercel 프로젝트 "haddscience" (repo: hadd-website, 정적)
  /            out/
  /admin       out/admin
  /hub         빌드 때 hadd-hub 를 받아 빌드해 out/hub 에 복사
  /omnis/*     vercel.json rewrite → https://omnis-hadd.vercel.app/omnis/*
  /.well-known/oauth-*/omnis/api/ip-mcp  → 옴니스로 rewrite (MCP 디스커버리는 루트에 있어야 한다)

omnis-hadd.vercel.app    ← 그대로. basePath /omnis 로 뜬다.
  /omnis/*     정상. 루트(/tasks 등)는 404 — 옛 주소는 더 안 쓴다.
```

왜 rewrite 인가: Vercel 이 한 도메인에서 여러 프로젝트를 경로로 나누는 정식 기능(Microfrontends)은
Pro 플랜부터다. 지금은 개인 플랜. rewrite 는 어느 플랜에서나 되고, 브라우저는 루트 도메인만 보므로
쿠키·CORS 문제가 없다. 홈페이지 어드민이 옴니스 세션을 같은 도메인에서 읽게 되는 것은 덤이다.

왜 basePath 를 env 로 두는가: `basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? ""`. 코드는 한 번 바꾸고,
켜고 끄는 것은 env 다 — 되돌리기가 재배포 한 번이다.

## 단계 (각 단계 끝에 커밋 · 실측 붙임)

1. **옴니스 — basePath 대비, 아직 안 켬** (BASE_PATH 빈 값으로 배포 → 아무것도 안 바뀜)
   `lib/base-path.ts` (`apiUrl` · `publicUrl`) · fetch 80곳 · redirect 손봄 · NextAuth basePath · MCP issuer ·
   File.path 그리기 · `.well-known` rewrite 를 basePath 안으로 → verify: `npm run verify` · verify-sso-live · verify-ip-mcp · eval 스모크 · 배포 후 HTTP
2. **haddscience 프로젝트** — hadd-website 에 `vercel.json`(rewrites) + 빌드 스크립트(hub 포함) → 배포 →
   `/` `/admin` `/hub` HTTP 200 · `/omnis` 는 아직 omnis-hadd 루트로 프록시되므로 404 가 정상
3. **옴니스 켜기** — env `NEXT_PUBLIC_BASE_PATH=/omnis` `PUBLIC_URL=https://haddscience.vercel.app`
   `NEXTAUTH_URL=https://haddscience.vercel.app/omnis/api/auth` → 재배포 → 로그인(자체계정·구글·카카오) ·
   채팅·업무·파일 다운로드·옴니스 질문·MCP 디스커버리 HTTP 실측. **이 단계 전에 작업지시자가 OAuth 콜백 등록.**
4. **주변 앱** — lib/sso.ts 에 새 origin · 허브·ip-platform 의 옴니스 주소 → 각각 배포 → verify-sso-live
5. **커넥터 재연결** — claude.ai 주소를 `https://haddscience.vercel.app/omnis/api/ip-mcp` 로 · 도구 20개 확인
6. (나중) **DNS** — haddscience.com → Vercel · `PUBLIC_URL`·`NEXTAUTH_URL`·OAuth 콜백에 새 도메인 추가 · SSO origin 추가

되돌리기: 3단계 env 세 개를 비우고 재배포하면 1단계 상태(옛 주소 그대로)다. 2단계는 독립 프로젝트라 지워도 옴니스에 영향 없다.

## 조율

- **다른 세션이 홈페이지 어드민 SSO 를 붙이는 중**(`c981559`·`4dc26f6`·`50eba82`). 1단계는 그 코드를 건드리지 않게
  `lib/sso.ts` 는 4단계에서만 손댄다. 4단계 전에 그쪽이 끝났는지 본다.
- 옛 주소 `omnis-hadd.vercel.app/…` 를 새 주소로 넘기는 redirect 는 두지 않는다 — rewrite 가 같은 호스트로 들어오므로
  host 로 구분하면 무한 redirect 가 된다. 옛 주소는 그냥 죽는다(안내 페이지 하나만).

## 승인 대기

- 1~2 단계는 실서비스에 변화가 없다. 시작해도 되는가?
- 3 단계 전 OAuth 콜백 등록(구글 클라우드 콘솔 · 카카오 개발자)은 작업지시자 몫이다.
