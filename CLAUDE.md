# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## UX·구조 규칙 (Phase 1, 2026-05-06)

> 자문(designer-high / frontend-engineer-high / architect / ui-ux-pro-max / codex-rescue) 다수결 + Codex 적대적 검토(v2~v4) 반영. 각 규칙 (R) 리뷰 체크 / (E) 예외 / (S) 적용 범위 형식.

11. **native prompt/confirm/alert 사용 금지** — (R) PR diff에 `window.prompt(`, `window.confirm(`, `window.alert(`이 추가되었는가? (E) Storybook/dev-only 디버그 컴포넌트는 허용. (S) `app/`, `components/` 전체.

12. **빈 onClick 금지** — (R) `onClick={() => {}}` 또는 핸들러 미연결 button이 있는가? (E) `disabled` 상태 + Tooltip("곧 출시")이 있으면 허용. (S) 모든 button/clickable.

13. **AI ↔ DB Zod SSOT** — (R) AI 응답 파싱·DB write·Form defaultValues가 모두 같은 Zod 스키마? (E) 일회성 backfill 스크립트는 inline schema 허용. (S) `lib/ai.ts`, `app/api/`, 모든 Form.

14. **floating overlay 사분면 충돌 금지 + z-index 토큰화** — (R) 신규 fixed/sticky가 z 토큰 사용 + ChatDock 점유 사분면(우하단) 회피? (E) `var(--z-dialog)` / `var(--z-toast)`. (S) 모든 fixed/sticky. 토큰: `--z-dock: 40` / `--z-banner: 50` / `--z-popover: 60` / `--z-dialog: 100` / `--z-toast: 120`.

15. **shadcn primitive 구조 재정의 금지** — (R) DialogHeader/DialogFooter에 `flex-row` 등 layout 변형 클래스 추가? (E) 없음. (S) shadcn 모든 primitive.

16. **2-column detail = grid + max-w + mx-auto** — (R) 사이드바가 있는 detail 페이지 컨테이너에 `grid-cols-[...] max-w-* mx-auto` 또는 본문에 `mx-auto max-w-* w-full`? (E) 모바일(< 768px)에서는 단일 컬럼 + Sheet. (S) 모든 detail 라우트.

17. **Card 3+ 수직 스택 금지** — (R) 한 화면에 `<Card>` 3개 이상 단순 스택? (E) Tabs/Accordion/Collapsible 내부는 허용. (S) detail/dashboard.

18. **메시지 List는 Composer 동반 필수** — (R) `<MessageList>` 형제에 `<MessageComposer>`? (E) 읽기 전용은 `readOnly` prop으로 별도 표시. (S) 모든 ChatMessage 표시.

19. **동일 도메인 = 단일 카드 컴포넌트의 variant** — (R) Task를 list/board에서 다른 카드로 렌더? `<TaskCard variant="...">` 사용? (E) 카드 미리보기 등은 분리 가능. (S) Task, Project, OmnisCard.

20. **상단 Input = 검색 전용** — (R) 페이지 상단 `<Input>`이 검색 외 용도? (E) Form 페이지(설정 등)에서는 명확한 label과 함께 허용. (S) list/grid 상단.

21. **detail loader는 1-hop 관계 기본 include** — (R) `getXDetail` loader에 핵심 1-hop (Task→Project→Product, OmnisCard→Category) include? (E) P95 > 500ms 시 split + lazy. (S) 모든 detail loader.

22. **schema 필드 삭제 시 5곳 동시 수정 체크리스트** — (R) Prisma + Zod + AI prompt + UI render + Form input 5곳 모두 변경? (E) 없음. (S) `Task`, `OmnisCard` 등 핵심 모델.

23. **schema 변경 시 마이그레이션 + Zod union 동시 작성** — (R) `prisma migrate` 추가 시 같은 PR에 Zod schema + 백필 스크립트? (E) revert-only PR 면제. (S) 모든 schema 변경.

24. **AI 분류축은 카드 표면에 시각화** — (R) AI가 자동 채우는 필드(`priority`, `category`, `status`)가 list/board 카드에 1개 이상 Badge/Stripe로 노출? (E) 데모 압축 뷰는 1개로 축약. (S) Task/Card 표시.

25. **다른 탭 = 다른 컴포넌트** — (R) Tab 라벨이 의미상 다른 데이터·UX면 각 탭이 별도 React 컴포넌트? (E) 데이터 동일·필터만 다른 경우 같은 컴포넌트 + filter prop. (S) Tabs 사용 모든 위치.

26. **a11y 기본 (ui-ux-pro-max #1)** — (R) interactive 요소가 (a) 키보드 포커스, (b) `aria-label`/텍스트, (c) 4.5:1 대비? (E) 장식 아이콘은 `aria-hidden`. (S) 모든 button/link/input. 도구: `eslint-plugin-jsx-a11y`, axe-core.

27. **loading state 명시** — (R) async 데이터 의존 화면에 (a) Skeleton/Spinner, (b) `isPending`/`isLoading` 분기? (E) `<Suspense>` boundary로 위임 시 fallback 명시. (S) 모든 fetch/RSC.

28. **empty state 명시** — (R) 리스트/테이블/그리드 빈 상태에 `<EmptyState>`(아이콘+메시지+CTA)? (E) 검색 결과 0건은 search-empty variant. (S) 모든 데이터 표시.

29. **error boundary** — (R) Server Action/fetch 실패 시 toast(`sonner`) 또는 inline error? (E) background sync 실패는 console + 알림 옵션. (S) 모든 mutation.

30. **mobile fallback 명시** — (R) 신규 컴포넌트가 viewport `< 768px`에서 (a) 가로 스크롤 없음, (b) 핵심 액션 도달 가능, (c) 터치 타겟 ≥ 44px? (E) 데스크톱 전용은 "데스크톱에서 열어보세요" 안내. (S) 모든 신규 client 컴포넌트.

### viewport 책임 표

| Viewport | 본문 max-width | Activity Rail | 헤더 |
|----------|---------------|---------------|------|
| `< 768px` (mobile) | `100%` (gutter 16px) | 하단 Sheet (FAB로 토글) | 상단 sticky 컴팩트 1줄 |
| `768~1280px` (tablet) | `100%` | 우측 320px Collapsible (기본 접힘) | 상단 sticky 2줄 |
| `≥ 1280px` (desktop) | `min(768px, 1fr)` | 우측 320px 고정 | 상단 sticky 풀 |

### 시연 데모 환경 (NEXT_PUBLIC_IS_DEMO)

- 데모 배너: `<DemoBanner />` 상단 alert + dismiss + cookie 7일 (`omnis_demo_banner_dismissed`)
- 카나리 검증: Phase 2~3 작업은 별도 브랜치 + `NEXT_PUBLIC_FEATURE_*` flag 게이팅
- Phase 1만 main 직접 머지 (저위험)