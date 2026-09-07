---
kind: snapshot
status: active
canonical: mydocs/tech/auth-architecture.md
last_verified: 2026-09-07
---

# 2026-09-07 — 홈페이지 관리 화면 SSO · 작업 결과

> GitHub 프록시 부분은 같은 날 폐기됐다. 기사를 Neon 에 두기로 해서다 — [`2026-09-07-website-posts-db.md`](2026-09-07-website-posts-db.md).

계획: [`mydocs/plans/2026-09-07-website-admin-sso.md`](../plans/2026-09-07-website-admin-sso.md)

## 커밋

| 단계 | 커밋 |
|---|---|
| 앱 등록 + verify-sso 검사 7건 | `c981559` |
| GitHub 프록시 | `4dc26f6` |
| 문서 · `.env.example` · 이 보고서 | (이 커밋) |

## 실측

### `npx tsx scripts/verify-sso.ts` (로컬 임시 키)

```
[6] 홈페이지 관리 앱
  ✓ website-admin 등록
  ✓ website-admin-com 등록
  ✓ 복귀 경로 기본값은 /admin/
  ✓ 같은 오리진의 다른 앱(/hub/)으로는 못 돌아감
  ✓ github.io 세션을 haddscience.com 앱이 쓰면 거부
  ✓ github.io 세션을 hub 가 쓰면 거부
  ✓ 자기 앱에서는 통과

통과: 43 passed, 0 failed
```

### 프록시 — 로컬 dev(3001) + 가짜 GitHub(3998, 요청을 기록만 함) + 로컬 DB 의 활성 사용자 토큰

```
1 토큰 없음 → 401                              401  {"error":"invalid_session"}
2 hub 앱 토큰(다른 audience) → 401              401  {"error":"invalid_session"}
3 다른 저장소 경로 → 403                          403  {"error":"path_not_allowed"}
4 미등록 Origin → 403, CORS 헤더 없음             403  {"error":"origin_not_allowed"}   (Access-Control-Allow-Origin 0개)
5 다른 앱 id 헤더(hub) → 400                    400  {"error":"unknown_app"}
6 정상 GET → 200 (가짜 GitHub 통과)              200  {"ok": true, "echo_path": "/repos/HADDScience/HADDScience.github.io/contents/content/data/news?ref=main"}
   응답 헤더: access-control-allow-origin: http://localhost:3000 · x-ratelimit-remaining: 4999
7 OPTIONS preflight → 204                       204
8 커밋 생성: author 를 남의 이름으로 보냄          200
   가짜 GitHub 이 받은 본문: {"message":"t","tree":"abc","parents":["p"],"author":{"name":"허채정","email":"neuroheo@haddscience.com"}}
   → 요청의 {"name":"공격자","email":"x@evil"} 이 세션 사용자로 바뀌어 나갔다
9 DB 에 없는 사용자 토큰 → 403                    403  {"error":"account_inactive"}
```

### 한 도메인 이전(haddscience.vercel.app) 반영 후 — 라우트 함수를 tsx 로 직접 호출

다른 세션이 Omnis 를 `/omnis` 로 옮기고 허브를 `hub-vercel` 로 등록한 뒤, 이 브랜치를 그 main 위로
rebase 하고 `website-admin-vercel` 을 추가했다. 같은 오리진 GET 은 브라우저가 Origin 을 붙이지
않으므로 프록시의 Origin 검사를 "있으면 대조"로 바꿨다(자격은 Bearer 토큰). 다른 세션의 dev
서버가 떠 있어 서버를 새로 띄우는 대신 라우트 핸들러를 직접 불렀다.

```
verify-sso.ts                                   통과: 44 passed, 0 failed
a Origin 없음(같은 오리진 GET) → 200               200
b 등록 Origin → 200 + CORS                        200  acao=http://localhost:3000
c 다른 Origin → 403                               403  {"error":"origin_not_allowed"}
d Origin 없음 + 토큰 없음 → 401                     401  {"error":"invalid_session"}
e Origin 없음 + 다른 저장소 → 403                   403  {"error":"path_not_allowed"}
f 커밋 author 덮어쓰기                              200  가짜 GitHub 수신: "author":{"name":"허채정","email":"neuroheo@haddscience.com"}
```

### `npm run verify`

typecheck 통과. lint 는 `components/settings/linked-accounts.tsx:45` 의 기존 오류 1건이 main 에도
같은 상태로 있다(이 작업과 무관, 손대지 않음). 그 밖에는 경고뿐.

## 남은 것 (사용자)

1. GitHub 에서 fine-grained PAT 발급 — 저장소 `HADDScience/HADDScience.github.io` 하나, Contents: Read and write.
2. Vercel 프로젝트 환경변수 `WEBSITE_GITHUB_TOKEN` 에 등록.
3. `vercel deploy --prod --yes`.
4. 홈페이지 저장소의 `feat/omnis-sso` 브랜치를 main 에 올려 배포(Vercel 자동). 그 전까지 /admin 은 PAT 로그인 그대로다.
5. haddscience.vercel.app/admin 에서 실제 로그인 → 기사 저장 → 커밋 author 가 본인 이름인지 확인.
