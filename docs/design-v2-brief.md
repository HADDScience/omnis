# Omnis 시안 V2 브리핑 문서

> 작성일: 2026-04-23
> 작성자: Omnis 개발팀
> 수신: 주니어 디자이너
> 근거: 시니어 디자이너 리뷰 (2026-04-23) + UI/UX Pro Max 디자인 원칙
> 범위: 기존 시안의 UX 결함 보완 + 개발자 임의 추가 기능의 정식 디자인화

---

## 0. 변경 이력

| 항목 | 결정 | 근거 |
|------|------|------|
| 색상 토큰 | 기존 shadcn/base-vega `oklch` 유지 | 기존 프로젝트 디자인 시스템 일관성 |
| 폰트 | Inter + Geist Mono 유지 | 기존 프로젝트 정책 (CLAUDE.md) |
| 아이콘 | hugeicons 전용 | 기존 프로젝트 정책 (CLAUDE.md) |
| 대상 플랫폼 | Web (Next.js 16 + Tailwind 4) | — |

---

## 1. 우선 수정 항목 (Must Fix)

### 1.1 Primary Action 중복 제거 — GNB의 `+ 새 업무` 버튼 삭제
- **문제**: 글로벌 헤더(GNB) + 페이지 툴바에 동일 Primary CTA 2개 → 인지 위계 혼란.
- **결정**: **GNB에서 삭제**. 로컬 액션은 툴바에만.
- **참고 원칙** (UX Pro Max §4 style-match + `primary-action`): *Each screen should have only one primary CTA.*
- **향후 글로벌 액션 필요 시**: 헤더 우측이 아닌 **LNB 메뉴 하단**에 Floating Icon Button 형태로 배치.
- **시안 반영 위치**: 모든 페이지의 GNB 헤더 우측에서 `+ 새 업무` 제거.

### 1.2 카드 시각 규격 — 하이브리드 D-day + 프로젝트 컬러 해시
**D-day 표기 규칙**

| 조건 | 표기 | 색상 토큰 |
|------|------|-----------|
| 마감 > 7일 | 절대 날짜 (`3월 26일` / `03.26`) | `--muted-foreground` (gray) |
| 마감 1~7일 | `D-N` (예: `D-7`) | `--foreground` (bold) |
| 당일 (D-0) | `오늘` 또는 `D-Day` | `text-orange-500` (semibold) |
| 지연 (과거) | `D+N` + 카드 우상단 `지연` 뱃지 병기 | `--destructive` (medium) |

**프로젝트 컬러 해시 규칙**
- 기능: 프로젝트 이름 → CRC-like hash → 8색 팔레트 고정 매핑 (blue/emerald/amber/purple/rose/cyan/indigo/teal)
- 라이트: `border-{color}-300 bg-{color}-50 text-{color}-700`
- 다크: `border-{color}-500/30 bg-{color}-500/10 text-{color}-300`
- 시안에는 **3가지 예시**를 표기 (예: 고객 리포트/내부 문서/인프라 — 각기 다른 색상)
- **주의**: DB 스키마에 category 필드 없음. `project.name` 필드 기반으로 시각 대체.

**카드 레이아웃 순서**
```
┌────────────────────────────────┐
│ [업무 제목]              [지연] │  ← 지연 시만 뱃지
│ #slug                          │
│ [👤Avatar] [프로젝트] …  D-7    │
└────────────────────────────────┘
```

### 1.3 Muted-foreground 명도 상향 — WCAG AA 4.5:1
- **현재**: 라이트 모드 `oklch(0.556 0 0)` ≈ 3.5:1 (기준 미달)
- **수정 적용 완료**: `oklch(0.45 0 0)` ≈ 5.7:1 (AA 통과)
- **참고 원칙** (UX Pro Max §1 `color-contrast`, §6 `color-accessible-pairs`)
- 시안에서도 보조 텍스트(D-day 날짜, #slug, 뱃지 부가 설명 등)의 대비를 반드시 4.5:1 이상으로 명시.
- 다크 모드 `oklch(0.708 0 0)` ≈ 7.5:1 → 유지.

---

## 2. 개발자 추가 기능의 정식 디자인화

### 2.1 개인 완료율 Progress 바 (리스트 뷰 상단)
- **배경**: 개발자가 사용자 가치를 고려해 추가한 UX 요소. 시안에 누락되어 임의로 추가된 상태.
- **디자이너 할 일**: 리스트 뷰 상단 영역을 다음 규격으로 공식화.
  - 높이: 48~56px (GNB 아래, 툴바 위)
  - 구성: `[완료율 텍스트 "이번 주 {N}%"] [Progress bar 200~300px] [Date Picker "MM.DD ~ MM.DD"]`
  - Progress bar 색상: `--primary` (활성) / `--muted` (트랙)
  - Date Picker 스타일: shadcn Popover + Calendar, ChevronLeft/Right 주간 이동
- **참고 원칙** (UX Pro Max §4 `elevation-consistent`, §6 `visual-hierarchy`): 추가 컴포넌트가 기존 위계를 흐리지 않도록 주의.

### 2.2 Date Picker (주간 기간 선택)
- 현재 코드에서는 `dashboard-personal` 내 존재. V2 시안에서 리스트 뷰 상단 영역에 정식 편입.
- 기본값: 이번 주 월~일
- 인터랙션: 클릭 시 Popover로 Calendar 펼침, 단일 선택이 아닌 **주 단위 하이라이트**.

---

## 3. 시니어 피드백 — 패턴 보완 항목

### 3.1 필터 (비선택 상태) Clickable Affordance 강화
- **문제**: 활성 필터는 Pill(배경), 비활성은 평문 텍스트. 비활성 텍스트가 링크처럼 인지되지 않음.
- **수정 방향**:
  - 비활성 상태에도 **hover에서 배경 톤 상승** + **cursor-pointer** (이미 코드는 적용 중)
  - 첫 렌더 시 `underline-offset-4 decoration-dotted` 한 번 깜빡 or 작은 드롭다운 아이콘 `▾` 부여
  - Focus state: 2px ring (`--ring`) 시안에 명시
- **참고 원칙** (UX Pro Max §2 `cursor-pointer`, `hover-vs-tap`; §3 `input-affordance`).

### 3.2 폼 리본 (새 업무 모달) Overflow 엣지 케이스
- **수용 조건 (시니어)**: 다음 엣지 케이스 디자인이 **V2 시안에 반드시 포함**되어야 함.
  - **긴 텍스트**: 각 리본 칩은 `max-w-[160px] truncate` + hover 시 **Tooltip**으로 전체 텍스트 표시
  - **다수 태그**: 4개 초과 시 `+N` 말풍선 칩 (클릭 → 팝오버로 전체 태그 리스트)
  - **다중 행 전환점**: 컨테이너 너비 < 480px에서는 **2행 자동 줄바꿈**
- **참고 원칙** (UX Pro Max §6 `truncation-strategy`).

### 3.3 체크리스트 시각 계층
- **문제**: 체크박스 테두리와 글자 거리가 너무 짧음 (답답함).
- **수정**: 체크박스와 텍스트 사이 **최소 12px gap**, 체크박스 크기 16×16 (touch 여유 32px hitSlop).
- 텍스트 색상: 미완료 `--foreground`, 완료 `--muted-foreground` + `line-through`.

---

## 4. 네비게이션 / 패널

### 4.1 뷰 전환 탭 — 간트/캘린더 제거
- **결정**: 코드에서 **제거 완료**. Figma 시안에는 로드맵용 Optional로 남겨두고 **disabled 스타일로 절대 표기하지 말 것**.
- **근거**: "곧 나와요" 티저는 유저 기만. 없으면 없는 거.

### 4.2 LNB 프로필 영역 — Overflow 방어
- **수정 완료**: Avatar · ArrowUp 아이콘 `shrink-0`, 텍스트 블록 `min-w-0 flex-1 truncate`
- **시안에서 명시할 것**:
  - 최소 LNB 너비: **240px** (기본)
  - 축소(collapsed) 시: **64px** 아이콘만 표시
  - Avatar 고정 크기: **26×26px**, Name truncate, Role 배지 `font-mono text-[9.5px]`

### 4.3 워크스페이스 노드 뷰 — 패널 동시 오픈 Edge Case
- **Z-index 스택 정의** (시안에 레이어 그림으로 포함 필수):
  ```
  Layer 0: Canvas (노드 그래프)
  Layer 10: Minimap (좌하단, position: absolute, 크기 160×120)
  Layer 20: Inspector Panel (우측, width: 360, 고정)
  Layer 30: Chat Dock (하단, height: 동적 280~600)
  Layer 40: Modal / Popover
  Layer 100: Toast / Tooltip
  ```
- **패널 동시 오픈 시 동선**:
  - Inspector 열림 → Canvas 영역 `margin-right: 360px` 자동 shift
  - Chat Dock 열림 → Canvas 영역 `margin-bottom: [dockHeight]` 자동 shift
  - Inspector + Chat Dock 모두 열림 → **Minimap 위치 자동 상향 이동** (Dock 위로 8px 여유)
- **접힘 transition**: 180ms ease-out (기존 Chat Dock 설정과 일치).

---

## 5. Elevation / Depth 규격 (신규 토큰)

현재 Chat Dock에 다음 Elevation이 적용되었음. 시안에서 이 규격을 **전역 Elevation Scale**로 문서화.

| Level | 용도 | Light | Dark |
|-------|------|-------|------|
| elevation-0 | Card/Inline | 없음 | 없음 |
| elevation-1 | Dock/Sticky bar | `shadow-[0_-4px_16px_rgba(0,0,0,0.08)]` + `bg-background/95 backdrop-blur` | `shadow-[0_-4px_16px_rgba(0,0,0,0.35)]` |
| elevation-2 | Popover/Dropdown | `shadow-[0_4px_12px_rgba(0,0,0,0.10)]` | `shadow-[0_4px_12px_rgba(0,0,0,0.40)]` |
| elevation-3 | Modal/Dialog | `shadow-[0_16px_48px_rgba(0,0,0,0.16)]` | `shadow-[0_16px_48px_rgba(0,0,0,0.50)]` |

- **참고 원칙** (UX Pro Max §4 `elevation-consistent`).

---

## 6. 접근성 / 인터랙션 체크리스트 (시안 Export 전)

- [ ] 모든 보조 텍스트 대비 **4.5:1 이상** (Figma 플러그인 Stark/A11y로 검증)
- [ ] 모든 인터랙티브 요소에 **hover + focus + pressed** 3가지 상태 정의
- [ ] 모든 아이콘 버튼에 **aria-label** 기재 (시안 주석으로라도 명시)
- [ ] 터치 대상 **44×44px 이상** (헤더 아이콘, 필터 칩 포함)
- [ ] Modal/Popover에 **닫기 X** + **ESC 힌트** 명시
- [ ] 에러 상태 — 필드 하단 메시지 + 아이콘(단색 red만 금지)
- [ ] 다크 모드 전체 뷰 따로 Export
- [ ] 375px / 768px / 1024px / 1440px 4개 breakpoint 대응 레이아웃

---

## 7. 딜리버러블 체크리스트 (디자이너 → 개발팀)

- [ ] Figma Library의 **Color token** 갱신 (muted-foreground 상향 반영)
- [ ] **카드 컴포넌트 4가지 상태** (normal / hover / dragging / overdue)
- [ ] **필터 칩 3가지 상태** (default / hover / selected)
- [ ] **리스트 뷰 상단 완료율 바 + Date Picker** 신규 컴포넌트
- [ ] **새 업무 모달** Overflow 케이스 3종 (긴 텍스트 / +N 태그 / 2행 줄바꿈)
- [ ] **LNB 프로필** 2가지 (펼침 / 접힘)
- [ ] **워크스페이스 패널 동시 오픈** 레이아웃 (Inspector + Dock + Minimap 전환)
- [ ] **Elevation Scale 가이드 페이지** 1장
- [ ] **라이트/다크 모드** 전체 페이지 이중 Export

---

## 8. 우선순위 & 기대 Timeline

| 우선순위 | 항목 | 예상 소요 |
|---------|------|---------|
| P0 | §1.1~1.3 (Primary 중복/카드/대비) | 1일 |
| P0 | §2.1~2.2 (Progress + Date Picker) | 0.5일 |
| P1 | §3.1~3.3 (필터/폼/체크박스) | 1일 |
| P1 | §4.3 (노드 뷰 패널 동선) | 1일 |
| P2 | §5 (Elevation Scale 문서) | 0.5일 |

**총 예상: 4일 (1명 기준)**

---

## 부록. 이미 구현된 내용 (개발자 측)

개발팀에서 P0 항목 기반 코드 수정 완료 (2026-04-23):
- `app/globals.css` — `--muted-foreground` 0.556 → 0.45 (WCAG AA)
- `app/(main)/tasks/tasks-board.tsx` — 하이브리드 D-day 포매터 + 8색 프로젝트 해시 팔레트
- `components/chat/chat-dock.tsx` — Elevation-1 적용 (backdrop-blur + 상단 그림자)
- `components/layout/app-sidebar.tsx` — Avatar/Icon `shrink-0` overflow 방어
- `app/(main)/tasks/view-toggle.tsx` — 간트/캘린더 탭 없음 (기존부터)

**→ 시안 V2 수령 시, 그대로 스타일 동기화 리팩토링 진행.**
