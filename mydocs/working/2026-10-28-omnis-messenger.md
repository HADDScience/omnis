---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-28-omnis-messenger.md
last_verified: 2026-10-28
---

# 옴니스 메신저 — 1단계(채팅방 모델) · 2단계(첫 화면 = 메신저) 구현 · 실측

계획: [`../plans/2026-10-28-omnis-messenger-agent.md`](../plans/2026-10-28-omnis-messenger-agent.md) 의 1 · 2단계.
브랜치 `feat/omnis-messenger`(feat/floating-nav 위, 그 아래 feat/tasks-tab-status), 워크트리 `../omnis-messenger`.
UI 규칙: [`../manual/ux-rules.md`](../manual/ux-rules.md) 「메신저 — 첫 화면」.

## 커밋

| 커밋 | 내용 |
|---|---|
| `3ba63fb` feat(chat): 채팅방에 종류와 참여자를 둔다 — 옴니스 1:1 방의 자리 | 1단계. 스키마 · 마이그레이션 · 방 권한 · 목록 |
| feat(chat): 첫 화면을 옴니스 메신저로 — 방 목록과 여러 턴 대화 | 2단계. 화면 · 여러 턴 · nav · 이 문서 |

## 스키마 (1단계)

마이그레이션 `prisma/migrations/20261028010000_chat_room_kinds` — **추가만 한다.** 칸 삭제 · 이름 변경 없음.

| 무엇 | 바뀐 것 |
|---|---|
| `enum ChatRoomKind` | COMPANY · TASK · OMNIS_DM · GROUP (신설) |
| `ChatRoom` | `kind`(기본 COMPANY) · `createdById?` · `lastMessageAt?` · 색인 `(kind, lastMessageAt)` |
| `ChatRoomMember` (신설) | `(roomId, userId)` 기본키 · `joinedAt` · `lastReadAt?`. COMPANY 는 행을 만들지 않는다 |
| `ChatMessage` | `omnisQueryId?` (unique, → `OmnisQuery`) — 옴니스 답의 출처는 OmnisQuery 에 있다 |
| 데이터 | 기존 방은 DEFAULT 로 COMPANY. `lastMessageAt` 은 지금 글의 최댓값으로 채운다. 업무방은 표를 만들지 않는다 |

**옴니스를 글쓴이로 쓰는 방법 — 시스템 계정(id `"system"`, `lib/system-user.ts`).**
`authorKind` 칸을 새로 두면 `authorId` 필수 제약을 풀거나 가짜 작성자를 넣어야 하고, 글쓴이를 그리는 화면마다 분기가 생긴다.
시스템 계정은 이미 🤖 재구성 글의 작성자이고 로그인할 수 없으며(isActive=false), 채팅 목록 · 지표가 이미 그 id 를 사람이 아닌 것으로 거른다.

**1:1 방 글이 새지 않게** 방을 가리지 않고 글을 모으던 곳을 전사방으로 묶었다(`PUBLIC_MESSAGE_WHERE`, `roomAccess` — `lib/chat-rooms.ts`).

| 곳 | 바꾼 것 |
|---|---|
| 피드(`lib/chat-feed.ts`, 화면 · MCP list_chat) | 모든 view 에 전사방 조건 |
| 사내 지식 색인(`lib/embeddings.ts`) | 전사방 글이 아니면 색인하지 않는다 → 남의 search_knowledge 에 걸리지 않는다 |
| 채팅 지표(`lib/kpi.ts`) | messages.* 를 전사방 글로. 옴니스 질문은 OmnisQuery 로 따로 센다 |
| `GET /api/chat/messages` · `/api/chat/search` | 참여자가 아니면 403 |
| `POST /api/chat/messages` | 전사방이 아닌 방이면 403 — 업무 재구성 · 멘션 알림이 1:1 방에 붙지 않게 |
| `GET /api/chat/rooms` | 모든 방 + 마지막 글 → 내 목록(옴니스 · 전사 · 업무 · 단톡). 쓰는 화면이 없었다 |

로컬(5433)에만 적용했다.

```
$ pnpm exec prisma migrate deploy
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
49 migrations found in prisma/migrations
Applying migration `20261028010000_chat_room_kinds`
All migrations have been successfully applied.

방 [ { id: 'default-room', name: '하드사이언스', kind: 'COMPANY', lastMessageAt: 2026-10-28T01:21:31.000Z, _count: { messages: 15799 } } ]
members 0
```

## 화면 (2단계)

- `/` (로그인) → `/chat`. 로그인 안 한 `/` 는 랜딩 그대로. 로그인 뒤 이동도 `/tasks` → `/chat`(`app/(auth)/login/page.tsx`)
- `/chat` 레이아웃(`MessengerShell`) — 제목줄 「채팅」 + 「새 대화」, 아래에 왼쪽 방 목록 · 가운데 대화. 높이는 MainWithChat 칸 안에서 `h-full`
- 폰은 `/chat` = 목록, 방 주소 = 대화(← 로 목록). CSS 로만 가른다

| 방 종류 | 목록에서 | 주소 | 대화 칸 |
|---|---|---|---|
| 옴니스 1:1 (OMNIS_DM) | 맨 위 「옴니스」 칸. 「새 대화」 줄 + 내 방들(최근 글 순). 무지개 테두리 아이콘, 이름 = 첫 질문 앞 30자, 미리보기 「옴니스: …」(마크다운 기호 · 각주 뗌) | `/chat/[roomId]` · 새 대화 `/chat/new` | 내 글은 오른쪽 말풍선, 옴니스 답은 왼쪽 카드(마크다운 · 각주 · 참고 자료 — 질문 화면과 같은 `OmnisAnswerBody`). 답 기다리는 동안 「옴니스가 사내 자료에서 답을 찾는 중…」 스켈레톤. 답을 못 받은 마지막 질문에 「다시 묻기」 |
| 전사방 (COMPANY) | 「전사방」 칸. 「하드사이언스」 한 줄, 최신 글 미리보기 | `/chat/default-room` | 오른쪽 패널 「전체」 와 같은 `ChatPanel`(폴링 · 검색 · / 업무 명령 · 답장) |
| 단톡방 (GROUP) | 「단톡방」 칸. 「팀원과 단톡방은 곧 만들 수 있어요」 비활성 한 줄 | — (5단계) | 열지 않는다(404) |
| 업무방 (TASK, 표 없음) | 「업무방 · 최근 글 순」 칸. 업무마다 마지막 글 기준 30개, 상태 배지 + 「보낸 사람: 내용」 | `/chat/task/[taskId]` | 업무 상세와 같은 `TaskThread`(스레드 · 히스토리) + 「업무 열기」 |

- 상태(규칙 27~30): 목록 스켈레톤 · 방 `loading.tsx` 스켈레톤 · 빈 목록 문구 · 목록 불러오기 실패 시 「다시 불러오기」 · 보내기 실패는 toast + 「다시 묻기」 · 터치 기기 44px(`.touch-target`)
- 「새 대화」 는 빈 방을 만들지 않는다. 첫 글을 보내면 방을 만들고 바로 묻고 그 주소로 옮긴다
- 오른쪽 패널의 「Omnis AI」 탭은 없앴다(「전체」 · 「이 업무」 그대로). `/omnis/ask` 질문 화면은 건드리지 않았다
- nav: `CHAT_HOME_READY = true`, 채팅 탭 href `/` → `/chat`(누를 때마다 `/` 리다이렉트를 한 번 더 돌지 않게). match `["/chat"]` 가 `/chat/…` 를 모두 켠다
- 온보딩 투어 "ai" 단계 대상은 nav 채팅 탭 링크다(실측: `[data-onboarding="ai"]` = `A:/chat` 두 개 — PC · 폰 nav)

### 여러 턴 대화

- `lib/omnis-room.ts` 가 방의 이전 글을 읽어 `lib/omnis-history.ts` 로 문맥을 만들고 `askOmnisRoute(question, userId, { history, endpoint: "omnisAsk.room" })` 를 부른다
- 상한: 최근 20개 글 · 전체 12,000자 · 글 하나 3,000자. 오래된 왕복부터 버린다. 앞 답의 각주 번호는 지운다(그때 검색 결과를 가리킨다). 답을 못 받은 질문은 문맥에서 뺀다
- 문맥이 있을 때만 시스템 프롬프트에 두 줄을 더한다(앞을 가리키는 말은 앞선 대화에서 찾고, 수치는 도구로 다시 확인)
- MCP `ask_omnis` · 오른쪽 패널 질문 · `/omnis/ask` 는 `history` 를 넘기지 않아 예전 그대로다. `runGeminiToolLoop` 은 `history` 가 없으면 contents 가 예전과 같다
- 엔진은 Gemini(`OMNIS_ASK_MODEL`, 기본 gemini-3.8-flash). 질문 기록(OmnisQuery) · 활동 기록도 예전처럼 남는다

## 검증

### 품질 게이트

```
$ pnpm run verify          # typecheck → lint
verify exit 0
✖ 38 problems (0 errors, 38 warnings)     ← 경고는 모두 이번에 손대지 않은 파일

$ pnpm run test:unit
ℹ tests 51
ℹ pass 51
ℹ fail 0
```

`lib/omnis-history.test.ts` 9건이 이번에 더한 것이다(왕복 · 각주 제거 · 답 없는 질문 제외(거부 사례) · 합치기 · 20개 · 글 길이 · 전체 상한).

### 방 모델 — `pnpm exec tsx --env-file=.env scripts/verify-chat-rooms.ts`

```
대상 DB: localhost:5433
A=윤훈 · B=팀장

[1] 기존 방은 COMPANY
  ✓ default-room 의 kind 가 COMPANY
  ✓ COMPANY 아닌 방은 모두 만든 사람이 있다

[2] 읽기 권한
  ✓ A 는 자기 1:1 방을 읽는다
  ✓ B 는 A 의 1:1 방을 못 읽는다 (거부되어야 하는 경우)
  ✓ B 는 전사방을 읽는다
  ✓ 없는 방은 missing

[3] 목록
  ✓ A 의 목록에 그 방이 옴니스 칸으로
  ✓ A 의 목록 미리보기는 옴니스 글
  ✓ B 의 목록에는 없다 (거부되어야 하는 경우)
  ✓ 전사방이 목록 맨 위
  ✓ 업무방은 최근 글 순
  ✓ 업무방 id 는 업무 id
    옴니스 1 · 전사 1 · 업무 30 · 단톡 0

[4] 방을 가리지 않는 읽기에 새지 않는다
  ✓ 피드 view=all 에 1:1 글이 없다
  ✓ 피드 view=ai 에 1:1 글이 없다
  ✓ 만든 사람의 피드에도 없다 — 피드는 전사방 보기다

[5] 미리보기 문구
  ✓ 업무 카드 표식
  ✓ 🤖 접두사를 뗀다
  ✓ 60자에서 자른다
  ✓ 마크다운 기호 · 각주를 뗀다

전부 통과
```

### HTTP — `BASE=http://localhost:3102 pnpm exec tsx --env-file=.env scripts/verify-omnis-room-http.ts`

Gemini 를 부르지 않는 경로만 친다(비용 0).

```
대상 DB: localhost:5433 · 서버: http://localhost:3102
A=윤훈 · B=팀장

[1] 첫 화면
  ✓ 로그인한 / 는 /chat 으로
  ✓ 로그인 안 한 / 는 랜딩(200)
  ✓ /chat 은 메신저(200)

[2] 방 화면
  ✓ A 는 자기 방을 연다 — 글이 보인다
  ✓ B 는 A 의 방을 못 연다 — 404 · 글이 없다 (거부되어야 하는 경우)
  ✓ 없는 방은 404

[3] 목록 API
  ✓ A 의 목록에 있다
  ✓ B 의 목록에 없다 (거부되어야 하는 경우)
  ✓ 로그인 없이 401

[4] 묻기 API — Gemini 앞에서 막히는 경우
  ✓ B 가 A 의 방에 물으면 404 (거부되어야 하는 경우)
  ✓ 1자는 400
  ✓ 1001자는 400
  ✓ 이미 답을 받은 글을 다시 물으면 409
  ✓ 새 대화 빈 글은 400 — 방을 만들지 않는다

[5] 전사방 API 로 1:1 방을 건드리지 못한다
  ✓ B 가 메시지 API 로 읽으면 403 (거부되어야 하는 경우)
  ✓ A 는 메시지 API 로 읽는다
  ✓ B 가 검색 API 로 찾으면 403
  ✓ 1:1 방에 전사방 글쓰기 API 로 쓰면 403
  ✓ 전사방은 그대로 읽힌다
  ✓ 거부된 요청은 글을 남기지 않았다
  ✓ 거부된 새 대화는 방을 만들지 않았다

전부 통과
```

### 옴니스에게 2턴 (실제 Gemini, 정우창 계정, 로컬 DB)

Playwright 1440px 에서 「새 대화」 → 1턴 → 같은 방에서 2턴. 두 번째 질문에는 업무 이름이 없다.

```
1턴 응답 11.3초      (보내기 → 방 주소로 옮겨 답이 보일 때까지)
2턴 응답 7.1초
방 /chat/c29dce5e-863c-452f-b3df-f6e14e4530b4
```

DB 에 남은 대화:

```
--- 08:32:53 사람
지금 마감이 지난 업무가 몇 건이야? 담당자도 같이 알려줘
--- 08:33:02 옴니스 omnisQueryId=375d0ca3-…
현재 마감이 지난 업무는 **1건**입니다.
- **업무명**: 가나다라마바사아자차카타파하가나다 (#task-14139531)
  - 담당자: 노혜린 / 상태: 진행 중 / 마감일: 2026-10-28 (지연) / 프로젝트: IP 디딤돌 후속과제(코엔)
--- 08:33:10 사람
그중 첫 번째 업무는 체크리스트가 어디까지 됐어?
--- 08:33:15 옴니스 omnisQueryId=02c7451b-…
해당 업무의 체크리스트는 총 3개 항목 중 **완료된 항목이 없습니다(0/3 진행 중)**.
- [ ] 1. 가나다라마바사아자차카타파하가 (미완료)
- [ ] 2. 가나다라마바사아자차카 (미완료)
- [ ] 3. 가나다라마바사아자차카 (미완료)

대조 — 1턴이 가리킨 업무(task-14139531)의 DB 체크리스트: done=false 3개
```

업무 · 사람 글이 「가나다…」 인 것은 로컬 DB(5433)에 지금 들어 있는 자료 그대로다.

사용량(`GeminiUsage`, endpoint `omnisAsk.room`) — 2턴에 모델 호출 4번:

```
08:32:55  입력 5997  출력  15   ← 1턴 도구 호출
08:33:02  입력 6099  출력 102   ← 1턴 답
08:33:12  입력 6199  출력  25   ← 2턴 도구 호출 (1턴 첫 호출보다 입력 +202 — 앞 대화가 실렸다)
08:33:15  입력 7768  출력 106   ← 2턴 답
합계 입력 26,063 · 출력 248 토큰
```

### 좁은 화면 — `BASE_URL=http://localhost:3102 AUDIT_USER=팀장 AUDIT_PASS=… ROUTES=/chat,/chat/new,/chat/default-room,/chat/task/… node scripts/narrow-audit.mjs`

```
✗ 320px /chat               overflow=0 bleed=0 clip=12 ellip=12 tiny=0
· 320px /chat/new           overflow=0 bleed=0 clip=0 ellip=0 tiny=0
✗ 320px /chat/default-room  overflow=0 bleed=0 clip=1 ellip=2 tiny=4
✗ 320px /chat/task/…        overflow=0 bleed=0 clip=5 ellip=5 tiny=3
· 280px /chat               overflow=0 bleed=0 clip=0 ellip=0 tiny=0
· 280px /chat/new           overflow=0 bleed=0 clip=0 ellip=0 tiny=0
✗ 280px /chat/default-room  overflow=0 bleed=0 clip=2 ellip=3 tiny=4
✗ 280px /chat/task/…        overflow=0 bleed=0 clip=6 ellip=6 tiny=6
✗ 240px /chat               overflow=0 bleed=0 clip=12 ellip=12 tiny=0
✗ 240px /chat/new           overflow=0 bleed=0 clip=2 ellip=2 tiny=0
✗ 240px /chat/default-room  overflow=0 bleed=0 clip=3 ellip=4 tiny=5
✗ 240px /chat/task/…        overflow=0 bleed=0 clip=8 ellip=8 tiny=4
✗ 200px /chat               overflow=0 bleed=0 clip=12 ellip=12 tiny=0
✗ 200px /chat/new           overflow=0 bleed=0 clip=1 ellip=1 tiny=0
✗ 200px /chat/default-room  overflow=0 bleed=0 clip=2 ellip=3 tiny=4
✗ 200px /chat/task/…        overflow=0 bleed=0 clip=9 ellip=9 tiny=3
잘리거나 넘친 화면: 13 / 16      (exit 1)
```

- **가로 넘침 · 화면 밖 삐져나감은 200px 까지 0** 이다
- clip · ellip 은 방 이름 · 미리보기 한 줄의 말줄임(`truncate`)이다 — 목록 한 줄을 의도대로 자른 것
- tiny(44px 미만)는 모두 재사용한 전사방 `ChatPanel` · 업무방 `TaskThread` 안의 것이다: 답장 아이콘 20px, `#업무` 칩 20px, 입력창 옆 버튼 33px, 첨부 이미지 링크 20px. 오른쪽 패널에서도 같다. 이번에 만든 목록 · 옴니스 방에는 없다
- 스크립트의 로그인 대기가 `**/dashboard` 에 묶여 있어 지금 로그인 흐름(→ /chat)에서 멈췄다. 「로그인 화면을 벗어났는지」 로 고치고 채팅 경로 셋을 기본 목록에 더했다

### 화면 확인 — dev `http://localhost:3102`

`env -u GEMINI_API_KEY NEXTAUTH_URL=http://localhost:3102 pnpm next dev --webpack -p 3102`, 로그는 파일로. 로그인은 로컬 `NEXTAUTH_SECRET` 으로 만든 세션 쿠키(`next-auth/jwt` encode, salt `authjs.session-token`).
스크린샷 `mydocs/working/omnis-messenger/` — 모든 장에서 문서 가로 넘침 0px.

| 파일 | 무엇 |
|---|---|
| `1440-chat-home.png` · `375-chat-home.png` | 첫 화면. PC 는 목록 + 새 대화 칸, 폰은 목록만 |
| `1440-new-chat.png` · `375-new-chat.png` | 새 대화 — 예시 질문 · 입력창 |
| `1440-turn1-thinking.png` | 첫 질문을 보낸 직후 — 보내는 중 말풍선 + 답 찾는 중 스켈레톤 |
| `1440-turn1.png` | 방이 생기고 목록 「옴니스」 칸에 올라온 뒤 1턴 답 |
| `1440-turn2.png` · `375-turn2.png` | 2턴 — 「그중 첫 번째 업무」 를 1턴 답의 업무로 풀어 답함 |
| `375-list-with-room.png` | 폰 목록에 새 옴니스 방 |
| `1440-company-room.png` · `375-company-room.png` | 전사방 |
| `1440-task-room.png` · `375-task-room.png` | 업무방 |
| `1440-right-panel.png` | 오른쪽 패널 — 탭은 「전체」 만(업무 화면 밖), 「Omnis AI」 없음 |

## 남은 문제

1. **방 화면의 404 는 HTTP 200 으로 나간다.** `loading.tsx` 가 스트리밍을 먼저 시작해 `notFound()` 가 상태 코드 대신 본문 표식(`NEXT_HTTP_ERROR_FALLBACK;404`)으로 온다. 남의 방 내용은 내려가지 않는다(HTTP 검증 [2]). 상태 코드까지 404 여야 하면 방 페이지의 `loading.tsx` 를 빼야 한다
2. **재사용한 `ChatPanel` · `TaskThread` 의 44px 미만 터치 타깃**(위 narrow-audit). 오른쪽 패널에서 이미 그랬던 것이고 이번에 고치지 않았다
3. 콘솔 경고 두 가지를 한 번씩 봤다 — 375px 연속 이동 중 「hydrated but some attributes … didn't match」, 1440px 전사방에서 「state update on a component that hasn't mounted yet」. 같은 주소를 새로 열면 다시 나오지 않았다(375px 에서 /tasks · /chat · /chat/new · 전사방 · 업무방 · 옴니스 방을 각 1~2회 새로 열어 0건)
4. 답은 스트리밍하지 않는다 — 실측 7~11초 동안 스켈레톤. 함수 상한 `maxDuration = 60`
5. 방 이름은 첫 질문 앞 30자로 고정이고, 방 이름 바꾸기 · 지우기는 없다. `lastReadAt` 은 남기지만 안 읽은 표시는 아직 그리지 않는다
6. 문맥에는 앞 대화의 **글**만 들어가고 앞 턴의 도구 결과는 들어가지 않는다. 2턴처럼 앞 답에 슬러그가 있으면 이어지지만, 앞 답에 없던 세부를 물으면 도구를 다시 부른다
7. 전사방을 가운데에 연 채로 오른쪽 패널 「전체」 도 열면 같은 방을 두 곳에서 폴링한다
8. `/omnis/ask` 질문 화면과 `OmnisAsk` 의 dock 변형(이제 쓰는 곳 없음)은 그대로 두었다
9. 작업 중 디스크가 가득 찼다(남은 공간 185MB, `ENOSPC`). 내 `.next/dev/cache` 만 지우고 dev 서버를 다시 띄웠다. 이후 누군가 공간을 비우면서(34GB) `.next` 캐시 파일이 사라져 한 번 더 다시 띄웠다

## 운영 반영 순서 — migrate 먼저, 머지 나중

1. 운영 DB 를 가리키는지 호스트부터 찍고 확인한 뒤 `pnpm run db:deploy` — `20261028010000_chat_room_kinds` 하나. 추가만 하는 변경이라 지금 운영 코드는 그대로 돈다
2. 그 다음 머지. 순서는 nav 계획대로 **캘린더(머지됨) → nav(`feat/floating-nav`, 그 아래 `feat/tasks-tab-status`) → 이 브랜치**
3. migrate 전에 이 코드가 나가면: 목록 · 피드 · 지표 · 색인이 `ChatRoom.kind` 를 읽다 오류가 난다(`lib/kpi.ts` 의 raw SQL 포함). kpi-export 를 운영에 돌릴 때도 migrate 뒤에
4. 데모(`omnis`) 프로젝트는 main 빌드가 `prisma migrate deploy` 를 돌려 따로 할 일이 없다
