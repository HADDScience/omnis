---
kind: canonical
status: active
canonical: mydocs/manual/ux-rules.md
last_verified: 2026-09-04
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
- 토큰: `--z-dock: 40` / `--z-banner: 50` / `--z-popover: 60` / `--z-dialog: 100` / `--z-toast: 120`

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

| Viewport | 본문 max-width | Activity Rail | 헤더 |
|----------|---------------|---------------|------|
| `< 768px` (mobile) | `100%` (gutter 16px) | 하단 Sheet (FAB로 토글) | 상단 sticky 컴팩트 1줄 |
| `768~1280px` (tablet) | `100%` | 우측 320px Collapsible (기본 접힘) | 상단 sticky 2줄 |
| `≥ 1280px` (desktop) | `min(768px, 1fr)` | 우측 320px 고정 | 상단 sticky 풀 |

---

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
