---
kind: decision
status: active
canonical: mydocs/tech/auth-architecture.md
last_verified: 2026-09-07
---

# 2026-09-07 — 홈페이지 관리 화면(`/admin`)을 Omnis SSO 에 붙인다

## 배경

haddscience.com 재구축 저장소(`HADDScience/HADDScience.github.io`)의 `/admin` 은 사내
구성원이 기사·카드뉴스를 쓰는 정적 화면이다. 지금은 사람마다 GitHub fine-grained PAT 을
발급해 브라우저에서 직접 GitHub API 로 커밋한다. 이것을 Hub · ip-platform 과 같은 방식 —
**Omnis 계정으로 로그인, Omnis 가 세션 토큰 발급** — 으로 바꾼다.

정적 앱이라 GitHub 토큰을 들 수 없으므로, GitHub 호출은 Omnis 가 서버 토큰으로 대신
보낸다(프록시). Omnis 안으로 화면을 이식하는 안은 기각했다 — 2,500줄을 옮기고 디자인
토큰·미리보기 컴포넌트를 두 벌로 만들게 되며, 인증 문서의 정본 구조(Omnis 앵커 + 토큰
발급)와도 어긋난다.

## 이 저장소가 할 일 (전부 3개 파일 + 문서)

### 1. `lib/sso.ts` — 앱 등록

```ts
{ id: "website-admin",     label: "홈페이지 관리", origin: "https://haddscience.github.io", basePath: "/admin" },
{ id: "website-admin-com", label: "홈페이지 관리", origin: "https://haddscience.com",       basePath: "/admin" },
```
개발용 `DEVELOPMENT_APPS` 에 `{ id: "website-admin-dev", origin: "http://localhost:3000", basePath: "/admin" }`.

같은 정적 번들이 github.io 와 haddscience.com 두 곳에 올라가므로 앱 id 가 둘이다.
클라이언트는 `location.origin` 으로 자기 id 를 고른다. audience 가 앱별이라 토큰은 섞이지 않는다.

### 2. `app/api/website/github/[...path]/route.ts` — GitHub 프록시

```
GET | POST | PATCH  /api/website/github/<GitHub 경로>
  Authorization: Bearer <SSO 세션 토큰>
  X-Sso-App: website-admin | website-admin-com | website-admin-dev
```

- `verifySession(token, app)` 로 서명·audience 확인 → `prisma.user` 에서 `isActive` 확인
  (`/api/sso/verify` 와 같은 순서. 퇴사 처리가 다음 요청에 바로 먹힌다).
- 허용 경로는 **`/repos/HADDScience/HADDScience.github.io/` 아래만**. 그 밖은 403.
  서버 토큰이 다른 저장소에 닿을 권한이 있어도 이 프록시로는 못 간다.
- `POST …/git/commits` 는 본문의 `author` 를 세션 사용자로 **덮어쓴다**
  (`{ name, email ?? "website-admin@haddscience.com" }`). 커밋 작성자가 실명으로 남는 것이
  PAT 방식의 장점이었고, 그것을 잃지 않는다. `committer` 는 토큰 소유자(봇)로 남는다.
- 토큰은 환경변수 `WEBSITE_GITHUB_TOKEN`. 없으면 503. fine-grained PAT,
  `HADDScience.github.io` 저장소 하나에 Contents: Read and write. Vercel 프로젝트 환경변수로 넣는다.
- CORS: `isAllowedOrigin(origin)` 인 오리진에만. 메서드 `GET, POST, PATCH, OPTIONS`,
  헤더 `authorization, content-type, x-sso-app`. 기존 `corsHeaders()` 는 POST 전용이라
  이 라우트가 자기 헤더를 만든다 — 기존 함수의 동작은 건드리지 않는다.
- 응답은 GitHub 의 상태 코드와 JSON 을 그대로 되돌린다. 레이트리밋 헤더도 통과.

### 3. 문서

- `mydocs/tech/auth-architecture.md` 배치 표에 앱 두 줄, 파일 표에 프록시 한 줄.
- `.env.example` 에 `WEBSITE_GITHUB_TOKEN`.

## 홈페이지 저장소가 할 일 (참고 — 이 계획의 승인 범위 밖)

`lib/omnis-auth.ts` 를 Hub 에서 복사(앱 id 는 오리진으로 결정), `hooks/use-admin-session.ts` 를
SSO 흐름으로, `lib/github.ts` 의 API 기점을 `https://omnis-hadd.vercel.app/api/website/github` 로,
로그인 화면을 "HADD 계정으로 로그인" 버튼 하나로. PAT 안내 문서는 지운다.

## 검증

| 단계 | 명령 · 확인 |
|---|---|
| 타입·린트 | `npm run verify` |
| SSO 규칙 | `SSO_SIGNING_KEY=… npx tsx scripts/verify-sso.ts` — 새 앱 3개가 화이트리스트 검사를 통과 |
| 프록시 거부 | 토큰 없음 → 401 · 다른 앱 토큰 → 401 · `/repos/HADDScience/omnis/...` → 403 · 등록 안 된 Origin → CORS 헤더 없음 |
| 프록시 통과 | 유효 토큰으로 `GET …/contents/content/data/news` → GitHub 200 그대로 |
| author 덮어쓰기 | `POST …/git/commits` 본문에 남의 author 를 넣어도 세션 사용자로 바뀌어 나감 (GitHub 로 실제 보내지 않고 로컬에서 요청 조립만 확인) |
| 배포본 | `vercel deploy --prod --yes` 뒤 github.io/admin 에서 실제 로그인 → 기사 저장 → 커밋 작성자 확인 |

## 순서

1. `lib/sso.ts` 앱 등록 → `verify-sso.ts` 통과 → 커밋
2. 프록시 라우트 → 거부 사례 4종 curl → 커밋
3. 문서 · `.env.example` → 커밋
4. 사용자: Vercel 에 `WEBSITE_GITHUB_TOKEN` 등록 → 배포 → 홈페이지 저장소 쪽 변경과 함께 실사용 확인

## 되돌리기 어려운 것

없다. 스키마 변경 없음. 배포는 사용자가 한다. 홈페이지 저장소의 PAT 로그인은 이 배포가
끝나고 실사용을 확인한 뒤에 지운다.
