---
kind: decision
status: active
canonical: mydocs/plans/2026-10-28-floating-nav.md
last_verified: 2026-10-28
---

# 사이드바를 없애고 떠 있는 유리 nav 로 — 탭 5개

상태: 2026-10-28 작업지시자 승인. 「정해야 할 것」 은 추천안으로 진행한다 — 마이페이지는 `/settings` 를 넓히고, 채팅 화면이 오기 전 채팅 탭은 오른쪽 채팅 패널을 연다.

## Context

Omnis 의 첫 화면이 「옴니스와의 대화(메신저)」로 바뀐다. 이 작업은 다른 세션이 하고 있다
(`docs/omnis-chat-home-plan` · `mydocs/plans/2026-10-28-omnis-messenger-agent.md`).
지금의 왼쪽 사이드바는 메뉴 6개, 빠른 필터 4개, AI 질문, 검색, 앱 설치 카드, 프로필 메뉴를 한 칸에 쌓아 두었다.
첫 화면이 대화가 되면 사이드바는 화면 폭만 차지한다. 그래서 다음처럼 바꾼다.

- 탭을 **5개**로 줄인다: **채팅 · 업무 · 캘린더 · 아카이브 · 마이페이지**
- 사이드바를 없애고 **글래스모피즘 nav** 를 화면 위에 띄운다. PC 는 상단 가운데, 폰은 하단
- 범위: **nav 와 셸만.**
  - 채팅(홈) 화면은 다른 세션 몫이다. 여기서는 `/` 로 가는 탭 자리만 잡는다
  - 캘린더 화면은 `feat/calendar-works-sync`(`/calendar`, 아직 머지 전) 몫이다. 여기서는 탭만 연결한다

## 작업지시자가 정한 것 (2026-10-28)

| 항목 | 결정 |
|---|---|
| 탭 | **채팅**(= 홈, `/`) · **업무**(`/tasks`) · **캘린더**(`/calendar`) · **아카이브** · **마이페이지** |
| 아카이브 | HADD DB(지식 카드 · 시놀로지 NAS) + 지식재산권(안으로 옮김) + 고객·견적 |
| 보고서 | 안 쓴다. nav 에서 뺀다 |
| 위치 | PC 상단 · 폰 하단 |
| 범위 | nav · 셸만. 채팅 · 캘린더 화면은 각 세션 몫 |

탭이 5개라 폰 하단 nav 는 칸마다 **최소 폭 = (화면폭 − 여백) / 5** 다.
- 360px 에서 칸이 약 64px 라 아이콘 + 두~세 글자 라벨이 들어간다(「아카이브」 네 글자는 11px 로 실측한다)
- 320px 이하에서는 라벨을 숨기고 아이콘만 둔다
- 200px 에서는 아이콘 5개 × 44px = 220px 라 **넘친다.** 이 폭에서는 nav 안을 가로 스크롤로 둔다(규칙 30 은 페이지 가로 스크롤 금지이므로 nav 내부 스크롤은 허용 범위인지 같이 확인한다)

## 지금 사이드바가 하는 일 → 옮길 곳

`components/layout/app-sidebar.tsx`, `app/(main)/layout.tsx`(SidebarProvider)

| 지금 (사이드바) | 옮길 곳 |
|---|---|
| 로고 → `/tasks` | nav 왼쪽 끝(PC). 폰은 생략 |
| 「Omnis AI 에게 질문」 (`rightPanel.openWith("ai")`) | **홈**이 대신한다. 홈이 들어오기 전까지는 헤더의 `RightPanelTrigger` 로 그대로 연다 |
| 검색 ⌘K (`commandPalette.open()`) | nav 오른쪽 아이콘(PC). 폰은 마이페이지 안. 단축키 ⌘K 는 그대로 |
| 메뉴: 업무 · HADD DB · 지식재산권 · 고객·견적 · 보고서 (+ 캘린더 브랜치가 더한 캘린더) | 탭 5개. 보고서는 뺀다(`/reports` 라우트는 남김 — MCP 주간보고가 쓴다) |
| 빠른 필터: 오늘 마감 · 내가 지시 · 내가 담당 · 주간보고 | 업무 탭 툴바의 필터 메뉴(드롭다운)로. `?filter=` 는 그대로 |
| 앱 설치 카드 (`InstallAppCard`) | 마이페이지 |
| 프로필 메뉴: MCP 등록 · 온보딩 · 프로필 · 팀/알림 설정 · 테마 · 로그아웃 | **마이페이지** 한 화면 |
| 알림 종 (`NotificationBell`, 지금은 페이지 `Header` 안) | PC: nav 오른쪽. 폰: 페이지 `Header` 에 그대로 |

## nav 설계

### 모양

```
PC (≥ md)                       상단 가운데, 위에서 12px 떠 있음
 ┌──────────────────────────────────────────────────────────┐
 │ ◉ Omnis │ 채팅  업무  캘린더  아카이브  마이 │  ⌕  🔔  (정)   │  ← 유리 알약
 └──────────────────────────────────────────────────────────┘

폰 (< md)                       하단 가운데, safe-area 위로 띄움
 ┌─────────────────────────────────────┐
 │  💬     ☑      📅      ▤      ☺     │   아이콘 + 작은 라벨, 칸마다 44px 이상
 │ 채팅   업무   캘린더  아카이브  마이  │
 └─────────────────────────────────────┘
```

- 현재 탭은 알약 안의 **움직이는 하이라이트**(유리 위 진한 유리)로 보인다. `prefers-reduced-motion` 이면 움직임 없이 바뀐다
- 탭 활성 판정은 경로 접두사로 한다
  - 채팅: `/` (홈이 없는 동안 `/` 는 `/tasks` 로 가니 활성으로 보일 일이 없다) · 홈 세션이 방 경로를 만들면 그 접두사도
  - 업무: `/tasks`
  - 캘린더: `/calendar`
  - 아카이브: `/omnis` `/nas` `/crm` (지식재산권을 들이면 `/ip`)
  - 마이: `/settings`, `/me`
- 업무 탭에는 **안 읽은 지시 · 확인 대기 수 배지**를, 채팅 탭에는 **안 읽은 메시지 점**을 둘 수 있게 탭 정의에 `badge` 칸을 비워 둔다. 값은 지금 `NotificationBell` 이 읽는 것을 쓴다. 1차에는 비워 둔다

### 유리 효과

토큰은 `globals.css` 에 `--glass-*` 로 한 곳에 둔다.

- 배경 `color-mix(in oklab, var(--background) 60%, transparent)`, `backdrop-filter: blur(20px) saturate(160%)`
- 1px 안쪽 밝은 테두리, 그 아래 부드러운 그림자. 라이트와 다크에 값을 따로 둔다
- **대비 4.5:1(규칙 26)**: 유리 아래로 흰 카드와 진한 보드가 번갈아 지나간다. 라벨 글자색을 실측해서 정하고, 모자라면 불투명도를 올린다
- **대체 경로**: `@supports not (backdrop-filter: …)` 이거나 `prefers-reduced-transparency: reduce` 이면 불투명 배경을 쓴다
- z 토큰(규칙 14): 새 `--z-nav: 45` 를 dock(40)과 banner(50) 사이에 둔다. 오른쪽 채팅 패널(banner)이 열리면 패널이 nav 를 덮는다

### 화면 배율 · 겹침 (ux-rules 「화면 배율과 떠 있는 창」 · 규칙 14 · 30)

- `fixed` 셸은 `--app-vh`/`--app-vw` 기준으로 둔다. 데스크톱 `zoom 1.1` 에서 위치를 1920 · 1440 · 1024 · 390px 로 실측한다
- **내용이 nav 밑에 깔리지 않게** 한다. `MainWithChat` 의 스크롤 영역에 PC 는 위쪽, 폰은 아래쪽 여백을 nav 높이(+ safe-area)만큼 둔다
  - 업무 보드는 화면 높이에 묶여 있다(`tasks/page.tsx` 주석). 그래서 여백은 보드 안쪽이 아니라 셸 쪽에서 준다
- 폰 하단 nav 와 겹칠 수 있는 것들: 하단 시트(`Sheet side="bottom"`), 채팅 입력창, 보드의 가로 스크롤바
  - 키보드가 열려 있거나(`visualViewport`) 하단 시트가 열려 있으면 nav 를 숨긴다
- 토스트는 지금 `top-right` 다. PC 상단 nav 와 사분면이 다르지만 1024px 에서 겹치는지 잰다
- 좁은 폭 처리는 위 「작업지시자가 정한 것」 아래 탭 5개 폭 계산을 따른다

## 단계 (단계마다 커밋)

### 1. 셸 교체 — 사이드바 제거, nav 추가
- 새 파일 `components/layout/floating-nav.tsx`: 탭 정의는 이 파일 한 곳에 둔다. 사이드바의 `navItems` 를 대체한다
- `app/(main)/layout.tsx`
  - `SidebarProvider` · `AppSidebar` · `SidebarInset` 을 걷어낸다
  - `FloatingNav` 를 넣는다
  - `MainWithChat` 에 nav 여백을 준다
- `components/layout/header.tsx`
  - `SidebarTrigger` 와 구분선을 뺀다
  - PC 에서는 알림 종을 nav 로 옮기고 Header 에서 숨긴다(`md:hidden`)
- `app-sidebar.tsx` 를 지운다. 안의 `LinkPendingMark`(이동 대기 표시)는 nav 탭에서 다시 쓴다
- `lib/constants.ts` `NAV_ITEMS` 는 지금 쓰는 곳이 없다. 지우거나 nav 정의로 바꾼다

### 2. 마이페이지
- `/settings` 를 마이페이지로 넓힐지, `/me` 를 새로 만들지 정한다. 권장: `/settings` 를 마이로 이름만 바꾸고, 위쪽에 프로필 블록을 둔다
- 프로필 메뉴의 항목을 카드 한 장 안에 목록 행으로 옮긴다(규칙 17): MCP 등록, 온보딩 다시 보기, 테마, 앱 설치(`InstallAppCard`), 검색(폰), 로그아웃

### 3. 아카이브 탭 허브
- 기존 경로를 그대로 둔다(`/omnis` · `/omnis/nas` · `/crm/quotes` …). 바뀌는 것은 nav 활성 판정과 **상단 하위 탭 띠**(지식 카드 · NAS · 지식재산권 · 고객·견적)뿐이다
- 하위 탭 띠는 `app/(main)/omnis/layout.tsx` 와 `app/(main)/crm/layout.tsx` 가 같이 쓰는 컴포넌트 하나로 만든다(규칙 25: 서로 다른 화면이니 페이지 자체는 지금대로 따로 둔다)
- 지식재산권은 당분간 **외부 링크 탭**으로 둔다(`haddscience.github.io/ip-platform`). 데이터는 이미 Omnis DB 에 있다(`lib/ip-data.ts`, `ip` 스키마)
  - 화면을 안으로 옮기는 일은 범위가 커서 **별도 계획**으로 뺀다

### 4. 업무 탭 빠른 필터 · 온보딩 투어
- 업무 툴바의 「전체」 배지를 필터 드롭다운으로 바꾼다: 오늘 마감 · 내가 지시한 · 내가 담당
- `components/onboarding/spotlight-tour.tsx`
  - `useSidebar()`(폰에서 사이드바를 여는 부분)를 걷어낸다
  - 대상 `data-onboarding` 을 다시 붙인다: `tasks` 는 nav 업무 탭, `resources` 는 nav 아카이브 탭, `profile`/`mcp`/`replay` 는 마이 탭과 마이페이지 행, `ai` 는 채팅 탭(채팅이 오기 전까지는 헤더의 채팅 버튼)
  - 캘린더 탭 설명 한 단계를 투어에 더할지는 캘린더 머지 뒤에 정한다
  - 투어 문구 중 「왼쪽 메뉴」 같은 표현을 고친다

### 5. 정리 · 문서
- `mydocs/manual/ux-rules.md`: viewport 책임 표와 규칙 14 의 z 토큰 목록에 `--z-nav` 를 넣는다. 「떠 있는 nav」 절을 하나 추가한다
- 테스트: `tests/` 에서 사이드바 링크를 누르던 곳을 nav 로 바꾼다(`getByRole("link", { name: "업무" })` 등)
- `scripts/narrow-audit.mjs` 경로 목록을 갱신한다

## 캘린더 브랜치와 맞출 것

- `feat/calendar-works-sync`(워크트리 `omnis-calendar`)가 `app-sidebar.tsx` 의 `navItems` 에 캘린더 한 줄을 더해 두었다
  - 이 계획이 사이드바 파일을 지우므로, 늦게 머지되는 쪽이 충돌을 푼다
  - 캘린더가 먼저 머지되면: 이 계획이 rebase 하면서 그 줄을 nav 탭 정의로 옮긴다
  - 이 계획이 먼저 머지되면: 캘린더 쪽이 사이드바 변경을 버린다. nav 탭은 이 계획이 처음부터 `/calendar` 로 둔다
- 캘린더가 머지되기 전에 nav 가 먼저 나가면 `/calendar` 가 404 다. 캘린더 탭은 **라우트가 있을 때만 보이게** 하지 않고 순서로 막는다: **캘린더 머지 → nav 머지**

## 다른 세션(홈)과 맞출 것

- 채팅 탭의 `href` 는 `/` 다. 홈 세션이 `app/page.tsx` 의 `redirect("/tasks")` 를 메신저로 바꾸는 순간 그대로 켜진다
- 홈 화면에 있는 **왼쪽 채팅방 목록**과 PC 상단 nav 는 겹치지 않는다
  - 다만 홈의 높이 계산은 nav 여백을 빼고 해야 한다. 여백은 CSS 변수 `--nav-offset-top` / `--nav-offset-bottom` 으로 공개한다
- 「Omnis AI 에게 질문」 버튼과 오른쪽 패널의 AI 탭은 홈 계획 2단계에서 정리된다. 이 계획에서는 지우지 않는다
- 파일이 겹칠 수 있다: `app/(main)/layout.tsx` · `main-with-chat.tsx`. 이 계획이 먼저 머지되면 홈 세션이 rebase 한다(작업 시작 전에 알린다)

## 검증

- `pnpm run verify`
- `AUDIT_USER=팀장 AUDIT_PASS=demo1234 node scripts/narrow-audit.mjs` — 320~200px 에서 넘침과 44px 터치 타깃
- dev(`next dev`, 운영 DB 금지)에서 Playwright 스크린샷
  - 1920 · 1440 · 1024 · 390 · 200px, 라이트와 다크
  - 업무 보드 위로 유리가 겹친 상태에서 라벨 대비를 실측한다
  - 확인 항목: 보드 드래그 중 화면 튐 없음, 하단 시트를 열면 nav 가 숨음, 폰 키보드가 열리면 nav 가 숨음, 데스크톱 zoom 1.1 에서 위치가 맞음
- `pnpm run test:e2e` (dev 서버를 띄운 상태)
- iOS PWA(설치본): 하단 safe-area 와 홈 인디케이터 위에 nav 가 뜨는지 실기기로 본다

## 정해야 할 것

1. 마이페이지 주소: `/settings` 를 넓힐지(추천), `/me` 를 새로 만들지
2. 채팅 화면이 들어오기 전의 채팅 탭
   - 지금 오른쪽 채팅 패널을 여는 버튼으로 둔다(추천) — 「전체」 팀 채팅이 이미 거기 있다
   - 숨긴다
3. 머지 순서: 캘린더 → nav → 채팅(홈). 이 순서로 가면 셋 다 서로를 rebase 할 일이 한 번씩만 생긴다
