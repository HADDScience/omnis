---
kind: snapshot
status: active
canonical: mydocs/plans/archives/2026-09-07-website-posts-db.md
last_verified: 2026-09-07
---

# 2026-09-07 — 홈페이지 기사를 Neon 에 · 작업 결과

계획: [`mydocs/plans/2026-09-07-website-posts-db.md`](../plans/archives/2026-09-07-website-posts-db.md)
브랜치 `feat/website-admin-sso` (SSO 앱 등록 커밋 위에 쌓였다).

## 커밋

| 단계 | 커밋 | 내용 |
|---|---|---|
| 1 | `191f583` | `WebsitePost` · `WebsiteMedia` 스키마, Zod(`lib/schemas/website.ts`), 이식 스크립트 |
| 2 | `04e7a8d` | `/api/website/*` 5개 라우트, `lib/website-{auth,media,posts,translate}.ts`, 외래키 제거 마이그레이션 |
| 3 | `335ae62` | GitHub 프록시 삭제, `.env.example`, 인증 문서, 앞 계획서 archives 로 |
| — | (이 커밋) | 재검증 경로 끝 슬래시, 이 보고서 |

사이트 저장소: `feat/omnis-sso` 브랜치 (SSO 클라이언트 · 서버 렌더 전환 · 관리 화면 API 전환).

## 실측

### 이식 (`npx tsx scripts/import-website-posts.ts --site ~/work/hadd-website`, 로컬 DB)

```
DB 대상: localhost:5433
기사 49건 저장, 사진 올림 132 · 이미 있음 0, 실패 0
--- 두 번째 실행:
기사 49건 저장, 사진 올림 0 · 이미 있음 132, 실패 0
```
사진 132 = 사이트 `public/news` 파일 수 132. NAS 에서 `website/172288285/01.webp` 를 다시 읽어 18,616 바이트 = 원본과 같음.

### API (라우트 핸들러 직접 호출 — 다른 세션의 dev 서버가 떠 있어 서버를 새로 띄우지 않았다)

```
1 GET posts (공개)                       200  49건, 첫 id 20260827-1149
2 GET posts/172288285                    200  cache=public, s-maxage=60, stale-while-revalidate=60
3 PUT 앱 헤더·토큰 없음                    400  unknown_app
4 PUT 잘못된 블록                          400  invalid_post (content.ko.blocks.0.type …)
5 POST media                             201  /omnis/api/website/media/20260907-9999/36d8….webp
6 GET media                              200  17690 bytes, image/webp, cache=public, max-age=86400, s-maxage=31536000, immutable
7 GET media 없는 키                        404
8 POST media 4MB 초과                     413
9 PUT 정상 (Gemini 번역 포함)              200  실패=[] en.title="API Verification Post" translatedFrom=d4dc…
10 같은 원문 재저장                         200  hash 동일=true, Gemini 호출 1회(9번뿐)
11 새 글이 맨 앞                           200
12 PUT order · 13 순서 반영                200
14 DELETE · 15 GET 지운 글 404 · 16 NAS 에서 삭제됨, 목록 행 0
```

`npm run verify`: typecheck 통과. lint 는 main 에 있던 `linked-accounts.tsx` 오류 1건 그대로(손대지 않음).

### 사이트 (로컬 사이트 → 로컬 Omnis API)

목록 12장 사진 전부 로드, 상세 `/ko/news/20260827-1149/` 사진 `/omnis/api/website/media/…` 정상.
관리 화면: 로그인(목킹) → 기존 글 재저장 → 새 카드뉴스에 사진 올려 저장. 업로드 5건(원본 1 · 카드 3 ·
썸네일 1) 모두 `X-Post-Id` 로 갔고 PUT 본문에 임시 경로(`/news/…`)가 0개 남았다.
`pnpm build`: API 가 없을 때(빈 목록)와 로컬 API 일 때 둘 다 통과.

## 배포 (2026-09-07 저녁, 작업지시자 지시로 AI 가 실행)

| 단계 | 명령 · 결과 |
|---|---|
| Neon 마이그레이션 | `prisma migrate status` → 미적용 2개(`website_posts` · `website_media_no_fk`) → `migrate deploy` → "All migrations have been successfully applied" |
| Omnis 환경변수 | `WEBSITE_ORIGIN` · `WEBSITE_REVALIDATE_SECRET` (Production) 추가 |
| Omnis 배포 | `feat/website-admin-sso` → main ff(`omnis-main` 워크트리), push `a9becff..5d7c436`, `vercel deploy --prod --yes` |
| 이식 (프로덕션) | 1차: 49건 · 사진 132 올림 → 사진 500. 원인: 로컬 `.env` 의 NAS 경로(`…/_dev/files`)로 올렸다. `WebsiteMedia` 132행 삭제 후 `SYNOLOGY_WEBDAV_BASE_PATH="/HADD Science/옴니스 첨부파일/files"` 로 재이식 → 49건 · 132 올림 · 실패 0 |
| 확인 | `GET /omnis/api/website/posts` 49건 (엣지 캐시 60초 뒤) · `GET …/media/172288285/01.webp` 200 image/webp 18,616B `cache-control: public, max-age=86400, immutable` · `sso/authorize?app=website-admin-vercel` → 로그인 화면으로 307(등록됨) |

사이트 쪽 배포 실측은 사이트 저장소 `mydocs/working/2026-09-07-omnis-sso-and-db.md`.

### 밟은 함정

- **이식 스크립트는 NAS 경로를 `.env` 에서 읽는다.** `--prod` 는 DB 만 Neon 으로 보낸다. NAS 도
  프로덕션 경로를 따로 줘야 한다. 스크립트 주석에 적어 두었다(아래 커밋).
- `_dev/files/website/` 에 로컬 이식본 132장이 남아 있다. 로컬 DB 가 그것을 가리키므로 두었다.

## 확인하지 못한 것

- 실제 계정으로 `haddscience.vercel.app/admin` 로그인 → 저장 → 사이트 반영. 계정이 없어 AI 가 하지 못했다.
  작업지시자가 한 번 해 보고 `mydocs/feedback/` 에 남긴다.

## 남은 것

- NAS 고아 사진 정리(재저장한 카드뉴스의 옛 카드, 저장 안 한 새 글의 사진). 정리 작업이 아직 없다.
- 사이트 저장소의 옛 `content/data/news/` · `public/news/` 삭제 — 실사용 확인 뒤 승인받고.
