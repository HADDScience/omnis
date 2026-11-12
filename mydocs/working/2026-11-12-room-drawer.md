---
kind: snapshot
status: active
canonical: mydocs/plans/2026-11-12-room-drawer.md
last_verified: 2026-11-12
---

# 방 서랍 + 첨부 한 번에 받기 — 검증 기록 (2026-11-12)

## 게이트
- `pnpm test:unit` — 771/771 (새 11건: `lib/room-drawer.test.ts` 7 · `lib/zip-stream.test.ts` 4)
- `pnpm run verify` — typecheck 통과, eslint 오류 0
- 로컬 격리 DB(`scripts/e2e-local.mjs`) + 가짜 NAS(`scripts/e2e-fake-nas.mjs`)
  - `tests/feature/room-drawer.spec.ts` 5/5
  - `tests/feature/photo-viewer.spec.ts` 12/12(모아보기 시험을 서랍 기준으로 고침)

## 시험 중 찾아 고친 것
- **글자 있는 글의 첨부가 서랍에서 빠짐.** 시스템 글을 거르려고 Prisma `startsWith: "__"` 를 썼는데 LIKE 의 `_` 는 아무 글자 하나라서
  두 글자 이상인 글이 모두 빠졌다. 서랍 쿼리는 읽은 뒤 JS 로 거른다(`lib/room-drawer-server.ts` isSystemContent, `/api/chat/photos` 와 같은 방식)
- e2e 는 데모 빌드라 `demoStorageBlocked` 가 받기 API 를 막는다 — 가짜 NAS 를 띄워야 돈다(CI 와 같다)
- 화면 배율(`--ui-zoom: 1.1`) 때문에 css 440px 서랍이 화면에서 484px 로 잡힌다 — 시험은 범위로 본다
- 진행 알약이 폰 입력창과 겹쳤다 — 채팅 방 안에서는 입력창 위로 올린다

## 확인 못 한 것
- R2 서명 주소로 받는 큰 파일(운영). 버킷 CORS 에 GET 은 열려 있다(`mydocs/manual/r2-upload.md`)
- 실제 iPhone 공유 시트의 「이미지 저장」(e2e 는 navigator.share 를 바꿔 끼워 넘긴 파일 수만 본다)
- 크롬 · 엣지의 저장 위치 창(showSaveFilePicker) 경로 — 시험 브라우저에서는 창을 열 수 없어 지우고 「모아서 받기」 경로로 돌렸다
