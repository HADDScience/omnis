---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-28-omnis-messenger.md
last_verified: 2026-10-29
---

# 옴니스 메신저 — 1단계(채팅방 모델) · 2단계(첫 화면 = 메신저) · 2-b(목록 칩 · 폴더 · 검색) 구현 · 실측

계획: [`../plans/2026-10-28-omnis-messenger-agent.md`](../plans/2026-10-28-omnis-messenger-agent.md) 의 1 · 2단계.
브랜치 `feat/omnis-messenger`(feat/floating-nav 위, 그 아래 feat/tasks-tab-status), 워크트리 `../omnis-messenger`.
UI 규칙: [`../manual/ux-rules.md`](../manual/ux-rules.md) 「메신저 — 첫 화면」.

## 커밋

| 커밋 | 내용 |
|---|---|
| `3ba63fb` feat(chat): 채팅방에 종류와 참여자를 둔다 — 옴니스 1:1 방의 자리 | 1단계. 스키마 · 마이그레이션 · 방 권한 · 목록 |
| `d7a76ed` feat(chat): 첫 화면을 옴니스 메신저로 — 방 목록과 여러 턴 대화 | 2단계. 화면 · 여러 턴 · nav · 이 문서 |

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

## 2-b. 방 목록 필터 · 폴더 · 검색 (2026-10-29)

작업지시자 요청: 카톡처럼 목록 위에 칩 한 줄 + 사용자 폴더 + 검색. 참고 화면은 카톡 「목록 위 필터 칩」 · 「채팅방 폴더 관리」 — 모양은 Omnis 부품(Badge · Dialog · DropdownMenu · ContextMenu)으로 그렸다.
3단계(feat/omnis-agent)가 같은 브랜치 위에서 대화 칸을 바꾸고 있어, 이번 변경은 **목록 · 목록 API · 폴더 · 읽음** 파일에만 두었다 — `omnis-room.tsx` · `company-room.tsx` · `lib/omnis-room.ts` · `lib/omnis-ask.ts` 는 건드리지 않았다.

| 곳 | 무엇 |
|---|---|
| `lib/chat-list.ts` | 규칙(순수 함수) — 방 키 · 칩 · 규칙 폴더 · 안 읽음 셈법 · 검색 · 남의 방 키 판정. 브라우저와 서버가 같이 쓴다 |
| `lib/chat-prefs.ts` | 읽음 · 즐겨찾기 · 폴더 쓰기. 방 키를 쓰기 전에 `checkRoomKey` |
| `lib/chat-rooms.ts` `listRooms` | 방마다 `key` · `unread` · `favorite`, 응답에 `folders` · `query`. `?q=` 검색. 즐겨찾기 · 폴더에 넣은 업무방은 최근 30개 밖이라도 온다 |
| `lib/schemas/chat-folder.ts` | API 입력(Zod) |
| `app/api/chat/prefs` | `PATCH { roomKey, favorite?, read? }` |
| `app/api/chat/folders` · `[folderId]` · `[folderId]/rooms` | 만들기(`{name}` · `{rule}`) · 순서 · 이름 · 지우기 · 방 넣기/빼기 |
| `components/messenger/room-list.tsx` · `folder-manager.tsx` · `chat-prefs-client.ts` | 검색칸 · 칩 · ⋯/우클릭 메뉴 · 폴더 관리 창 · 읽음 올리기 |

### 스키마 — 마이그레이션 `prisma/migrations/20261029010000_chat_folders` (추가만)

| 무엇 | 칸 |
|---|---|
| `ChatRoomPref` (신설) | `(userId, roomKey)` 기본키 · `favorite` · `lastReadAt?` · `createdAt` · `updatedAt` |
| `enum ChatFolderRule` (신설) | COMPANY · TASK · GROUP |
| `ChatFolder` (신설) | `id` · `userId` · `name` · `rule?` · `order` · 유일 `(userId, rule)` · 색인 `(userId, order)` |
| `ChatFolderRoom` (신설) | `(folderId, roomKey)` 기본키 · `addedAt` |
| `User` | 관계 칸 `chatRoomPrefs` · `chatFolders`(DB 칸 없음) |

- **방을 id 가 아니라 방 키로 가리킨다** — `room:<ChatRoom.id>` · `task:<Task.id>`. 전사방은 참여자 행이 없고 업무방은 표 자체가 없어(taskId 로 묶인 가상 방) `ChatRoomMember.lastReadAt` 에 달 수 없다. 방 키는 FK 가 아니라서 방 · 업무가 지워지면 설정 행이 남는다 — 목록은 있는 방에만 설정을 붙이므로 화면에는 영향이 없다
- **`ChatRoomPref` 의 키 `*` 한 줄 = 안 읽음을 세기 시작한 시각.** 처음 목록을 연 순간 만든다. 이 줄이 없으면 한 번도 안 연 전사방(글 1만 5천여 건)이 통째로 안 읽은 글이 된다. 한 번도 안 연 방은 이 시각 뒤의 글만 센다. API 는 `*` 를 받지 않는다(400)
- 규칙 폴더 유일 제약은 `(userId, rule)` — 수동 폴더는 rule 이 NULL 이라 Postgres 에서 서로 겹치지 않는다
- `ChatRoomMember.lastReadAt` 은 그대로 두고 쓰지 않는다(옴니스 방 코드가 3단계에서 바뀌는 중이라 손대지 않았다)
- 백필 없음 — 새 표뿐이고, 기준 줄은 목록이 처음 열릴 때 생긴다

```
$ pnpm exec prisma migrate deploy
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
50 migrations found in prisma/migrations
Applying migration `20261029010000_chat_folders`
All migrations have been successfully applied.

$ pnpm exec prisma migrate status
50 migrations found in prisma/migrations
Database schema is up to date!
```

같은 로컬 DB 를 쓰는 feat/omnis-agent 의 `20261029000000_agent_runtime` 은 이 시점에 적용 기록이 없었고, `migrate deploy` 는 실패 없이 지나갔다.

### 정한 것

| 무엇 | 정한 것 | 왜 |
|---|---|---|
| 안 읽은 글 | 방을 마지막으로 읽은 시각(없으면 기준 시각) 뒤의 글. **지운 글 · 내 글은 세지 않는다.** **시스템 계정 글은 옴니스 1:1 방에서만 센다** | 전사방 · 업무방의 🤖 글(재구성 · 완료 확인 대기)은 사람 글 뒤에 저절로 붙어 한 번 대화에 배지가 두 번 오른다. 옴니스 1:1 방에서는 옴니스 답이 그 방의 상대 글이다 |
| 업무 스레드 글 | 업무방에서 세고, **전사방에서도 센다** | 전사방 화면(`ChatPanel` 「전체」)에 같은 글이 보인다. 업무방만 열면 전사방 배지는 남는다 |
| 읽음 올리기 | 방을 열 때 · 떠날 때 · 열어 둔 방에 목록이 새 글을 셀 때(30초 폴링) | 대화 칸을 건드리지 않으려고 목록이 주소로 지금 방을 안다. 연 방의 배지는 서버 응답 전에도 0 으로 그린다 |
| 규칙의 정본 | `countsAsUnread`(순수 함수). 서버는 같은 규칙을 SQL 로 센다 | 목록마다 메시지를 불러와 세면 무겁다. 대신 HTTP 검증이 실제 DB 에서 SQL 과 이 함수의 답을 맞춰 본다(아래 [6]) |
| 「안읽음」 칩 배지 | 안 읽은 글이 있는 **방의 수**. 줄 배지는 그 방의 **글 수**, 100 부터 「99+」 | 카톡과 같다 |
| 검색 범위 | **고른 칩과 상관없이 전체에서** | 폴더 칩을 고른 채 찾다가 다른 폴더의 방을 놓치는 일이 없게. 검색 중에는 칩 줄을 옅게 하고 「전체에서 찾은 방 N개」 를 띄운다 |
| 검색 대상 | 방 이름 · 업무 이름 · 슬러그(`#` 붙여도) · 마지막 글 미리보기(보낸 사람 포함). 메시지 본문 전체는 범위 밖 | 업무방은 서버가 최근 30개에 묶지 않고 최대 50개까지 찾는다(ILIKE, `%`·`_`·`\` 이스케이프) |
| 남의 방 키 | 폴더 넣기 · 즐겨찾기 · 읽음 모두 **404**(없는 방과 같은 답) | 403 과 404 가 갈리면 그 id 의 1:1 방이 있다는 것이 샌다 |
| 규칙 폴더 | 종류마다 하나(409), 방을 손으로 넣지 않는다(400) | 규칙으로 채우는 폴더에 손 넣은 방이 섞이면 무엇이 왜 들어 있는지 알 수 없다 |
| 폴더 한도 | 사람당 20개, 이름 20자 | 칩 줄이 끝없이 길어지지 않게 |
| 칩 기억 | `localStorage` `omnis.chat.chip.<userId>` | 요구대로. 기기마다 따로 기억한다 |

### 함정 — SQL 조각이 next dev 에서 jsonb 로 직렬화됐다

처음에는 업무방 질의의 조건을 `Prisma.sql` 조각으로 끼웠다. `tsx` 로 부르면 통과하는데 dev 서버(webpack)에서는 500 이었다.

```
Raw query failed. Code: `42804`. Message: `ERROR: argument of AND must be type boolean, not type jsonb`
```

webpack 번들 안의 `Prisma.sql` 이 `$queryRaw` 가 아는 Sql 객체로 인식되지 않아, 조각이 SQL 이 아니라 값(jsonb 매개변수)으로 넘어갔다.
조각을 걷고 `${ids}::text[] IS NULL OR …` · `${pattern}::text IS NULL OR …` 처럼 매개변수로만 넘겼다.
`lib/kpi.ts` 도 `Prisma.sql` 조각을 쓴다 — 그쪽이 dev 서버에서 도는 경로인지는 확인하지 않았다.

새 표를 더한 뒤 `prisma generate` 를 해도 **떠 있던 dev 서버는 옛 클라이언트를 쥐고 있어**(`prisma.chatRoomPref` 가 undefined) 서버를 다시 띄웠다.

### 검증

#### 품질 게이트

```
$ pnpm run verify
verify exit 0
✖ 37 problems (0 errors, 37 warnings)     ← 이번에 손댄 파일에는 경고가 없다

$ pnpm run test:unit
ℹ tests 70
ℹ pass 70
ℹ fail 0
```

`lib/chat-list.test.ts` 19건이 이번에 더한 것이다 — 방 키 해석 · 주소 → 방 키 · **남의 1:1 방 키 forbidden** · 없는 방/잘못된 키 · **규칙 폴더 분류**(새 업무방도 저절로, 손 넣은 키 무시) · 수동 폴더 · 전체 한 목록(최근 글 순) · 옴니스/안읽음/즐겨찾기 칩 · 지운 폴더 칩 · **안 읽음 셈법**(읽은 뒤 남의 글만 · 내 글/지운 글 제외 · 시스템 글은 1:1 방에서만 · 기준 시각) · 99+ · **검색 거르기**(이름 · #슬러그 · 미리보기 · 보낸 사람 · 없는 말 · 대소문자).

#### HTTP — `BASE=http://localhost:3102 pnpm exec tsx --env-file=.env scripts/verify-chat-folders.ts`

시험 글은 DB 에 직접 넣는다(전사방 글쓰기 API 는 색인 · 재구성으로 모델을 부를 수 있다). 끝에 시험 글 · 방 · 폴더를 지우고 두 사람의 방 설정을 되돌린다.

```
대상 DB: localhost:5433 · 서버: http://localhost:3102
A=윤훈 · B=팀장

[1] 목록 응답
  ✓ 방마다 key · unread · favorite 가 있다
  ✓ 폴더 목록이 온다
  ✓ 안 읽음 기준 줄이 생겼다
  ✓ A 목록에 B 의 1:1 방이 없다 (거부되어야 하는 경우)
  ✓ 로그인 없이 401

[2] 즐겨찾기
  ✓ 전사방 즐겨찾기 켜기 200
  ✓ 목록에 favorite=true
  ✓ 끄면 favorite=false
  ✓ 바꿀 것 없는 요청 400

[3] 폴더
  ✓ 수동 폴더 만들기 201
  ✓ 업무방 넣기 201
  ✓ 내 1:1 방 넣기 201
  ✓ 같은 방 두 번 넣어도 한 줄
  ✓ 목록의 폴더에 두 방
  ✓ 이름 바꾸기 200
  ✓ 빈 이름은 400
  ✓ 21자 이름은 400
  ✓ 순서 바꾸기 200
  ✓ 바뀐 순서로 온다
  ✓ 이름이 다듬어져 저장
  ✓ 빼기 200
  ✓ 빼면 한 방

[4] 추천(규칙) 폴더
  ✓ 「업무방」 추가
  ✓ 두 번째 「업무방」 은 409 (거부되어야 하는 경우)
  ✓ 없는 규칙은 400
  ✓ 규칙 폴더에 방을 직접 넣으면 400

[5] 남의 방 · 남의 폴더 (모두 거부되어야 하는 경우)
  ✓ B 의 1:1 방을 A 폴더에 넣으면 404
  ✓ …없는 방과 같은 답(404)
  ✓ B 의 1:1 방 즐겨찾기 404
  ✓ B 의 1:1 방 읽음 404
  ✓ B 의 방 설정 행이 생기지 않았다
  ✓ B 의 방이 A 폴더에 들어가지 않았다
  ✓ 기준 줄 키 `*` 는 400
  ✓ 모르는 접두사 400
  ✓ A 가 B 폴더 이름 바꾸면 404
  ✓ A 가 B 폴더에 방 넣으면 404
  ✓ A 가 B 폴더 지우면 404
  ✓ A 순서에 B 폴더를 섞으면 400
  ✓ B 폴더는 그대로
  ✓ A 목록에 B 폴더가 없다
  ✓ B 목록에 A 폴더가 없다

[6] 안 읽음
  ✓ 읽은 직후 전사방 0
  ✓ B 가 쓰면 전사방 1
  ✓ 내 글 · 시스템 글 · 지운 글은 늘지 않는다 (거부되어야 하는 경우)
  ✓ 업무 스레드 글 — 업무방 1
  ✓ …전사방도 2(전사방 화면에 같은 글이 보인다)
  ✓ 옴니스 1:1 방 — 옴니스 답은 센다
  ✓ SQL(2) = 규칙 정본(2) — 읽은 뒤 글 5개 중
  ✓ 열면(read) 전사방 0
  ✓ …업무방은 따로라 그대로 1

[7] 검색
  ✓ 슬러그 「에이전트-확인-흐름-점검」 로 그 업무방
  ✓ #슬러그 로도
  ✓ 업무 이름 일부로
  ✓ 마지막 글 미리보기로(「옴니스 답 [시험]」)
  ✓ 방 이름으로 전사방
  ✓ 없는 말은 0건
  ✓ B 의 1:1 방 이름으로 찾아도 안 나온다 (거부되어야 하는 경우)
  ✓ `%` 는 모든 방이 아니라 글자로

전부 통과
```

1 · 2단계 검증도 다시 돌렸다 — `scripts/verify-chat-rooms.ts` 전부 통과(목록 모양 · 1:1 방이 새지 않음), `scripts/verify-omnis-room-http.ts` 전부 통과.

#### 화면 — Playwright 1440 · 375 (dev 3102, 정우창 · 윤훈 세션 쿠키)

시나리오 스크립트는 세션 스크래치에 두었다(저장소에 넣지 않았다). 매번 정우창의 폴더 · 방 설정과 시험 글을 지우고 시작한다. 두 폭 모두 **전부 통과**, 모든 장에서 문서 가로 넘침 0px, 콘솔 오류 0건
(전사방 첨부 미리보기의 「Failed to load resource」 3~5건은 로컬에 NAS 가 없어 나는 것이라 따로 셌다).

```
[375] 1. 칩 전환 — 전체가 한 목록인가
  ✓ 방 종류 칸 제목(h2)이 없다
  ✓ 최근 글 순 (33줄)
  ✓ 옴니스 · 전사방 · 업무방이 한 목록에 섞여 있다
  ✓ 「전체」 칩이 눌려 있다
  ✓ 옴니스 칩 — 업무방 · 전사방이 없다 (2줄)
  ✓ 새로고침해도 마지막 칩(옴니스)을 기억
[375] 2. 즐겨찾기
  ✓ 즐겨찾기 칩에 하드사이언스                    (1440 은 + 우클릭 메뉴에 「즐겨찾기 끄기」)
[375] 3. 폴더 만들기 → 방 넣기 → 칩으로 보기
  ✓ 방 고르기 — 두 방이 체크됨
  ✓ 「견적 모음」 칩에 고른 방 (2줄)
  ✓ 둘 다 빼면 빈 폴더 문구                      (목록의 ⋯ 메뉴로 뺐다)
[375] 4. 추천 폴더 「업무방」 추가
  ✓ 「업무방」 칩은 업무방만 (30줄)
[375] 5. 안읽음 — 다른 사용자가 전사방에 쓰면 배지, 열면 사라짐
    윤훈이 전사방에 보냄: [2b 시험] 안읽음 확인 375px 오전 10:49:17
  ✓ 전사방 줄에 배지 (1)
  ✓ 안읽음 칩에 방 수 배지 (2)
  ✓ 안읽음 칩에 하드사이언스
  ✓ 열고 나면 전사방 배지가 사라졌다
  ✓ 새로고침 뒤에도 — 안읽음 칩에서 전사방이 빠졌다
[375] 6. 검색
  ✓ 「하드」 → 하드사이언스 (1줄)
  ✓ #슬러그 「task-44a5cd4f」 → 업무방
  ✓ Esc 로 검색어를 지운다
[375] 폰 — 칩 줄은 가로로 스크롤, 터치 타깃
    칩 줄 scrollWidth 382 / clientWidth 315
  ✓ 칩 · 줄 · ⋯ · 검색칸 모두 44px 이상
  ✓ 콘솔 오류 없음 (0)
전부 통과
```

5번의 글은 윤훈 계정으로 **전사방 화면의 입력창에서 실제로 보냈다**(dev 서버는 `GEMINI_API_KEY` 를 뺀 채 떠 있어 색인 · 재구성 모델을 부르지 않는다). 「안읽음 칩에 방 수 배지 (2)」 의 나머지 하나는 같은 로컬 DB 에서 10:40 에 옴니스 답이 온 정우창의 1:1 방이다.

첫 375 실행은 **성공 토스트가 화면 위 칩 줄을 덮어** 다음 칩을 누르지 못해 멈췄다. 즐겨찾기 · 폴더 · 순서의 성공 토스트를 걷었다(실패만 토스트).

스크린샷 `mydocs/working/omnis-messenger/` — `{1440,375}-2b-*.png`

| 파일 | 무엇 |
|---|---|
| `*-2b-1-all.png` · `*-2b-1-omnis.png` | 전체(한 목록) · 옴니스 칩 |
| `*-2b-2-row-menu.png` · `*-2b-2-favorite.png` · `1440-2b-2-context-menu.png` | ⋯ 메뉴 · 즐겨찾기 칩 · 우클릭 메뉴 |
| `*-2b-3-manager-empty.png` · `*-2b-3-pick-rooms.png` · `*-2b-3-folder-chip.png` · `*-2b-3-folder-empty.png` | 폴더 관리(빈) · 방 고르기 · 폴더 칩 · 빈 폴더 |
| `*-2b-4-manager-rule.png` · `*-2b-4-rule-folder.png` | 추천 「업무방」 추가됨 · 그 칩 |
| `*-2b-5-unread-badge.png` · `*-2b-5-unread-chip.png` · `*-2b-5-after-open.png` | 배지 · 안읽음 칩 · 연 뒤 |
| `*-2b-6-search.png` · `*-2b-6-search-empty.png` | 검색 · 검색 결과 없음 |

#### 좁은 화면 — `BASE_URL=http://localhost:3102 AUDIT_USER=팀장 AUDIT_PASS=… ROUTES=/chat node scripts/narrow-audit.mjs`

```
✗ 320px /chat   overflow=0 bleed=0 clip=12 ellip=12 tiny=0
✗ 280px /chat   overflow=0 bleed=0 clip=12 ellip=12 tiny=0
✗ 240px /chat   overflow=0 bleed=0 clip=12 ellip=12 tiny=0
✗ 200px /chat   overflow=0 bleed=0 clip=12 ellip=12 tiny=0
잘리거나 넘친 화면: 4 / 4      (exit 1)
```

- **가로 넘침 · 삐져나감 · 44px 미만은 200px 까지 0** 이다
- clip · ellip 12 는 2단계와 같은 수 · 같은 종류다 — 방 이름 · 미리보기 한 줄의 `truncate`(200px 실측 목록: 「옴니스에게 회사 일을 물어보세요」 · 「하드사이언스」 · 업무 이름 · 「보낸 사람: 내용」). 칩 줄은 `overflow-x-auto` 라 잘림으로 잡히지 않는다

### 남은 문제 (2-b)

1. **업무방은 여전히 최근 30개**다. 「업무방」 규칙 폴더도 그 30개(+ 즐겨찾기 · 수동 폴더에 넣은 업무방)만 보인다. 더 오래된 업무방은 검색으로 찾는다(최대 50개)
2. 안 읽은 수는 **목록을 다시 읽을 때(30초 폴링 · 방 화면이 목록을 새로 고칠 때)** 바뀐다. 실시간 푸시는 없다
3. 지금 연 방의 읽음은 목록이 올린다 — 방을 연 채 목록 폴링 사이에 온 글은 떠날 때 읽음 처리된다. 폰에서 대화만 보고 있을 때도 목록 칸은 숨겨진 채 돌아 같은 규칙으로 올린다(목록이 그려지지 않을 뿐 컴포넌트는 떠 있다)
4. 방 키는 FK 가 아니다 — 방 · 업무를 지우면 `ChatRoomPref` · `ChatFolderRoom` 행이 남는다. 목록에는 보이지 않고, 폴더의 「방 N개」 수만 지운 방까지 센다
5. 폴더 순서는 ↑ ↓ 버튼으로만 바꾼다(끌어 놓기 없음). 방 고르기 창은 지금 목록에 있는 방(업무방 30개 + 고정한 것)만 보여 준다
6. 검색은 서버에 한 번 더 묻는다(250ms 기다린 뒤). 마지막 글 미리보기는 서버에서 60자로 자르기 전의 원문으로 거른다 — 화면에 안 보이는 뒷부분의 말로도 걸릴 수 있다
7. 칩 기억은 기기마다 따로다(localStorage). 다른 기기에서는 「전체」 로 시작한다
8. 운영 반영 때 마이그레이션이 하나 늘었다 — 아래 「운영 반영 순서」 1번에 `20261029010000_chat_folders` 를 더했다

## 남은 문제 (1 · 2단계)

1. **방 화면의 404 는 HTTP 200 으로 나간다.** `loading.tsx` 가 스트리밍을 먼저 시작해 `notFound()` 가 상태 코드 대신 본문 표식(`NEXT_HTTP_ERROR_FALLBACK;404`)으로 온다. 남의 방 내용은 내려가지 않는다(HTTP 검증 [2]). 상태 코드까지 404 여야 하면 방 페이지의 `loading.tsx` 를 빼야 한다
2. **재사용한 `ChatPanel` · `TaskThread` 의 44px 미만 터치 타깃**(위 narrow-audit). 오른쪽 패널에서 이미 그랬던 것이고 이번에 고치지 않았다
3. 콘솔 경고 두 가지를 한 번씩 봤다 — 375px 연속 이동 중 「hydrated but some attributes … didn't match」, 1440px 전사방에서 「state update on a component that hasn't mounted yet」. 같은 주소를 새로 열면 다시 나오지 않았다(375px 에서 /tasks · /chat · /chat/new · 전사방 · 업무방 · 옴니스 방을 각 1~2회 새로 열어 0건)
4. 답은 스트리밍하지 않는다 — 실측 7~11초 동안 스켈레톤. 함수 상한 `maxDuration = 60`
5. 방 이름은 첫 질문 앞 30자로 고정이고, 방 이름 바꾸기 · 지우기는 없다. 안 읽은 표시는 2-b 에서 그린다 — `ChatRoomMember.lastReadAt` 이 아니라 `ChatRoomPref`(방 키) 로
6. 문맥에는 앞 대화의 **글**만 들어가고 앞 턴의 도구 결과는 들어가지 않는다. 2턴처럼 앞 답에 슬러그가 있으면 이어지지만, 앞 답에 없던 세부를 물으면 도구를 다시 부른다
7. 전사방을 가운데에 연 채로 오른쪽 패널 「전체」 도 열면 같은 방을 두 곳에서 폴링한다
8. `/omnis/ask` 질문 화면과 `OmnisAsk` 의 dock 변형(이제 쓰는 곳 없음)은 그대로 두었다
9. 작업 중 디스크가 가득 찼다(남은 공간 185MB, `ENOSPC`). 내 `.next/dev/cache` 만 지우고 dev 서버를 다시 띄웠다. 이후 누군가 공간을 비우면서(34GB) `.next` 캐시 파일이 사라져 한 번 더 다시 띄웠다

## 운영 반영 순서 — migrate 먼저, 머지 나중

1. 운영 DB 를 가리키는지 호스트부터 찍고 확인한 뒤 `pnpm run db:deploy` — `20261028010000_chat_room_kinds` · `20261029010000_chat_folders` 둘. 추가만 하는 변경이라 지금 운영 코드는 그대로 돈다
2. 그 다음 머지. 순서는 nav 계획대로 **캘린더(머지됨) → nav(`feat/floating-nav`, 그 아래 `feat/tasks-tab-status`) → 이 브랜치**
3. migrate 전에 이 코드가 나가면: 목록 · 피드 · 지표 · 색인이 `ChatRoom.kind` 를 읽다 오류가 난다(`lib/kpi.ts` 의 raw SQL 포함). kpi-export 를 운영에 돌릴 때도 migrate 뒤에
4. 데모(`omnis`) 프로젝트는 main 빌드가 `prisma migrate deploy` 를 돌려 따로 할 일이 없다
