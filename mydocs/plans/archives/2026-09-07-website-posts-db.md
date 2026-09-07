---
kind: decision
status: active
canonical: mydocs/tech/auth-architecture.md
last_verified: 2026-09-07
---

# 2026-09-07 — 홈페이지 기사를 git 이 아니라 Neon 에 둔다

## 배경 · 결정

홈페이지(`haddscience.vercel.app`) 관리 화면은 지금까지 기사를 저장소 파일로 커밋했다
(git 이 DB). SSO 로 바꾸면서 "서버가 대신 커밋할 GitHub 토큰" 이 필요해졌고, 작업지시자가
**기사를 Neon 에 저장**하기로 정했다(2026-09-07). 이로써 앞선 계획
`2026-09-07-website-admin-sso.md` 의 GitHub 프록시는 폐기한다. SSO 앱 등록은 그대로 쓴다.

| 결정 | 선택 | 버린 안 |
|---|---|---|
| 스키마·API 주인 | **Omnis.** `WebsitePost` 모델과 `/api/website/*` | 사이트 저장소가 직접 Prisma — 한 DB 에 스키마 주인이 둘 |
| 사진 저장 | **Synology WebDAV** (`lib/storage.ts` 그대로). 공개 경로 하나를 열고 Vercel 엣지에 1년 캐시 | Vercel Blob — 저장소를 하나 더 두게 됨. Neon bytea — 사진이 늘수록 DB 가 무거워짐 |
| 사이트 렌더 | **서버 렌더 + ISR.** 이미 Vercel 에 있다. 정적 export 를 푼다 | 정적 유지 + 재빌드 훅 — 반영 3~5분, 정적 배포 대상은 어차피 Vercel 로 통합됨 |
| 번역 | **저장 시 Omnis 가 Gemini 2.5 Flash 로**, 기존 `gemini-usage` 예산 안에서 | GitHub Actions — 커밋이 없으니 트리거가 없다 |
| 되돌리기 | 이번에는 두지 않는다. 필요해지면 `WebsitePostRevision` 을 붙인다 | |

NAS 가 꺼지면 사진이 깨지는 문제는 엣지 캐시로 막는다. 사진 키는 업로드마다 고유하므로
`immutable` 로 캐시할 수 있고, 한 번 열린 사진은 NAS 상태와 무관하게 나간다.

## Omnis 가 할 일

### 1. 스키마 (`prisma/schema.prisma`) — 규칙 23: 마이그레이션 + Zod + 백필을 한 커밋에

```prisma
model WebsitePost {
  id           String   @id            // "20260827-1149" · 아임웹 숫자 id 그대로
  position     Int                     // 목록 순서. 작을수록 위. order.json 을 대신한다
  date         String                  // 표시용 "2026.07.08"
  sourceLang   String                  // "ko"
  thumbnail    String?                 // 사진 URL
  externalHref String?
  content      Json                    // { ko: PostLocale, en?: PostLocale } — 사이트 content/types.ts 와 같은 모양
  deck         Json?                   // 카드뉴스 원본 덱
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  updatedById  String?
  media        WebsiteMedia[]
}
model WebsiteMedia {
  id          String      @id @default(cuid())
  postId      String
  post        WebsitePost @relation(fields: [postId], references: [id], onDelete: Cascade)
  key         String      @unique      // NAS 키 "website/<postId>/<cuid>.webp"
  contentType String
  size        Int
  createdAt   DateTime    @default(now())
}
```

- Zod: `lib/schemas/website.ts` — `PostBlock` · `PostLocale` · `Card` · `CardDeck` 를 사이트의 `content/types.ts` 에서 옮겨 검증한다. 편집기가 보내는 JSON 을 그대로 믿지 않는다.
- 백필 = 이식 스크립트 `scripts/import-website-posts.ts`. 사이트 저장소 경로를 받아 `content/data/news/*.json` 50건과 `public/news/**` 사진을 NAS 에 올리고 `src` 를 새 URL 로 바꿔 넣는다. 두 번 돌려도 같은 결과(id 기준 upsert, 같은 파일은 다시 올리지 않음).

### 2. 인증 헬퍼 `lib/website-auth.ts`

앞 계획의 프록시에서 `authenticate` 를 떼어 온다. `Authorization: Bearer <SSO 세션>` + `X-Sso-App` → `verifySession` → `prisma.user.isActive`. 재직 중인 구성원이면 누구나 쓴다(지금과 같다).

### 3. API — 전부 `/api/website/` 아래 (한 도메인에서는 `/omnis/api/website/`)

| 메서드 · 경로 | 인증 | 하는 일 |
|---|---|---|
| `GET posts` | 공개 | 목록. `position` 순. 응답 `cache-control: s-maxage=60, stale-while-revalidate` |
| `GET posts/[id]` | 공개 | 한 건 |
| `PUT posts/[id]` | SSO | upsert. Zod 검증 → 저장 → 원문 해시가 바뀐 언어를 Gemini 로 번역(`manual: true` 는 건너뜀) → 사이트 재검증 호출 |
| `DELETE posts/[id]` | SSO | 기사 + NAS 사진(WebsiteMedia 순회) 삭제 → 재검증 |
| `PUT posts/order` | SSO | id 배열로 `position` 재부여 |
| `POST media` | SSO | 본문 = 사진 바이트, 헤더 `x-post-id` · `content-type`. NAS `website/<postId>/<cuid>.<ext>` 에 저장, `WebsiteMedia` 기록, `{ url }` 반환. 4MB 상한(`MAX_UPLOAD_BYTES`) |
| `GET media/[...key]` | 공개 | NAS 에서 스트림. `cache-control: public, max-age=86400, s-maxage=31536000, immutable` |

번역은 `scripts/translate-posts.mjs`(사이트 저장소)의 프롬프트와 규칙(블록 수·타입·이미지 src 보존, `translatedFrom` 해시, `manual` 존중)을 `lib/website-translate.ts` 로 옮긴다. 모델만 Anthropic → Gemini.

재검증: 저장·삭제 뒤 `POST ${WEBSITE_ORIGIN}/api/revalidate` 에 `WEBSITE_REVALIDATE_SECRET` 을 실어 보낸다. 실패해도 저장은 성공으로 끝낸다(사이트는 60초 ISR 로도 따라온다).

### 4. 정리

- `app/api/website/github/[...path]/route.ts` 삭제. `.env.example` 의 `WEBSITE_GITHUB_TOKEN` 을 `WEBSITE_ORIGIN` · `WEBSITE_REVALIDATE_SECRET` 으로.
- 인증 문서의 프록시 줄을 API 로. 앞 계획서는 "폐기 — 이 계획으로 대체" 로 표시해 archives 로.

## 사이트 저장소가 할 일 (승인 범위 밖 · 참고)

1. `next.config.ts` 에서 `output: "export"` 제거. `proxy.ts` 가 실제로 동작하므로 postbuild 의 루트 리다이렉트·sitemap·robots 는 `app/sitemap.ts` · `app/robots.ts` 로.
2. `content/server.ts` 의 `listPosts` · `getPost` 를 Omnis API fetch(`next: { revalidate: 60, tags: ["posts"] }`)로. 페이지들은 `await`. `generateStaticParams` 는 두되 `dynamicParams` 로 새 글을 받는다.
3. `app/api/revalidate/route.ts` — 비밀 확인 후 `revalidateTag("posts")`.
4. 관리 화면: `lib/admin-posts.ts` 를 Omnis API 호출로(사진은 저장 시 `POST media` 로 올리고 돌아온 URL 로 `src` 치환). `lib/github.ts` 삭제.
5. `vercel.json`: `outputDirectory: "out"` 제거, 허브 빌드는 `public/hub` 로. GitHub Pages 워크플로는 정적 export 가 없어지므로 내린다. (한 도메인 이전 작업과 겹치므로 그 세션과 맞춘다)
6. 이식이 검증된 뒤 `content/data/news/` 와 `public/news/` 를 지운다.

## 검증

| 단계 | 확인 |
|---|---|
| 스키마 | `prisma migrate dev` 가 로컬(Docker)에서 통과. **Neon 에는 `db:deploy` 로만** (migration-traps 의 shadow DB 함정) |
| Zod | 기존 50건 JSON 이 전부 통과 · 블록 타입이 틀린 JSON 은 거부 |
| 이식 | 로컬 DB 에 50건 · 사진 개수 = `public/news` 파일 수 · 두 번 돌려도 건수 동일 |
| API 거부 | 토큰 없는 PUT/DELETE/POST → 401 · 4MB 초과 → 413 · 잘못된 블록 → 400 |
| API 통과 | PUT 뒤 GET 이 같은 내용 · 번역 필드 생성 · `manual: true` 유지 |
| 사진 | `GET media/<key>` 200 + 캐시 헤더 · 없는 키 404 |
| 사이트 | 로컬에서 목록·상세가 API 로 뜸 · 관리 화면에서 글 저장 → 60초 안에 사이트 반영 |
| 배포본 | Neon `db:deploy` → `vercel deploy --prod` → 사이트 배포 → 실제 로그인·저장·사진 확인 |

## 순서

1. 스키마 + Zod + 이식 스크립트 (로컬 DB 에 이식까지) → 커밋
2. 인증 헬퍼 + API + 번역 + 재검증 → 로컬 curl → 커밋
3. 프록시 삭제 · 문서 → 커밋
4. 사이트 저장소: 렌더 전환 → 관리 화면 전환 → 로컬 확인 → 커밋 (별도 브랜치)
5. 사용자: Neon 마이그레이션 · 환경변수 · Omnis 배포 · 사이트 배포 · 이식 스크립트를 프로덕션에 → 실사용 확인

## 되돌리기 어려운 것

- Neon 스키마 추가(테이블 2개). 되돌리려면 마이그레이션을 내려야 한다. 기존 테이블은 건드리지 않는다.
- 사이트의 정적 export 해제. GitHub Pages · Synology 배포가 끝난다 — 작업지시자가 Vercel 로 통합했으므로 예정된 방향.
- 사이트 저장소의 기사 JSON · 사진 삭제는 이식 검증 뒤 별도 커밋으로, 승인 후에.
