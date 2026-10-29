# feature e2e — 쓰고 고치는 법

CI(`.github/workflows/ci.yml` 의 `e2e`)와 로컬 `pnpm run test:e2e:local` 이 돌리는 사용자 흐름 테스트다.
계획: [`mydocs/plans/2026-10-29-e2e-guard.md`](../../mydocs/plans/2026-10-29-e2e-guard.md)

## 언제 돌리나

화면(`app/` · `components/`)이나 이 폴더를 바꿨으면 **push 전에**:

```bash
pnpm run test:e2e:affected           # 바꾼 파일에 닿는 영역만, 격리 DB 에서
pnpm run test:e2e:affected -- --dry  # 무엇을 돌릴지만 본다
pnpm run test:e2e:local              # 전체 (약 3분)
```

`test:e2e:affected` 는 `scripts/e2e-affected.mjs` 의 경로 → 태그 표로 고른다. 셸(`components/layout` · `components/ui` ·
`globals.css` 등)이나 표에 없는 경로를 바꾸면 전체를 돌린다. 새 화면 영역을 만들면 그 표에 한 줄 더한다.

## 쓰는 법

- **`describe` 마다 영역 태그**: `@nav` `@tasks` `@archive` `@search` `@onboarding` `@auth` `@reports` `@chat` `@mobile`
- **`test` 마다 위에 `// 지키는 것: …` 한 줄** — 사용자 입장의 약속 한 문장. 「버튼이 보인다」가 아니라 「검색을 열 수 있다」
- **버튼을 직접 찾지 않고 [`_actions.ts`](_actions.ts) 의 함수를 쓴다** — `gotoTab` · `openSearch` · `openMy` · `openOmnisAi` ·
  `replayTutorial` · `switchTasksView` · `toggleStalledTasks` … 없는 동작이면 함수를 하나 더한다. 이름은 의도로 짓는다
- **같은 화면 안에서 옮겨 가는 흐름은 `page.goto` 를 쓰지 않는다** — 문서를 새로 읽어 작성 중인 상태가 지워진다
- **폰 화면은 `@mobile` 태그를 단 테스트로** — `mobile` 프로젝트(390px 터치, Chromium)는 이 태그만 돈다. `feature` 프로젝트는 이 태그를 뺀다

## 깨졌을 때 — 테스트를 고칠까, 기능을 고칠까

먼저 그 테스트의 「지키는 것」 을 읽는다.

1. **약속은 그대로인데 길이 바뀌었다** (버튼을 옮김, 탭을 합침) → `_actions.ts` 의 그 함수를 고친다. spec 은 손대지 않는 게 보통이다
2. **약속 자체를 일부러 바꿨다** (기능을 뺌, 동작을 바꿈) → 「지키는 것」 줄부터 새 약속으로 고치고, 그에 맞게 테스트를 고친다.
   PR 본문에 무엇을 지키던 테스트였고 왜 바꿨는지 적는다
3. **약속을 지키려면 테스트가 성립하지 않는다** → 테스트가 아니라 **기능**이 망가진 것이다. 기능을 고친다

2026-10-29 PR #108 의 예:
- ⌘K 팔레트 — nav 의 검색 버튼을 뺐다. 약속(「검색을 열 수 있다」)은 그대로라 1번: `openSearch` 를 단축키 · 마이 화면 행으로
- 온보딩 「작성 중인 질문 보존」 — 테스트를 `page.goto("/settings")` 로 고쳐 약속이 성립하지 않게 됐다. 3번을 놓친 실수였다
- 관계도 더블클릭 — 맨 위 노드가 도구 막대에 깔려 사람도 못 눌렀다. 3번: 화면(fitView 여백)을 고쳤다
