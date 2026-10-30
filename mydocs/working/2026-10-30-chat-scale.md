---
kind: snapshot
status: active
canonical: mydocs/manual/ux-rules.md
last_verified: 2026-10-30
---

# 메신저 크기 키우기 — 채팅방 목록 약 2배 · 대화 안 Gemini 수준

요청(작업지시자, 2026-10-30): 「채팅 UI 에서 채팅방이 지금 사이즈의 2배가 되어야 돼. 채팅 안에서도 스케일이 더 커져야 돼」. 폰 Gemini 앱 화면(본문 약 17px, 줄간격 넉넉, 큰 둥근 말풍선, 큰 입력창)이 기준.
브랜치 `feat/chat-scale`(origin/main 기준), 워크트리 `../omnis-chat-scale`. 규칙은 [`ux-rules.md`](../manual/ux-rules.md) 「메신저 안의 크기」 에 옮겼다.

## 먼저 알아 둘 것 — 「전」 값은 요청에 적힌 값과 다르다

html 글꼴이 81.25%(13px)라 **rem 유틸리티는 13px 기준**이다. 아래 「전」 은 계산 스타일로 본 실제 값이다.

- `size-8` = 26px(32px 아님), 줄 높이는 `.touch-target` 의 44px 가 바닥이라 46px
- 답 본문 `.omnis-md` 는 `0.875rem` = **11.4px**(14px 아님). 사람 말풍선은 `text-[13.5px]`
- 데스크톱은 여기에 `zoom: 1.1` 이 곱해진다. 폰(< 768px)은 1

그래서 크기는 전부 px 로 썼다.

## 바꾼 크기 (폰 390px 기준, 전 → 후)

### 채팅방 목록 — `components/messenger/room-list.tsx` · `messenger-shell.tsx`

| 항목 | 전 | 후 |
|---|---|---|
| 줄 높이 | 46px | 88px (아이콘 52 + 위아래 18) |
| 방 아이콘 · 아바타 | 26px (글리프 16) | 52px (글리프 26) |
| 제목 | 13px | 16.5px |
| 미리보기 | 11.5px | 14.5px |
| 시간 | 10.5px | 12.5px |
| 안읽음 배지 | h-4 · 10px | 22px · 12px |
| 상태칩(업무방) | 10px | 12px |
| 별 · 알림 꺼짐 종 | 11px | 15px |
| 「새 대화」 줄 | 줄과 같음 | 줄과 같음 (제목 16.5 · 부제 14.5) |
| 로딩 줄(`RowSkeletons`) | 아이콘 26 · 막대 12 · 10 | 아이콘 52 · 막대 17 · 14, 줄 패딩 같음 |
| 칩 | 44px(터치 바닥) · 12px · px-3 | 48px(터치) / 36px(PC) · 14.5px · px-4 |
| 칩 배지 · 폴더 단추 아이콘 · 줄 넘김 ‹ › (PC) | 10px · 14 · 20px | 12px · 18 · 26px |
| 검색칸 | 44px · 12.5px | 50px · 16px |
| 알림 종 원(폰) | 44px | 50px |
| 밀기 칸 글자 · 아이콘 | 11px · 16 | 13.5px · 24 |
| 밀기 칸 폭(왼쪽 셋 · 오른쪽 하나) | 204 · 76 | 276 · 100 |
| FAB | 45px · 글리프 22 | 60px · 글리프 26 |
| FAB 메뉴 | 폭 195px(`w-60`) · 13 / 11px | 폭 234px(`w-72`) · 15.5 / 13px |
| PC 목록 칸 | 280 / 300px (lg) | 340 / 360px |

밀기 칸의 높이는 줄 높이를 따라간다(`SwipeRow` 가 `inset-y-0`).
첫 화면이 덜컥 바뀌지 않게 `RowSkeletons`(목록)와 `RoomSkeleton` · `CachedRoomPreview`(방 열 때)도 같은 크기로 맞췄다.
`app/(main)/chat/loading.tsx` 는 `RoomSkeleton` 을 그대로 쓰므로 따로 고칠 것이 없었다.

### 대화 화면 안

| 항목 | 전 | 후 |
|---|---|---|
| 머리줄 높이 | 36px(`min-h-11`) | 64px |
| 머리줄 제목 · 부제 | 14px · 11.5px | 18px · 13.5px |
| 머리줄 ← · 종 · 검색 | 터치 44px · 아이콘 18 / 15 → 실제 13 | 44~46px · 아이콘 26 / 22 |
| 옴니스 답 본문(`.omnis-md`) | 11.4px · 행간 1.7 | 17px · 행간 1.65 |
| 답 안 제목 h1 · h2 · h3 | 14.6 · 13.7 · 12.7px | 22 · 20 · 18.5px |
| 답 안 표 · 코드 | 본문 상속(11.4px) | 15px · 셀 패딩 0.5em / 0.75em |
| 참고한 자료(접힘 · 줄) | 10.5px · 12px | 13.5px · 14.5px |
| 옴니스 이름 · 시간 | 13px · 11px | 15.5px · 12.5px |
| 옴니스 아바타 | 23px | 38px |
| 내 말풍선(옴니스 방) | 13.5px · 패딩 11×6px · 라운드 2xl | 17px · 18×12px · 24px(꼬리 쪽 lg) |
| 사람 말풍선(전사방 · 단톡방) | 13.5px · 패딩 10×7px · 라운드 2xl | 16.5px · 16×11px · 22px |
| 사람 방 이름 · 시간 · 인용 | 12px · 10.5px · 11px | 14px · 12.5px · 13.5px |
| 사람 방 아바타 | 30px | 42px |
| 말풍선 최대 폭 | 78% | 84% |
| 업무방 본문(`TaskThread`) | 13px · 행간 1.6 | 16.5px · 행간 1.6 |
| 업무방 이름 · 아바타 | 13px · 28px | 15.5px · 40px |
| 업무방 탭(스레드 · 히스토리) | 높이 33px(`h-10`) | 높이 48px · 15.5px |
| 사건 줄(`EventRow`) · 날짜 구분선 | 12px · 11px | 14px · 13px |
| 「도구 N개 사용」 | 11.5px | 14px (펼친 줄 14px · 아이콘 16) |
| 확인 카드(`AgentCard`) 제목 · 대상 · 변경 | 13px · 12.5px · 12.5px | 16.5px · 15px · 15px |
| 확인 카드 단추 | 44px(터치 바닥) · 기본 글자 | 44px · 15px · 폭 84px 이상 · 라운드 xl |
| 업무 생성 카드 | 제목 13px | 제목 16.5px, 나머지 10~11px → 12.5~13.5px |
| 파일 카드 | 아이콘칸 26 · 12.5px | 아이콘칸 44 · 15px |
| 말풍선 옆 답장 · 수정 · 삭제 | 패딩 3px · 아이콘 13 | 패딩 7px · 아이콘 18 |
| 입력창(옴니스 방) 글자 | 14px (폰 16px) | 17px · 행간 26px |
| 입력창(옴니스 방) 높이 · 보내기 단추 | 44px · 44px | 58px 바깥 · 48px 단추 · 라운드 32px |
| 입력창(전사방 · 업무방) 글자 | 16px (PC 11px) | 17px · 높이 48px · 라운드 24px |
| 입력창(전사방 · 업무방) + · 보내기 | 40px(PC 30) · 아이콘 13 | 48px 원 · 아이콘 26 / 24 |
| 입력창 안내문 · 글자수 | 10.5px | 12.5px |
| `/chat/new` 첫 화면 | 제목 18px · 설명 12.5px · 예시 12.5px · 아이콘 칸 39px | 26px · 16px · 16px · 68px |
| 사람과 대화(`PeoplePicker`) | 이름 13px · 아바타 28px · 검색칸 44px(터치) | 16.5px · 44px · 50px |

## 메신저와 오른쪽 패널을 가른 방법

1. `MessengerShell` 루트에 `data-messenger` 를 달았다.
2. 메신저 밖에서도 쓰는 부품은 **기본 클래스를 그대로 두고 `in-data-[messenger]:…` 변형(Tailwind 4.2 `in-*`)으로 큰 크기를 더했다.**
   오른쪽 패널(`MainWithChat` 의 형제) · 업무 상세 · 온보딩 시연은 이 셸 밖이라 변형이 닿지 않는다.
   prop · 컨텍스트로 가르는 방법은 쓰지 않았다 — `ChatPanel → MessageList → …` 로 prop 을 여러 겹 내려야 하고, 서버 첫 화면과 어긋날 일도 없다.
3. 답 본문 마크다운은 `globals.css` 의 `[data-messenger] .omnis-md` 한 곳. 같은 `.omnis-md` 를 쓰는 주간보고 · 지식 카드는 그대로.
4. `AuthorAvatar` 는 인라인 style 이라 변형으로 덮을 수 없다 — `size`(바깥) · `lgSize`(메신저 안)를 CSS 변수 `--av` · `--av-lg` 로 넘기고 클래스가 고른다. 글자 크기도 JS 에서 반올림해 변수로 넘겨 바깥 크기가 1px 도 달라지지 않게 했다.
5. 메신저에만 있는 부품(`RoomList` · `RoomHeader` · `RoomSkeleton` · `CachedRoomPreview`)은 변형 없이 바로 키웠다.
6. CSS `zoom` 은 쓰지 않았다.

밟은 함정 둘(둘 다 `ux-rules.md` 에 적었다):

- `Button` 안 아이콘은 `[&_svg:not([class*='size-'])]:size-4` 가 크기를 정한다. 아이콘에 `in-data-[messenger]:size-[26px]` 를 달았더니 클래스 이름에 `size-` 가 있어 이 규칙이 빠졌고,
  **오른쪽 패널의 입력창 아이콘이 13px → 18px 로 커졌다**(전후 스크린샷 대조에서 잡았다). `h-[Npx]! w-[Npx]!` 로 바꿔 고쳤다.
- 입력칸의 `@media(pointer:coarse)` · `md:` 크기와 `in-data-…` 변형은 순서를 장담할 수 없어 겹치는 속성(`min-h` · `py` · `text` · `leading`)에 `!` 를 붙였다. 검색칸은 `Input` 의 `md:text-sm` 때문에 PC 에서 글자가 안 커져 `md:text-[16px]` 를 같이 줬다.

바뀐 파일: `components/messenger/*`(room-list · messenger-shell · room-header · room-skeleton · cached-room-preview · omnis-room · tool-trail · agent-card · people-picker · new-people-chat),
`components/chat/*`(message-list · message-parts · message-input · thread-composer · chat-panel · chat-search), `components/omnis/omnis-ask.tsx`, `app/(main)/tasks/[taskId]/task-sidebar.tsx`, `app/globals.css`.
`swipe-row.tsx` 는 고치지 않았다 — 칸 폭은 `room-list.tsx` 가 넘기고 높이는 줄을 따라간다.

## 검증

### `pnpm run verify` · 단위 테스트

```
$ pnpm run verify
typecheck: tsc --noEmit — 오류 없음
lint:      ✖ 37 problems (0 errors, 37 warnings)      ← origin/main 에서도 37 warnings(git stash 로 같은 명령 실측)

$ pnpm run test:unit
ℹ tests 180
ℹ pass 180
ℹ fail 0
```

### e2e 셀렉터

`tests/` · `scripts/` 를 `grep` 했다. 크기 · 클래스(`size-`, `text-[`, `h-`)에 기대는 셀렉터는 없고 `nav[aria-label="채팅방"] a` · `[role="group"][aria-label="방 거르기"] button` ·
`[data-slot=…]` · `[data-new-chat-fab]` · `[data-swipe-surface]` 같은 aria · data 속성이다. 고친 것 없음.
`tests/feature/chat-folders.spec.ts` 의 「칩이 줄의 보이는 칸 안에 있다」 는 칸 폭을 상수로 박지 않고 측정한다. 이 세션에서 `pnpm run test:e2e` 는 돌리지 않았다.

### 오른쪽 패널이 그대로인가

PC 1440 에서 `/tasks` 를 열고 패널 「전체」 · 「옴니스」 탭과 `/tasks/<업무>`(TaskThread 업무 상세)를 변경 전(`git stash`)과 변경 후에 캡처해 픽셀 비교했다.

```
panel-all     before/after: 차이 없음 (PIL ImageChops.difference().getbbox() == None)
task-detail   before/after: 차이 없음
panel-omnis   before/after: 눈으로 같음. 픽셀은 차이가 남 — 보내기 단추의 무지개 테두리 애니메이션이 프레임마다 달라서다
```

### 좁은 화면 — `scripts/narrow-audit.mjs` (320 · 280 · 240 · 200px × `/chat` · 옴니스 방 · 전사방 · 업무방 · 단톡방 · `/chat/new`, 24건)

```
              가로 넘침  bleed  44px 미만 터치 타깃(tiny 합계)  말줄임(clip 합계)
변경 전(main)    0        0              69                        90
변경 후          0        0              29                        92
```

가로 넘침 · bleed 는 24건 모두 0. 터치 타깃은 입력창 · 머리줄 단추가 커져 줄었다. 말줄임 +2 는 `/chat/new` 280px(부제 한 줄)와 옴니스 방 320px(머리줄 제목)이고 나머지는 같다.
스크립트 종료 코드는 변경 전 · 후 모두 1 이다 — `clip` 을 실패로 세는데 목록 제목의 말줄임(`truncate`)이 설계상 거기 걸린다.

### 화면 확인

로컬 DB(운영 스냅샷) · `next dev --webpack -p 3117` · 세션 쿠키는 `scripts/agent-cookie.ts`. 글을 보내거나 데이터를 바꾸지 않았다(보기만). 확인한 뒤 서버를 껐다.
Playwright chromium, 폰은 390×844 · 배율 2 · 터치, PC 는 1440×900.

스크린샷 폴더: `/private/tmp/claude-501/-Users-jeong-uchang-work-omnis-local/94daa007-779b-4ee8-9c84-fb288600d17f/scratchpad/chat-scale/`

| 장면 | 변경 후(라이트) | 다크 | 변경 전 |
|---|---|---|---|
| 폰 `/chat` 목록 | `list-390-after.png` | `list-390-after-dark.png` | `list-390-before.png` · 나란히 `list-390-before-after.png` |
| 폰 목록 첫 로딩(스켈레톤) | `list-390-skeleton-after.png` | | |
| 폰 목록 밀기 | `list-swipe-right-after.png`(즐겨찾기 · 알림 · 폴더) · `list-swipe-left-after.png`(삭제) | | |
| 폰 옴니스 방(표 · 도구 기록) | `omnis-table-390-after.png` | `omnis-table-390-after-dark.png` | `omnis-table-390-before.png` |
| 폰 `/chat/new` | `omnis-new-390-after.png` | `omnis-new-390-after-dark.png` | |
| 폰 전사방 | `company-390-after.png` | `company-390-after-dark.png` | `company-390-before.png` |
| 폰 업무방 | `task-390-after.png` | `task-390-after-dark.png` | `task-390-before.png` |
| 폰 단톡방 | `group-390-after.png` | `group-390-after-dark.png` | |
| PC `/chat/<옴니스 방>` | `pc-room-1440-after.png` | `pc-room-1440-after-dark.png` | |
| PC `/chat/default-room` | `pc-company-1440-after.png` | `pc-company-1440-after-dark.png` | |
| PC `/tasks` + 오른쪽 패널 | `pc-panel-tasks-1440-after.png` | `pc-panel-tasks-1440-after-dark.png` | `panel-all-before.png` · `panel-omnis-before.png` · 나란히 `panel-all-sbs.png` · `panel-omnis-sbs.png` |
| 좁은 폭 320 · 200 | `*-320-narrow.png` · `*-200-narrow.png` | | |

## 옴니스 방과 같은 모양 (추가 요청 — 「옴니스랑 사람 간의 채팅이 다르지 않게」)

기준은 옴니스 방. 메신저 안(`data-messenger`)에서만 바뀌고, 오른쪽 패널은 그대로다. 옴니스 답만 말풍선이 없고(#117 결정), 사람 글은 말풍선을 유지한다.

| 항목 | 맞추기 전(사람 방) | 맞춘 뒤 (옴니스 방과 같음) |
|---|---|---|
| 내 말풍선 색 | 진한 파랑(`bg-primary`, 흰 글자) | 옅은 파랑 `bg-primary/10`(다크는 남색), 본문색 글자 |
| 내 말풍선 글자 · 패딩 · 라운드 | 16.5px · 16×11 · 22px | 17px · 18×12 · 24px, 오른쪽 아래만 lg |
| 내 말풍선 최대 폭 | 84% | 85% |
| 내 글 안의 링크 · @ · # 칩 · 파일 카드 | 흰 글자(진한 바탕용) | 파랑 글자 · 옅은 칩 · 테두리 있는 카드(옅은 바탕용) |
| 남의 아바타 | 42px | 38px |
| 남의 이름 | 14px, 옅은 색 | 15.5px, 본문색 |
| 남의 말풍선 글자 · 폭 | 16.5px · 열 폭 84% | 17px · 아바타 옆 남은 폭 전부(`calc(100% - 50px)`) |
| 업무방 본문 · 아바타 · 사건 줄 들여쓰기 | 16.5px · 40px · 52px | 17px · 38px · 50px |
| 입력창 모양 | + · 입력칸(테두리) · 보내기 세 덩어리, 높이 48px | 알약 하나(라운드 32px · 테두리 · 카드 바탕 · 그림자 · 포커스 시 진한 테두리), 폭 최대 760px |
| 입력창 안 | 입력칸에 따로 테두리 | + 는 알약 왼쪽 안 48px 원, 글자 17px 테두리 없음, 보내기 48px 원이 오른쪽 안 |
| 보내기 아이콘 | 종이비행기 | ↑ (옴니스 방과 같은 `ArrowUp01Icon`). 무지개 테두리는 옴니스 방 전용으로 뒀다 |
| 입력줄 바깥 여백 | 14px | 가로 12px(sm 이상 24px) · 위 8 · 아래 12 — 옴니스 방과 같음 |

날짜 구분선(`DayDivider`)과 사건 줄은 두 화면이 이미 같은 컴포넌트를 써서 크기가 같다. 「대화의 시작」 은 사람 방에만 있는 줄이고 날짜 구분선과 같은 13px 로 맞췄다.
입력창의 기능(@ 멘션 · / 명령 · # 업무 · 파일 첨부 · 끌어다 놓기 · 답장 줄)은 DOM 을 옮기지 않고 모양만 바꿔 그대로다. `aria-label`(추가 · 메시지 전송) · placeholder 도 그대로라 e2e 셀렉터(`tests/helpers.ts` · `tests/feature/*` · `scripts/usability-scenarios.mjs`)는 고친 것이 없다. 이번에도 `pnpm run test:e2e` 는 돌리지 않았다.

검증: `pnpm run verify` 타입 통과 · 린트 0 errors / 37 warnings(변경 전과 같음), `pnpm run test:unit` 180건 통과.
오른쪽 패널: 변경 전(main)과 대조 — 「전체」 탭 입력창 구역은 픽셀이 같고, 목록은 스크롤 위치가 실행마다 달라 픽셀이 어긋나지만 크기 · 모양이 같다(`panel-all-sbs.png`). 「옴니스」 탭은 무지개 테두리 프레임 차이 5×5px 뿐. 업무 상세는 픽셀이 같다.

스크린샷(같은 폴더 `scratchpad/chat-scale/`, 390×844): `omnis-390-unified-light.png` · `group-390-unified-light.png` · `company-390-unified-light.png` · `task-390-unified-light.png` 와 `…-unified-dark.png`.
옴니스 방과 단톡방을 나란히 붙인 것: `unified-sbs.png`(라이트) · `unified-sbs-dark.png`. 단톡방 데이터에는 남의 글이 없어 남의 말풍선은 `company-390-unified-*.png`(전사방)에서 본다.

## 남은 것 · 알아 둘 것

- 전사방 · 업무방의 입력창 안내문(`메시지 입력...  / 명령 · @ 사람 · # 업무`)이 폰에서 17px 로 두 줄이 된다. 입력창이 한 줄일 때보다 28px 높다. 글은 `ChatPanel` 이 넘기는 문구라 이번에 건드리지 않았다.
- PC 는 `zoom: 1.1` 이 곱해져 본문이 약 18.7px · 목록 줄이 약 97px 로 보인다. 요청대로 PC 도 같이 키웠다. PC 만 줄이려면 `[data-messenger] .omnis-md` 와 `ROW` 에 `md:` 값을 주면 된다.
- 메신저 안 드롭다운 · 컨텍스트 메뉴 · 다이얼로그(방 메뉴 · 폴더 관리 · 참여자 · 확인 창)는 포털이라 셸 밖이고, 이번 요청 범위도 아니라 크기를 그대로 뒀다.
- 이 세션에서 `pkill -f "next dev"` 로 서버를 끄다가 다른 워크트리(`omnis-ip`, 포트 3010)의 dev 프로세스에도 신호가 갔다. 확인 시점에 3010 은 HTTP 200 으로 살아 있었다. 이후에는 포트 3117 의 PID 만 종료했다.
- `.env` 는 워크트리에 복사해 둔 채다(`cp ~/work/omnis-local/.env .env`, gitignore 대상).
