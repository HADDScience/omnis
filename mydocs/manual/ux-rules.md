---
kind: canonical
status: active
canonical: mydocs/manual/ux-rules.md
last_verified: 2026-10-29
---

# UX·구조 규칙 — canonical

이 문서가 UX·구조 규칙의 **단일 정본**이다. `CLAUDE.md` 와 `AGENTS.md` 는 여기를 가리키는
포인터이며 규칙 본문을 중복해 싣지 않는다. 규칙을 고칠 때는 여기 한 곳만 고친다.

2026-05-06 Phase 1 확정. 자문(designer-high / frontend-engineer-high / architect /
ui-ux-pro-max / codex-rescue) 다수결에 Codex 적대적 검토(v2~v4)를 반영했다.
각 규칙은 **(R) 리뷰 체크 / (E) 예외 / (S) 적용 범위** 형식이다.

번호는 11 부터 시작한다. 1~10 은 확정 과정에서 기각·통합되어 존재하지 않는다.
기존 리뷰 기록의 번호와 맞추려고 재번호를 매기지 않는다.


### 11. native prompt/confirm/alert 사용 금지
- (R) PR diff에 `window.prompt(`, `window.confirm(`, `window.alert(`이 추가되었는가?
- (E) Storybook/dev-only 디버그 컴포넌트는 허용
- (S) `app/`, `components/` 전체

### 12. 빈 onClick 금지
- (R) `onClick={() => {}}` 또는 핸들러 미연결 button이 있는가?
- (E) `disabled` 상태 + Tooltip("곧 출시")이 있으면 허용
- (S) 모든 button/clickable

### 13. AI ↔ DB Zod SSOT
- (R) AI 응답 파싱·DB write·Form defaultValues가 모두 같은 Zod 스키마 사용?
- (E) 일회성 backfill 스크립트는 inline schema 허용
- (S) `lib/ai.ts`, `app/api/`, 모든 Form

### 14. floating overlay 사분면 충돌 금지 + z-index 토큰화
- (R) 신규 `position: fixed`/`sticky` 컴포넌트가 (a) z 토큰 사용, (b) ChatDock 점유 사분면(우하단) 회피?
- (E) 모달/토스트는 `var(--z-dialog)` / `var(--z-toast)` 토큰 사용
- (S) 모든 fixed/sticky 컴포넌트
- 토큰: `--z-dock: 40` / `--z-nav: 45` / `--z-banner: 50` / `--z-popover: 60` / `--z-dialog: 100` / `--z-toast: 120`

### 15. shadcn primitive 구조 재정의 금지
- (R) DialogHeader/DialogFooter에 `flex-row` 등 layout 변형 클래스 추가?
- (E) 없음
- (S) shadcn 모든 primitive

### 16. 2-column detail = grid + max-w + mx-auto
- (R) 사이드바가 있는 detail 페이지 컨테이너에 `grid-cols-[...] max-w-* mx-auto` 또는 본문에 `mx-auto max-w-* w-full`?
- (E) 모바일(< 768px)에서는 단일 컬럼 + Sheet
- (S) 모든 detail 라우트(`tasks/[id]`, `reports/[id]`, `omnis/[id]`)

### 17. Card 3+ 수직 스택 금지
- (R) 한 화면에 `<Card>` 3개 이상 단순 스택?
- (E) Tabs/Accordion/Collapsible 안에서는 허용
- (S) detail/dashboard 페이지

### 18. 메시지 List는 Composer 동반 필수
- (R) `<MessageList>` 또는 메시지 표시 컴포넌트에 `<MessageComposer>` 형제가 있는가?
- (E) 읽기 전용 archive 뷰는 `readOnly` prop으로 별도 표시 허용
- (S) 모든 ChatMessage 표시 위치

### 19. 동일 도메인 = 단일 카드 컴포넌트의 variant
- (R) Task를 list/board에서 다른 카드로 렌더? `<TaskCard variant="...">` 사용?
- (E) 카드 미리보기 등 차별 목적은 별도 컴포넌트 분리 가능
- (S) Task, Project, OmnisCard 등 도메인 객체

### 20. 상단 Input = 검색 전용
- (R) 페이지 상단 `<Input>` 형태 UI가 검색 외 용도?
- (E) Form 페이지(설정 등)에서는 명확한 label과 함께 허용
- (S) list/grid 페이지 상단 영역

### 21. detail loader는 1-hop 관계 기본 include
- (R) `getXDetail` loader에서 핵심 1-hop (Task→Project→Product, OmnisCard→Category) include?
- (E) 성능 임계 도달 시(P95 > 500ms) split + lazy load
- (S) 모든 detail loader

### 22. schema 필드 삭제 시 5곳 동시 수정 체크리스트
- (R) Prisma + Zod + AI prompt + UI render + Form input 5곳 모두 변경?
- (E) 없음
- (S) `Task`, `OmnisCard` 등 핵심 모델

### 23. schema 변경 시 마이그레이션 + Zod union 동시 작성
- (R) `prisma migrate` 추가 시 같은 PR에 Zod schema 갱신과 백필 스크립트?
- (E) revert-only PR은 면제
- (S) 모든 schema 변경

### 24. AI 분류축은 카드 표면에 시각화
- (R) AI가 자동으로 채우는 필드(`priority`, `category`, `status`)가 list/board 카드에 1개 이상 Badge/Stripe로 노출되는가?
- (E) 데모 모드 압축 뷰는 1개로 축약 가능
- (S) Task/Card 표시 컴포넌트

### 25. 다른 탭 = 다른 컴포넌트
- (R) Tab 라벨이 의미상 다른 데이터·UX를 가리키면 각 탭이 별도 React 컴포넌트인가?
- (E) 데이터 동일·필터만 다른 경우 같은 컴포넌트 + filter prop 허용
- (S) Tabs 사용 모든 위치

### 26. a11y 기본 (ui-ux-pro-max #1)
- (R) interactive 요소가 (a) 키보드 포커스 가능, (b) `aria-label` 또는 텍스트, (c) 4.5:1 대비?
- (E) 장식용 아이콘은 `aria-hidden`
- (E) 화면 확대(핀치·입력창 자동 확대)는 막는다 — 설치한 PWA 가 앱처럼 고정돼야 해서다(작업지시자 결정 2026-10-19).
  큰 글자는 OS 글꼴 크기 설정으로 받는다
- (S) 모든 button/link/input
- 도구: `eslint-plugin-jsx-a11y`, axe-core dev 검증

### 27. loading state 명시
- (R) async 데이터 의존 화면에 (a) Skeleton 또는 Spinner, (b) `isPending`/`isLoading` 분기?
- (E) `<Suspense>` boundary로 위임 시 fallback 컴포넌트 명시
- (S) 모든 fetch/Server Component

### 28. empty state 명시
- (R) 리스트/테이블/그리드에 빈 상태일 때 `<EmptyState>`(아이콘 + 메시지 + CTA)?
- (E) 검색 결과 0건은 search-empty variant 사용
- (S) 모든 데이터 표시 컴포넌트

### 29. error boundary
- (R) Server Action/fetch 실패 시 toast(`sonner`) 또는 inline error message?
- (E) 사용자 액션 외 background sync 실패는 console + 알림 옵션
- (S) 모든 mutation

### 30. mobile fallback 명시
- (R) 새 컴포넌트가 viewport `< 768px`에서 (a) 가로 스크롤 없음, (b) 핵심 액션 도달 가능, (c) 터치 타겟 ≥ 44px?
- (E) 데스크톱 전용 컴포넌트(예: 워크스페이스 캔버스)는 모바일에서 "데스크톱에서 열어보세요" 안내
- (S) 모든 신규 client 컴포넌트

44px 은 **rem 유틸리티로 만들 수 없다.** 루트 글꼴이 81.25% 라 `min-h-11`(2.75rem)은
실제로 35.75px 이다. `globals.css` 의 `.touch-target`(px 고정, `@media (pointer: coarse)`)을
붙인다. 붙인 뒤에는 부모 높이도 같이 봐야 한다 — `h-12` 헤더는 39px 이라 44px 버튼이
들어가지 않는다. 함정 목록: [`../troubleshootings/narrow-viewport-traps.md`](../troubleshootings/narrow-viewport-traps.md)

**(a) 가로 스크롤 없음은 320px 이 아니라 200px 까지 본다.** 시스템 화면 크기 확대와
브라우저 확대가 겹치면 CSS 뷰포트가 거기까지 내려간다.

---

## viewport 책임 표 (Phase 1)

| Viewport | 본문 max-width | Activity Rail | 헤더 | 주 메뉴 |
|----------|---------------|---------------|------|---------|
| `< 768px` (mobile) | `100%` (gutter 16px) | 하단 Sheet (FAB로 토글) | 상단 sticky 컴팩트 1줄 | 하단 떠 있는 nav |
| `768~1280px` (tablet) | `100%` | 우측 320px Collapsible (기본 접힘) | 상단 sticky 2줄 | 상단 가운데 떠 있는 nav |
| `≥ 1280px` (desktop) | `min(768px, 1fr)` | 우측 320px 고정 | 상단 sticky 풀 | 상단 가운데 떠 있는 nav |

---

## 떠 있는 nav (2026-10-28)

사이드바를 걷고 탭 넷(채팅 · 업무 · 캘린더 · 아카이브)을 유리 nav 로 띄웠다. 마이(계정·설정)는 탭이 아니라 아바타 원이다(`MeAvatarLink`) — PC 는 nav 옆, 폰은 하단 nav 의 탭 캡슐 오른쪽(둘 다 「캡슐 + 내 원」).
계획: [`../plans/2026-10-28-floating-nav.md`](../plans/2026-10-28-floating-nav.md)

- 탭 정의는 `components/layout/floating-nav.tsx` 의 `TABS` 한 곳이다. 메뉴를 더하거나 빼면 여기만 고친다
- PC(≥ 768px)는 페이지 제목줄 가운데에 겹쳐 뜨고, 폰은 하단. PC 제목줄(`Header`)은 가운데 `--nav-w` 칸을 비우고
  제목은 왼쪽, 버튼은 오른쪽 칸에 둔다. md 는 아이콘만(16.25rem), lg 부터 글자까지(29.25rem) — 탭 폭을 바꾸면 이 값도 같이 고친다. 두 모양은 **CSS 로만** 가른다 — JS 로 가르면 서버 첫 화면과 어긋난다.
  단 알림 종처럼 두 번 그리면 일을 두 번 하는 것은 `NAV_DESKTOP_QUERY` 로 한 곳에만 그린다
- 생김새는 Linear 의 리퀴드 글래스를 따른다([linear.app/now/linear-liquid-glass](https://linear.app/now/linear-liquid-glass)):
  탭은 캡슐 하나, 알림·마이는 옆에 따로 뜬 원(검색은 nav 에 두지 않는다 — ⌘K 로 연다), 현재 탭은 캡슐 안에서 미끄러지는 한 겹 더 진한 유리(`.glass-pill`),
  누르면 살짝 눌림, 스크롤 끝 가변 블러(`.nav-edge-*`). **굴절은 넣지 않는다** — 밀도 높은 업무 화면을 읽기 어렵게 하고 웹에서는 Chrome 전용이다
- 유리는 `globals.css` 의 `.glass` 유틸과 `--glass-*` 토큰. 블러 바탕 + 위아래 그라데이션 + 가장자리 빛(1px 그라데이션 테두리).
  `backdrop-filter` 미지원 · `prefers-reduced-transparency` 에서는 불투명 판, `prefers-contrast: more` 에서는 불투명 판 + 실선 테두리
- 블러 반경은 애니메이션하지 않는다(폰에서 끊긴다). 세기는 마스크와 투명도로만 바꾼다
- 유리는 크롬(nav · 시트 · 떠 있는 바)에만. 목록 · 카드 · 표는 평면으로 둔다
- 섹션 하위 탭 띠는 `HeaderSubnavProvider` 로 넘기면 `Header` 가 제목줄 바로 아래에 그린다 — 레이아웃이 children 앞에 직접 두면 제목줄보다 위에 붙는다
- **내용이 nav 밑에 깔리지 않게** 하는 일은 셸(`MainWithChat`)이 `--nav-offset-top` / `--nav-offset-bottom` 만큼 비워서 한다.
  화면 높이에 묶인 화면(업무 보드 · 채팅 · 캘린더)은 이 칸 안에서 `h-full` 로 높이를 잰다 — 화면마다 nav 높이를 빼지 않는다.
  화면 전체를 덮는 `fixed` 요소를 새로 만들면 이 두 변수를 직접 뺀다
- 폰 키보드가 올라오면(`visualViewport` 높이가 3/4 미만) 하단 nav 를 내린다
- 폰의 알림 종은 제목줄 오른쪽의 같은 `.glass` 원이다(PC 는 nav 옆). 원 안 버튼이 원을 채워 아이콘이 가운데 온다
- 아이콘만 든 원 · 칩에 `.touch-target` 을 붙이면 칸이 44px 로 커진다 — `justify-center` 가 없으면 아이콘이 왼쪽에 붙는다(2026-10-29 폴더 관리 칩)
- 섹션 안의 하위 이동은 nav 가 아니라 제목줄 아래 띠로 한다 — 아카이브는 `ArchiveNav`(`/omnis` · `/crm` 레이아웃), CRM 은 그 아래 `CrmNav`

---

## 메신저 — 첫 화면 (2026-10-28)

로그인하면 `/` → `/chat`. 왼쪽 방 목록 + 가운데 대화. 계획: [`../plans/2026-10-28-omnis-messenger-agent.md`](../plans/2026-10-28-omnis-messenger-agent.md)

- 방 목록은 사이드바가 아니라 **채팅 화면 안의 왼쪽 칸**(`components/messenger/messenger-shell.tsx`)이다. 방 종류로 칸을 나누지 않고 **최근 글 순 한 목록**을 칩으로 거른다(아래 「목록 칩 · 폴더」). 업무방은 최근 글 순 30개 + 즐겨찾기 · 폴더에 넣은 업무방
- 폰(< 768px)은 목록과 대화 중 하나만 — `/chat` 은 목록, 방 주소는 대화이고 대화 머리 ← 가 목록으로. CSS 로만 가른다
- 주소: 옴니스 1:1 · 전사방 · 사람끼리 방 `/chat/[roomId]`, 업무방 `/chat/task/[taskId]`(표가 없는 가상 방), 옴니스 새 대화 `/chat/new`, 사람과 대화 `/chat/new/people`. nav 채팅 탭은 접두사 `/chat` 으로 켜진다
- 전사방은 오른쪽 패널 「전체」 와 같은 `ChatPanel`, 업무방은 업무 상세와 같은 `TaskThread` 를 그린다 — 따로 만들지 않는다
- 옴니스 답 본문은 `OmnisAnswerBody`(`components/omnis/omnis-ask.tsx`) 하나로 그린다 — 각주 · 표 · 참고 자료가 질문 화면과 같다
- 「새 대화」 는 목록 칸 오른쪽 아래의 유리 FAB(`MessengerShell` `NewChatFab`) — 메뉴 둘(옴니스와 대화 · 사람과 대화). 제목줄에는 두지 않는다(2026-10-29)
- 옴니스 「새 대화」 는 빈 방을 만들지 않는다. 첫 글을 보낼 때 방이 생기고 그 주소로 옮긴다
- 답을 못 받은 내 글(마지막 글이 내 질문)에는 「다시 묻기」 가 붙는다. 새로고침해도 남는다 — 상태가 아니라 방의 글에서 나온다
- 높이는 `MainWithChat` 스크롤 칸 안에서 `h-full`. nav 높이를 화면 안에서 다시 빼지 않는다
- 오른쪽 패널 탭은 「이 업무」 · 「전체」 · 「옴니스」. 옴니스 탭은 예전 Gemini 「Omnis AI」(`OmnisAsk`)가 아니라 에이전트의 옴니스 1:1 방(`PanelOmnis` → `OmnisRoom embedded`)이다 — 쓰기는 방 화면과 같은 확인 카드를 거친다. 아래 「오른쪽 패널」

### 사람끼리 대화 — 1:1 · 단톡방 (2026-10-29, 5단계)

기록: [`../working/2026-10-29-omnis-agent.md`](../working/2026-10-29-omnis-agent.md) 「A 합치기 · 5단계 · 데모 비용」. 서버 `lib/chat-people.ts`, 규칙 `lib/chat-people-rules.ts`.

- 사람 고르기는 `PeoplePicker` 하나 — 「사람과 대화」 와 단톡방 초대가 같이 쓴다. 이름 검색 · 여러 명 · 고른 사람 칩. 나 · 이미 있는 사람은 고를 수 없다
- 1명 → 1:1(방 종류 `DM`). 같은 두 사람의 1:1 은 하나(`dmKey`)라 다시 고르면 그 방이 열린다. 2명 이상 → 단톡방(`GROUP`), 이름은 참여자 이름을 이은 것이 기본이고 고칠 수 있다
- 1:1 은 보는 사람마다 **상대 이름 · 상대 아바타**로 보인다. 초대 · 나가기 · 이름 바꾸기가 없다
- 단톡방은 머리의 참여자 버튼 → 참여자 · 이름 바꾸기 · 초대하기 · 나가기(AlertDialog). 내보내기는 두지 않는다
- 대화 칸은 전사방 `ChatPanel` 의 `people` 모드 — @ 후보는 그 방 참여자, `/업무` · `#업무` · 첨부는 끈다. **`MessageInput` 에 빈 목록을 넘길 때는 모듈 상수를 넘긴다** — 기본값 `[]` 는 그릴 때마다 새 배열이라 후보 effect 가 무한 갱신을 냈다
- 옴니스는 이 방들에 들어가지 않는다. **이 방들의 글은 참여자만 본다 — 사내 지식 색인 · 피드 · 기록 제안 · 업무에 붙지 않는다.** 방을 가리지 않고 글을 모으는 새 코드는 `PUBLIC_MESSAGE_WHERE`(전사방만)를 붙인다
- 멘션 알림은 `@이름` 이 그 방 참여자일 때만 간다

### 목록 칩 · 폴더 · 검색 (2026-10-29)

카톡의 목록 칩 · 채팅방 폴더를 Omnis 부품으로 옮겼다. 규칙(순수 함수)은 `lib/chat-list.ts` 한 곳, 화면은 `components/messenger/room-list.tsx` · `folder-manager.tsx`.
기록: [`../working/2026-10-28-omnis-messenger.md`](../working/2026-10-28-omnis-messenger.md) 「2-b」

- 목록 위는 **검색칸 한 줄 → 칩 한 줄**. 검색칸은 검색 전용이다(규칙 20)
- 칩 순서: 고정 칩 **전체 · 옴니스 · 안읽음 · 즐겨찾기**(지울 수 없고 순서도 고정) → 내 폴더(내가 정한 순서) → 맨 끝 폴더 관리 버튼.
  칩이 넘치면 줄만 가로로 스크롤한다(스크롤바 숨김). 폴더 관리 버튼은 **스크롤 밖**에 두어 칩이 많아도 늘 보인다
- **스크롤바를 숨긴 줄은 넘친 것을 따로 알린다** — 넘친 쪽 끝을 흐리게(mask) 하고, PC 에서는 그 끝에 ‹ › 버튼, 세로 휠도 가로로 민다.
  이게 없으면 줄 밖에 그려진 칩은 PC 에서 영영 보이지 않는다(2026-10-29 「폴더를 만들었는데 칩이 없다」 제보의 원인).
  새로 만든 폴더의 칩은 **바로 고르고** 줄을 밀어 보이게 한다 — 시험은 「DOM 에 있다」 가 아니라 「줄의 보이는 칸 안에 있다」 로 본다(`tests/feature/chat-folders.spec.ts`)
- 「전체」 는 방 종류를 섞은 최근 글 순 한 목록이다. **전사방도 다른 방과 똑같이** 섞이고 맨 위에 고정하지 않는다(위에 두려면 즐겨찾기). 「새 대화」 줄은 전체 · 옴니스 칩 맨 위에만
- 「안읽음」 칩 배지는 **안 읽은 글이 있는 방의 수**, 방 줄 배지는 **그 방의 안 읽은 글 수**. 100 부터 「99+」
- 마지막으로 고른 칩은 사람마다 `localStorage`(`omnis.chat.chip.<userId>`)에 둔다. 지운 폴더의 칩이면 「전체」 로 돌아간다
- **폴더 = 내가 고른 방들을 묶는 상자.** 하나뿐인 방(전사방)은 폴더가 될 수 없다. 폴더는 **개인 설정**이다
  - **직접 만든 폴더**에는 어느 종류의 방이든 섞어 넣는다 — 옴니스 대화 · 업무방 · 단톡방 · 전사방(예: 「상표」 에 상표 업무방과 상표 관련 옴니스 대화)
  - **추천 폴더는 규칙 폴더**라 규칙으로만 채운다. 방을 손으로 넣거나 빼는 메뉴를 두지 않고 API 도 400 이다
    - 「내 업무」 — 내가 담당이거나 지시한 업무의 업무방(업무 탭 i-own · i-assigned 와 같은 기준). 하나만
    - 「프로젝트 폴더 추가」 — 프로젝트를 골라 그 프로젝트의 업무방을 모은다. 프로젝트마다 하나, 이름은 프로젝트 이름(20자)으로 시작하고 바꿀 수 있다
  - 처음 둔 추천 폴더(전사방 · 업무방 · 단톡방, 방 종류 규칙)는 없앴다. 그 행은 지우지 않고 **숨긴다** — 목록 · 칩 · 순서 · 한도 · 이름 바꾸기 · 지우기가 모두 없는 폴더로 본다
- 방 하나의 메뉴(즐겨찾기 · 직접 만든 폴더에 넣기/빼기 · 규칙 폴더는 「자동」 표시만 · 지우기)는 **꾹 누르기 · 우클릭 · 메뉴 키(Shift+F10)** 가 같은 항목을 연다(`RoomMenuBody`). 줄 끝 ⋯ 는 없앴다(2026-10-29) — 아래 「밀기 · 꾹 누르기」
- 폴더 지우기는 창을 띄우지 않고 그 줄에서 한 번 더 묻는다(규칙 11). 지워도 안의 방은 그대로다
- 즐겨찾기 · 폴더 · 순서를 바꿔도 **성공 토스트를 띄우지 않는다** — 바뀐 것이 그 자리에 보이고, 폰에서는 위에 뜬 토스트가 칩 줄을 가려 다음 칩을 누를 수 없었다. 실패만 토스트
- 검색은 **고른 칩과 상관없이 전체에서** 찾는다(검색 중 칩 줄은 옅게, 「전체에서 찾은 방 N개」). 방 이름 · 업무 이름 · 슬러그(`#` 붙여도) · 마지막 글 미리보기(보낸 사람 포함). Esc 로 지운다
- 지금 연 방은 열 때 · 떠날 때 · 목록이 그 방의 새 글을 셀 때 읽음으로 올린다. 대화 칸을 건드리지 않고 목록이 주소(`roomKeyFromPath`)로 안다

### 밀기 · 꾹 누르기 · FAB · 입력 · 기기 저장 (2026-10-29, 작업지시자 사용 뒤)

기록: [`../working/2026-10-29-omnis-agent.md`](../working/2026-10-29-omnis-agent.md) 「사용성 수정(작업지시자 확인 뒤)」. 화면 확인 `scripts/usability-scenarios.mjs`.

**밀기(`components/messenger/swipe-row.tsx`)** — 카톡 채팅 목록과 같다

- 오른쪽→왼쪽 = 지우기 칸, 왼쪽→오른쪽 = 즐겨찾기 · 알림 · 폴더 칸. 칸의 단추를 눌러야 실행된다(밀기만으로 지우지 않는다)
- **알림 끄기 / 켜기**(2026-10-29) — 방 키 단위 `ChatRoomPref.muted`. 밀기 칸 · 꾹 누르기 메뉴 · 방 머리줄(네 종류 방 모두)이 같은 API 를 쓴다.
  꺼진 방은 목록 줄(이름 옆)과 머리줄에 빗금 종으로 보인다. 끄면 그 방의 채팅 푸시만 멈춘다 — 멘션 푸시 · 안읽음 배지는 그대로.
  받는 사람 규칙: [`../plans/2026-10-29-push-notifications.md`](../plans/2026-10-29-push-notifications.md)
- 지우기는 방 종류마다 뜻이 다르다 — 정본은 `lib/chat-list.ts` `roomRemoval`
  | 방 | 오른쪽→왼쪽 | 무엇이 남나 |
  |---|---|---|
  | 옴니스 1:1 | 삭제 — `ChatRoomPref.hiddenAt` | 글 · `AgentRun` · `AiUsage` 는 DB 에 남는다. 내 목록 · 방 주소 · 방 API 에서는 없는 방(404) |
  | 사람 1:1 | 숨기기 — `hiddenAt` | 숨긴 뒤 새 글이 오면 다시 보인다. 같은 사람을 「사람과 대화」 로 다시 고르면 풀린다 |
  | 단톡방 | 나가기 — 참여자 행 삭제(기존) | 남은 사람의 대화 |
  | 전사방 · 업무방 | 없음 — 밀어도 칸이 없다. 숨김 API 400 | — |
- 누르면 AlertDialog 로 한 번 묻는다(규칙 11). 성공 토스트는 띄우지 않는다
- 터치 · 마우스 모두 pointer 이벤트. 세로 스크롤은 브라우저에 맡기고(`touch-action: pan-y`) **가로가 세로의 1.4배 넘게 우세할 때만** 줄을 잡는다
- 민 끝의 클릭은 버린다 — 손을 뗀 자리가 링크라 방이 열렸다. 열린 줄은 하나, 열린 줄을 누르면 닫기만 한다
- 밀기 칸의 단추는 키보드 초점에 넣지 않는다(`tabIndex=-1`) — 키보드는 메뉴로 같은 동작을 한다

**꾹 누르기** — base-ui `ContextMenu` 가 터치에서 0.5초로 연다(10px 넘게 움직이면 취소 — 밀기와 다투지 않는다). PC 는 우클릭, 키보드는 메뉴 키 · Shift+F10(브라우저가 contextmenu 를 안 낼 때를 위해 줄이 직접 연다)

**FAB** — 떠 있는 동작 단추는 nav 와 같은 `.glass` 원. 화면 높이에 묶인 칸 안에 `absolute` 로 두면 셸이 비운 `--nav-offset-bottom` 위에 뜬다. 그 칸의 스크롤 끝에 단추 높이만큼 여백(`pb-20`)을 준다. `.glass` 가 `position: relative` 를 넣으므로 자리 유틸은 `!`(`absolute!` · `fixed!`)로 이긴다

**입력칸**
- 한 줄일 때 글자와 보내기 단추의 세로 가운데가 같아야 한다 — 입력칸 최소 높이 = 단추 높이, 남는 높이는 위아래 여백. 높이는 px(rem 은 81.25% 배율을 탄다). 여러 줄로 늘면 단추는 아래(`items-end`)에 붙는다
- Enter: PC(물리 키보드) 보내기 · Shift+Enter 줄바꿈. 폰(`(pointer: coarse)`)은 Enter 가 줄바꿈이고 보내기는 단추로만. 한글 조합 중(isComposing · keyCode 229)의 Enter 는 어디서도 보내거나 후보를 고르지 않는다 — `lib/enter-to-send.ts` 하나로 판정한다
- 보내기 · [확인] 은 ref 로 잠근다 — 상태는 다음 그리기에야 보여 같은 순간 두 번 누르면 둘 다 지나간다

**누르는 즉시 반응**
- 링크는 `LinkPendingMark` 로 누른 자리에 표시를 남긴다(방 줄 · nav 탭 · 마이 원). 코드로 옮기는 곳(`router.push`)은 메뉴가 열리거나 손가락이 닿을 때 `router.prefetch`
- 옴니스 방 글은 30개씩(`OMNIS_PAGE_SIZE`), 위로 올리면 더. 다시 읽을 때 올려 받은 앞 글을 버리지 않는다(`mergeLatest`)

**기기 저장(오프라인 캐시, `lib/chat-cache.ts`)** — 회사 데이터가 기기에 남는다. 범위를 늘리면 여기부터 고친다
- 담는 것: 방 목록 한 벌, 최근에 연 방 **40개**의 최근 글 **30개**(본문 · 보낸 사람 이름 · 시각). 업무방(TaskThread) · 첨부 본문 · 확인 카드 · 도구 기록은 담지 않는다
- IndexedDB `omnis-chat-cache`, 키는 `<userId>:…`. 다른 사람이 이 기기로 로그인하면 앞 사람 것을 통째로 지우고, 로그아웃(마이 → 로그아웃)하면 지운다
- 그리는 법: 목록은 저장본으로 먼저 그리고 서버 응답으로 갈아 끼운다. 방을 누르면 `loading.tsx` 가 저장본을 먼저 그린다(`CachedRoomPreview`, 읽기 전용) — 서버 화면이 오면 바뀐다
- IndexedDB 를 못 쓰면 아무것도 하지 않는다 — 화면은 서버만으로 돈다

### 오른쪽 패널 (2026-10-29)

- 여는 길: 오른쪽 아래 둥근 유리 단추(`PanelDock`, 규칙 14 의 독 사분면) · C 키 · ⌘⇧F(전체 검색) · `?taskId=` 링크 · 온보딩 「대화 패널」 장면. **제목줄의 「채팅 열기」 는 지웠다** — 지우고 단추를 두지 않으면 폰에서는 열 길이 없다
- 단추는 폰 채팅 화면(`/chat…`)에서 그리지 않는다(FAB · 입력칸 자리). PC 채팅 화면에서는 입력칸 위(`bottom: 96px`)로 올린다
- 업무 상세에서 열면 「이 업무」 가 먼저. 모양은 화면 가장자리에서 띄운 둥근 판(`.glass`), 탭은 캡슐 + 현재 탭만 `.glass-pill`. 속은 불투명 바탕(유리는 크롬에만)
- 「옴니스」 탭은 내 최근 옴니스 방을 이어 쓰거나 새로 연다. 「크게 보기」 → `/chat/<방>`. 패널에서 새 방이 생겨도 지금 화면 주소는 바꾸지 않는다

## 채팅 메시지 목록 (2026-09-15, PR #15 · #16)

채팅 패널과 업무 스레드가 같은 규칙을 쓴다. 배치 규칙은 `lib/chat-layout.ts`(순수 함수), 조각은 `components/chat/message-parts.tsx`.
새 메시지 표시 위치를 만들면 이 둘을 가져다 쓴다 — 따로 그리면 두 화면이 다시 어긋난다.

| 규칙 | 어떻게 | 왜 |
|---|---|---|
| 이어 보낸 글 묶기 | 같은 사람 · 같은 날 · **묶음 첫 메시지부터 5분**(`GROUP_WINDOW_MS`) 안이면 이름 · 아바타 한 번 | 직전 메시지 기준이면 묶음이 끝없이 길어진다 |
| 날짜 구분선 | 날이 바뀔 때 `DayDivider` 한 줄 — 「오늘」 · 「어제」 · 「9월 14일 (월)」, 해가 다르면 연도를 붙인다 | 줄마다 날짜를 쓰지 않는다 |
| 시간 | 짧게 「오후 2:08」, 전체 시각은 `title`(hover). `tabular-nums` 로 맞추고 **고정폭 글꼴을 쓰지 않는다** | 고정폭 글꼴은 한글 본문 옆에서 튄다 |
| 사건 | 업무 생성 · 재구성 · 완료 · 완료 확인 대기(`MessageKind`)는 `EventRow` 옅은 한 줄. 사람 메시지처럼 그리지 않는다 | 사건이 대화처럼 보였다 |
| 아바타 | 이름으로 정한 색(`avatarTone`, FNV-1a) · 한글 이름은 성을 뺀 두 글자 | `h*31+c` 는 한글에서 색이 한쪽으로 몰렸다 |
| 나란한 칸의 단위 | 아바타와 묶음 안 줄의 여백 칸은 **둘 다 px** | html 배율 아래서 rem 과 px 가 달라져 본문이 5px 어긋났다 |
| 본문 | `break-keep`(keep-all) · 행간 1.6 · `tidyBody` 로 빈 줄 여러 개를 하나로 · `[overflow-wrap:anywhere]` | 한글은 어절 단위로 끊는다 |
| 첨부 · 멘션 | 파일은 형식 카드(`MessageFiles`, 「PPT · 105KB」), `@사람` · `#업무` 는 칩(`MessageContent`) | 이름 · 크기 글자만으로는 파일인지 안 보였다 |
| 목록 | `role="log"` | 새 줄을 스크린리더가 읽는다 |

보내기 효과:

- 새로 들어온 줄에만 `MESSAGE_ENTER`(아래에서 떠오르며 나타남). 처음 불러온 줄 · 이전 메시지는 움직이지 않고, `motion-reduce` 면 멈춘다.
- 보내는 중인 글은 즉시 옅게 「보내는 중…」 으로 보인다. 서버 응답이 오면 그 자리에서 확정하고 `_settled` 를 붙여 **다시 떠오르지 않게** 한다.
- AI 재구성은 응답 뒤에 돈다. 스레드는 「옴니스가 업무를 갱신하고 있어요」 한 줄만 두고 입력창을 막지 않는다 — [tech/chat-post.md](../tech/chat-post.md).

고치기 · 지우기 · 답장 (2026-09-16):

- **내가 쓴 `NORMAL` 글만** 고치고 지운다. 🤖 시스템 글 · 업무 카드(`__TASK_CREATED__`)는 대상이 아니다 —
  화면은 버튼을 두지 않고, 서버(`/api/chat/messages/[messageId]`)도 403 으로 막는다.
- 고치기는 **말풍선 자리에서** 한다(Enter 저장 · Esc 취소). 창을 띄우면 앞뒤 대화가 가려진다.
- 고친 글은 시간 옆에 「수정됨」. 원문은 두지 않는다 — 이력 보기는 만들지 않았다.
- 지운 글은 **자리를 남기고** 「삭제된 메시지입니다」(`CHAT_DELETED_TEXT`) 한 줄. 본문 · 첨부는 API 가 내려보내지 않고,
  행은 DB 에 남는다 — 답장이 가리키는 글 · 업무 연결 · 색인이 함께 사라지지 않게.
- 답장은 입력창 위 한 줄로 대상을 물고 보내면 비운다. 받은 글에는 인용 한 줄(작성자 · 앞 80자)을 말풍선 위에 붙인다.
- 업무에 붙은 글을 고치거나 지우면 **재구성을 다시 돌린다.** 기준 시각은 원글이 아니라 **지금**이다 —
  원글 시각을 쓰면 그 뒤에 온 글 때문에 곧바로 `superseded` 로 버려진다.

검색 (2026-10-06, 카톡 PC 검색을 따랐다):

- 패널 머리 🔍 또는 **⌘⇧F**(Ctrl+Shift+F) → 목록 위에 **검색 줄 한 줄**(`components/chat/chat-search.tsx`). 대화와 입력창을 덮지 않는다.
  업무 필터 중이면 그 업무 안에서만 찾는다. 「전체」 탭에만 있다(「이 업무」 탭은 `TaskThread` 라 다른 컴포넌트다)
- 검색하면 가장 최근 결과로 바로 간다. ▲(Enter) 더 옛 결과 · ▼(Shift+Enter) 더 최근 결과 · `3/120`. 📅 그날 첫 메시지로 · 👤 보낸 사람으로 거르기(검색어 없이도)
- 걸린 글자는 **CSS Custom Highlight**(`::highlight(chat-search-hit)` · `chat-search-current`)로 표시한다. 렌더를 쪼개지 않아 링크 · 칩 안 글자도 표시된다.
  지금 결과는 걸린 **글자**를 가운데로 가져온다 — 긴 글에서 말풍선 가운데는 걸린 자리가 아니다. 글자가 없는 이동(날짜 · 사람만)은 말풍선을 2초 강조
- 단축키는 입력칸 안에서도 받는다 — 패널이 닫혀 있거나 다른 탭이면 열고 「전체」 로 옮긴다. 다시 누르면 검색칸을 고르고 글자를 전부 선택한다
- **한 글자부터** 찾는다 — 「넵」 같은 짧은 답장을 찾는 일이 많다(2026-10-06)
- 글자 포함(ILIKE). `to_tsvector('simple')` 은 한국어를 어절째로 잘라 「견적」 으로 「견적서」 를 못 찾는다.
  **Prisma 의 `contains` 는 `%` · `_` 를 이스케이프하지 않는다** — 직접 이스케이프해 넘긴다(안 하면 「__」 가 모든 글에 걸린다)
- 결과로 갈 때 **그 글 앞뒤 15건만** 불러와 목록을 갈아 끼운다(「점프 보기」) — 방 전체가 1만 건을 넘어 사이를 다 불러올 수 없다.
  이미 불러온 자리 안의 결과면 다시 받지 않는다. 점프 보기 동안 폴링을 멈추고, 아래로 스크롤하면 30건씩 이어 붙이다 따라잡으면 평소 목록으로 돌아간다.
  검색 줄을 닫거나 글을 보내면 최신 목록으로 돌아간다

## 화면 배율과 떠 있는 창 (PR #12)

- `html` 에 `zoom: var(--ui-zoom)`(데스크톱 1.1, md 미만 1)을 건다. 배율은 `globals.css` 의 `--ui-zoom` 한 곳에서만 바꾼다.
- 화면을 꽉 채우는 셸은 `100svh`/`100vw` 가 아니라 `--app-vh`/`--app-vw` 를 쓴다. `100svh` 는 zoom 을 몰라 zoom 배만큼 길어진다.
- base-ui(floating-ui) 떠 있는 창은 `globals.css` 가 위치 칸에 `scale: 1/zoom`, 안의 창에 `zoom` 을 다시 건다 —
  팝오버 · 드롭다운 · 컨텍스트 메뉴 · 호버카드 · 툴팁 · 콤보박스 · 내비 메뉴. **셀렉트는 빼 둔다**(항목을 트리거에 겹쳐 놓는 방식이라 원래 맞다).
- 새 떠 있는 컴포넌트를 들이면 목록에 `data-slot` 을 더하고 1920 · 1440 · 1024 · 390px 에서 트리거와 창의 x 차이를 잰다.

## 마크다운 본문 (PR #8)

- AI 답변 · 주간보고 · 지식 카드 같은 마크다운은 `.omnis-md`(`globals.css`, components 레이어)로 그린다.
- **`prose` 를 쓰지 않는다.** `@tailwindcss/typography` 가 설치돼 있지 않아 오류 없이 아무 효과가 없다.
- 플러그인이 필요한 유틸리티는 `package.json` 부터 보고, 먹는지는 브라우저 계산 스타일로 확인한다.

---

## 시연 데모 환경 (NEXT_PUBLIC_IS_DEMO)

`omnis-omega.vercel.app` 배포에서만 활성화. **코드는 운영과 같은 main, 데이터는 데모 DB** — 작업지시자 결정(2026-09-14).

| 무엇 | 운영 (`omnis-hadd`) | 데모 (`omnis`) |
|---|---|---|
| 코드 | main | main (같은 커밋) |
| DB | 운영 Neon | 데모 Neon — `prisma/demo-seed.ts` 익명 더미 |
| NAS 파일 | 있음 | 없음 — 업로드·다운로드 UI 숨김, API 403 (`lib/demo.ts`) |
| Gemini 일일 한도 | 기본 500회·100만 토큰 | `GEMINI_DAILY_CALL_LIMIT` · `GEMINI_DAILY_TOKEN_LIMIT` 로 낮춘다 |

- 데모 배너: `<DemoBanner />` 상단 alert + dismiss + cookie 7일 (`omnis_demo_banner_dismissed`)
- 새 기능이 NAS 를 쓰면 `IS_DEMO` 로 UI 를 숨기고 API 에 `demoStorageBlocked()` 를 둔다
- 새 화면에 데이터가 필요하면 `prisma/demo-seed.ts` 에 가상 데이터를 더한다. 실제 회사 데이터·서명은 넣지 않는다
- 데모 시드는 전 테이블을 비운다. 로컬이 아니면 `DEMO_SEED_ALLOW=1` 없이는 멈추고, 서명·직인 행이 있는 DB(운영)에서도 멈춘다
- 스키마가 바뀌면 데모 DB 에도 `prisma migrate deploy` 가 필요하다
