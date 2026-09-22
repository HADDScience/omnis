---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-21-pnpm-and-stale-redeploy.md
last_verified: 2026-09-21
---

# 2026-09-21 — 옛 배포가 운영을 덮은 사고와 pnpm 통일

## 무슨 일이 있었나

오후에 **허브 로그인이 막혔다.** `omnis.haddscience.com/sso/authorize?app=hub-com` 이 400
「등록되지 않은 앱입니다」 를 냈다. 다른 앱 id(`ip-platform` · `website-admin-com`)는 인식했으므로
등록 목록 자체가 옛것이라는 뜻이었다.

배포 기록으로 확인한 순서다.

| 시각 | 무엇 |
|---|---|
| 11:28 | 폴더에서 `vercel --prod` → **실패**. `Command "pnpm run build" exited with 1` |
| 11:29 | 실패를 피해 **옛 배포를 재배포** → 성공, 운영 별칭이 그쪽으로 옮겨감 |

재배포된 것은 **9/17 커밋(`52c2e4a`)** 이었다. 재배포는 그 배포의 **소스를 그대로 다시 굽고
환경변수만 새로 입힌다.** Gemini 키는 반영됐지만 코드가 나흘 전으로 돌아갔다 — 허브 등록(`hub-com`),
옛 경로 호환 rewrite, 그날의 홈페이지 수정이 전부 빠졌다.

### 왜 11:28 이 실패했나

저장소에 **커밋되지 않은** `pnpm-lock.yaml` · `pnpm-workspace.yaml` 이 9/18 부터 남아 있었다.
Vercel 은 업로드된 파일에 pnpm 잠금파일이 있으면 pnpm 으로 빌드한다. 저장소는 npm 기준이라 깨졌다.
빌드 경로가 셋으로 갈려 있었다.

| 경로 | 매니저 |
|---|---|
| GitHub 푸시 → Vercel | npm (저장소에 pnpm 파일이 없으니) |
| 폴더에서 `vercel --prod` | pnpm (untracked 파일이 함께 올라가니) |
| 로컬 `node_modules` | 실은 pnpm 설치본(`node_modules/react` 가 `.pnpm/…` 심볼릭 링크였다) |

## 복구

`origin/main` 만 담은 깨끗한 체크아웃에서 운영 배포를 다시 했다. 확인:

```
/sso/authorize?app=hub-com  → 307 https://omnis.haddscience.com/login?callbackUrl=…
OPTIONS /api/sso/redeem     → 204 + ACAO https://hub.haddscience.com
/omnis/login                → 200      (호환 rewrite 살아 있음)
/.well-known/oauth-protected-resource/omnis/api/ip-mcp → 200
```

## pnpm 으로 통일 (PR #51)

두 갈래를 없애려면 하나를 정해 커밋해야 한다. 허브가 이미 pnpm 이라 pnpm 으로 맞췄다.

- `packageManager: pnpm@12.3.4`, `package-lock.json` 삭제, `pnpm-lock.yaml` 커밋
- `pnpm-workspace.yaml` 의 `allowBuilds` 를 채웠다 — `prisma` · `@prisma/*` · `sharp` · `esbuild` ·
  `unrs-resolver`. pnpm 은 의존성의 설치 스크립트를 기본으로 막는다. 지금까지 **빈 질문지** 상태였다
- CI(`pnpm/action-setup` · `cache: pnpm` · `--frozen-lockfile` · `pnpm exec`) · Dockerfile(`corepack enable`)
- 지침 문서(AGENTS · CLAUDE · manual · README)의 명령을 pnpm 으로. **기록 문서는 그대로 둔다** —
  그때 실제로 돌린 명령이기 때문이다

### pnpm 이 잡아낸 것 — 선언하지 않고 쓰던 패키지 셋

npm 의 평평한 `node_modules` 에서는 남이 끌어온 패키지를 그냥 쓸 수 있어 우연히 돌아간다.

| 어디서 | 패키지 | 딸려오던 곳 | 언제 드러났나 |
|---|---|---|---|
| `lib/sso.ts` · `scripts/verify-sso.ts` | `jose` | next-auth · @auth/core | 로컬 typecheck |
| `scripts/rebuild-cardnews.ts` | `playwright` | @playwright/test | 로컬 typecheck |
| 카드뉴스 · 라이브러리 스크립트 3개 | `sharp` | next | **CI 에서만** |

`sharp` 는 로컬에서 통과하고 CI 에서 걸렸다 — 깨끗한 환경에서 다시 설치해야 드러나는 종류다.
셋 다 쓰던 버전 그대로 직접 의존성으로 올렸다.

### 검증

| 검사 | 결과 |
|---|---|
| CI `verify` (typecheck · lint) | 통과 58초 |
| CI `e2e` (DB 기동 → 시드 → 빌드 → feature 32건) | 통과 4분 8초 |
| Vercel 미리보기 — 운영 · 데모 | 둘 다 통과 |
| 머지 후 운영 · 데모 배포 | 둘 다 성공, `/login` · `/api/ip-mcp` 200 |

## 파비콘 (PR #50 · hub#8)

`omnis.haddscience.com` · `hub.haddscience.com` 이 회사 도메인 아래로 들어왔는데 탭 아이콘이 옛것이었다
(둘이 같은 파일, md5 `c30c7d42…`). NAS 원본
`61. HADD 디자인/00_하드사이언스 로고/hadd_logo/png/symbol.png`(1000×963)에서 정사각으로 맞춰
`favicon.ico`(16·32·48·64) · `icon.png`(512) · `apple-icon.png`(180) 을 만들었다.
배포 뒤 두 사이트가 내려주는 파일이 같은 것(md5 `e15c2c19…`, 6,745B)임을 확인했다.

## 데모 로그인 문의 (다른 세션)

9/14 로그의 `User.position does not exist` 때문에 데모 로그인이 깨진 것으로 보였지만,
**지금은 정상**이다. 데모 프로젝트(`omnis-demo`)의 빌드 명령이 `prisma migrate deploy && npm run build`
라서 배포할 때마다 데모 DB 에 마이그레이션이 적용된다. 실제로 로그인해 확인했다:
`POST /api/auth/callback/credentials`(팀장 / demo1234) → 302, `/api/auth/session` 에 ADMIN 세션,
`/tasks` 200.

운영(`omnis-hadd`)에는 이 단계가 **일부러** 없다 — 사람이 먼저 적용하고 머지하는 규칙이다.

## 남은 것

- 데모 프로젝트 빌드 명령의 `npm run build` → `pnpm run build`
- 로컬 `~/work/omnis-local` 에 남은 `package-lock.json` 정리 (`pnpm install` 한 번)
