---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-16-hadd-db-landing-context-first.md
last_verified: 2026-09-16
---

# HADD DB 랜딩 — 히어로를 회사 Context 에 넘긴다 · 결과

계획: [`plans/2026-09-16-hadd-db-landing-context-first.md`](../plans/2026-09-16-hadd-db-landing-context-first.md)
바꾼 파일: `components/omnis/hadd-db-landing.tsx` 하나.

## 무엇이 달라졌나

| | 전 | 후 |
|---|---|---|
| h1 | 회사의 모든 지식, 한 번의 검색으로. | 회사가 쌓아 온 것, 한자리에. |
| 부제 | `0 카드 · 3 카테고리 · 매주 업데이트` | 카드 0이면 `회사 정보 · 연혁 · 시장기업부터. 카드는 AI 제안으로 쌓입니다` / 카드가 있으면 `카드 n · 카테고리 m` |
| 순서 | 히어로 → 검색 → 칩 → 타일 | 히어로 → **타일** → 검색 → 칩 |
| 타일 | `px-3.5 py-3` · 값 14.5px | `px-4 py-4` · 값 17px · 그림자 |
| 검색 예시 | 카드가 없어도 `"HPLC 세척 주기"` | 카드가 없으면 `업무 · 보고서 · 지식재산권` (실제 검색 범위) |
| 필터 칩 | 항상 — 0건이면 다섯 개 전부 `· 0` | `totalCards > 0` 일 때만 |
| 카드 3열 | 항상 — 0건이면 "아직 카드 없음" × 3 | `totalCards > 0` 일 때만 |

카드 UI 는 지우지 않고 조건부 렌더로 감췄다. 카드가 생기면 예전 화면이 그대로 돌아온다.

## 돌린 것과 그 출력

### 품질 게이트

```
$ npm run verify
✖ 41 problems (0 errors, 41 warnings)
$ npm run verify >/dev/null 2>&1; echo $?
0
```

경고 41건은 전부 이전부터 있던 `no-unused-vars` 다 — `hadd-db-landing.tsx` 에서 나온 것은 없다.

### 카드 0건 (운영과 같은 상태)

`localhost:3000/omnis` 실측. 히어로 아래로 타일 3개(2025 매출 3.07억 · 170건 · 41곳)가
먼저 오고, 필터 칩 줄과 "아직 카드 없음" 3열이 사라졌다. 검색 막대는
`검색 · 업무 · 보고서 · 지식재산권`.

### 카드 1건 (되돌아오는지)

로컬 DB 에 임시 카드 한 장을 넣고 확인한 뒤 지웠다(`현재 카드 수: 0` 으로 복귀).

- 부제 → `카드 1 · 카테고리 3`
- 칩 줄 복귀 → `전체 / 즐겨찾기 · 0 / 기업정보 · 1 / 인력현황 · 0 / 지식재산권 · 0`
- 3열 복귀 → `최근 수정` · `많이 참조됨` · `최근 열람` 모두 렌더
- 검색 예시 → 그 카드 제목

### 좁은 폭 (320px)

`scripts/narrow-audit.mjs` 는 `AUDIT_USER`·`AUDIT_PASS` 가 필요한데 이 세션엔 없어
**돌리지 못했다.** 대신 인증된 브라우저에서 320px 로 직접 쟀다.

```
viewport 320 · scrollWidth 320 · 가로 스크롤 없음
타일 3개 각 128×92 — 2열로 접힘, 넘침 없음
h1 264px 넘침 없음 · 검색 막대 높이 46px (44px 이상)
```

넘친 요소 8건은 전부 우측 ChatDock(`position: fixed` 로 화면 밖에 있는 것)과 그 헤더
버튼이고, 44px 미만 타깃 6건도 같은 dock·사이드바 토글이다 — 이번 변경과 무관한
기존 요소다.

## 곁다리로 고친 환경 문제

화면을 보려는데 dev 서버가 500 을 냈다. 둘 다 이번 변경과 무관한 로컬 환경 문제다.

1. **Prisma 클라이언트가 낡았다** — `Cannot read properties of undefined (reading 'findUnique')`.
   `npx prisma generate` 로 재생성. `generated/` 는 gitignore 대상이라 커밋에 안 들어간다
2. **로컬 DB 가 마이그레이션 한 건 뒤처져 있었다** — `The column ChatMessage.editedAt does not exist`.
   어제 머지된 `20260916000000_chat_message_actions` 가 로컬에만 안 들어가 있었다.
   `npm run db:deploy` 로 로컬(`localhost:5433`)에만 적용했다. 운영 DB 는 건드리지 않았다

```
$ npx prisma migrate status
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
Following migration have not yet been applied:
20260916000000_chat_message_actions
$ npm run db:deploy
Applying migration `20260916000000_chat_message_actions`
All migrations have been successfully applied.
```

## 남은 것

- 검색 대상을 회사 자료까지 넓히는 일(A안)은 안 했다. `EmbeddingSource` 에
  `COMPANY_RECORD`·`MARKET_COMPANY` 를 더하고 백필 + 검색 결과 화면이 필요하다
- 온보딩 안내 저장이 로컬에서 실패한다(`안내 이력을 저장하지 못했어요` 토스트).
  이번 범위 밖이라 손대지 않았다
