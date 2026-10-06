---
kind: decision
status: active
canonical: mydocs/plans/archives/2026-10-06-chat-search.md
last_verified: 2026-10-06
---

# 채팅 검색

상태: **승인 (2026-10-06).** 3개 이상 파일에 걸쳐 AGENTS.md 타스크 사이클 2단계를 거친다.
스키마 변경 · 마이그레이션은 없다.

## 정한 것 (2026-10-06 작업지시자 선택)

| 질문 | 선택 |
|---|---|
| 어디에 | 오른쪽 채팅 패널 안 검색창. 지금 보는 방(업무 필터 중이면 그 업무) 안에서만 찾는다 |
| 결과를 누르면 | 그 메시지 자리로 이동해 앞뒤 대화와 함께 보여 주고 잠깐 강조 |
| 방식 | 글자 포함 검색(`ILIKE`). 의미 검색 없음 |

Cmd+K 팔레트(`/api/search`)는 건드리지 않는다.

## 지금 코드 (2026-10-06 실측)

- 채팅 메시지를 찾는 화면이 없다. `/api/search` 는 카드 · 업무 · 보고서만 찾는다
- 채팅 목록은 최신 30개(`CHAT_PAGE_SIZE`)부터 위로 스크롤해 불러온다 (`components/chat/chat-panel.tsx`)
- 로컬 스냅샷 `default-room` 메시지 **14,098건**(2025-08-20 ~ 2026-10-01). 그래서 1년 전 결과로 가려고
  사이를 전부 불러올 수 없다 → **결과 주변만 불러오는 「점프 보기」** 가 필요하다
- `@@index([roomId, createdAt])` 있음. 본문 색인은 없다. 1만 4천 행 `ILIKE` 는 색인 없이도 충분할 것으로 보고
  실측해서 느리면(> 300ms) 그때 `pg_trgm` 을 따로 계획한다
- 가린 카톡 줄(`import-tools/redact.ts`)은 본문을 덮어써서 검색에 원문이 걸리지 않는다. 지운 글(`deletedAt`)은 뺀다

## 단계

### 1. 검색 API — `GET /api/chat/search`

- 인자 `roomId` · `q`(2자 이상) · `taskId?` · `before?`(더 보기 커서)
- 조건: `content ILIKE %q%`(Prisma `contains` + `mode: insensitive`), `deletedAt: null`, `kind: NORMAL`,
  `__` · `🤖` 로 시작하는 시스템 글은 코드에서 거른다(`startsWith: "__"` 는 LIKE 와일드카드 함정 — bd9f389)
- 최신순 20건. 응답: `id · createdAt · author.name · task{name,slug} · snippet`(걸린 자리 앞뒤 40자)

### 2. 주변 불러오기 — `GET /api/chat/messages?around=<id>`

- 대상 앞 15 + 대상 + 뒤 15 를 오름차순으로. 모양은 지금 GET 과 같게(지운 글 처리 · replyTo 포함) — 모양 만드는 부분을 함수로 뽑아 같이 쓴다
- `after` 에 `take` 를 받아 「아래로 더 불러오기」에 쓴다(폴링은 지금처럼 200)

### 3. 패널 — 「점프 보기」 상태

- `ChatPanel` 에 `jumpTo(id)`: 폴링을 멈추고 목록을 주변 창으로 갈아 끼운다. `hasMoreNewer` 를 둔다
- 맨 아래로 스크롤하면 뒤를 불러온다. 다 따라잡으면 점프 보기를 끝내고 폴링을 다시 켠다
- 목록 위에 「검색 결과 보는 중 · 최신으로」 한 줄 — 누르면 지금처럼 최신 30개로 돌아간다
- `MessageList` 에 `highlightId` · `onLoadNewer` · `hasMoreNewer` · `loadingNewer`. 강조 대상은
  `scrollIntoView({ block: "center" })` 후 2초 배경 강조. 점프 보기 중 뒤를 붙일 때는 맨 아래로 끌어내리지 않는다
- 업무 스레드 등 다른 `MessageList` 사용처는 새 prop 이 없으면 지금과 같다

### 4. 검색 UI — `components/chat/chat-search.tsx`

- 패널 업무 칩 줄 옆(또는 위) 🔍 버튼 → 입력창 + 결과 목록이 목록 자리를 덮는다. Esc · ✕ 로 닫는다
- 입력 300ms 디바운스, 이전 요청은 `AbortController` 로 끊는다(팔레트와 같은 방식)
- 결과 줄: 작성자 · 날짜 · 업무 칩 · 걸린 글자 굵게. 「더 보기」로 다음 20건
- 상태: 검색 중 Spinner(규칙 27) · 0건 문구(규칙 28) · 실패 toast(규칙 29) · 버튼 `aria-label` · `.touch-target`(규칙 26 · 30)

### 5. 검증

- `pnpm run verify` · `pnpm run build`
- API 실측: 로컬 스냅샷에서 검색어 몇 개의 건수 · 응답 시간, 지운 글 · 시스템 글이 안 나오는지
- `next dev` 로 화면 확인(Playwright): 검색 → 1년 전 결과 클릭 → 그 자리 강조 → 아래로 스크롤 → 최신으로
- `narrow-audit.mjs` 320~200px
- 결과는 `mydocs/working/2026-10-06-chat-search.md`

## 하지 않는 것

- 의미 검색 · 여러 방 검색 · 작성자/날짜 필터 · Cmd+K 연동
- 본문 색인(`pg_trgm`) — 실측이 느릴 때 따로
