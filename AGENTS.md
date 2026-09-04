---
kind: canonical
status: active
canonical: AGENTS.md
last_verified: 2026-09-04
---

# Omnis 작업 규약

이 문서가 작업 규약의 **정본**이다. `CLAUDE.md` 는 여기로 보내는 얇은 부트로더이고,
`GEMINI.md`·`.cursor/rules` 같은 도구별 파일을 나중에 두더라도 전부 이 문서를 가리키는
포인터로 둔다 — 규약을 고칠 때는 여기 한 곳만 고친다.

방법론은 **[Hyper-Waterfall](mydocs/manual/hyper-waterfall.md)** 을 따른다.
원 출처는 [edwardkim/rhwp](https://github.com/edwardkim/rhwp) 이며, Rust·CLI 전제를 걷어내고
Omnis(Next.js · Prisma · Vercel)에 맞게 옮겼다. 문서 규약(`mydocs/`)은 이미 같은 출처에서
가져와 쓰고 있다 — [`mydocs/README.md`](mydocs/README.md).

---

## 문서 로딩 순서

1. `AGENTS.md` — 이 문서 (작업 규약)
2. [`mydocs/README.md`](mydocs/README.md) — 문서 규약. frontmatter 네 칸의 뜻
3. [`mydocs/manual/ai-pairing.md`](mydocs/manual/ai-pairing.md) — 환경·검증 기준·금지 사항
4. 건드릴 영역의 canonical 문서

   | 작업 | canonical |
   |---|---|
   | UI · 컴포넌트 · 레이아웃 | [`mydocs/manual/ux-rules.md`](mydocs/manual/ux-rules.md) |
   | 인증 · SSO | [`mydocs/tech/auth-architecture.md`](mydocs/tech/auth-architecture.md) |
   | 지식재산권 자료 | [`mydocs/tech/ip-schema.md`](mydocs/tech/ip-schema.md) |
   | DB · 마이그레이션 | [`mydocs/troubleshootings/migration-traps.md`](mydocs/troubleshootings/migration-traps.md) |
   | 방법론 · 프로세스 | [`mydocs/manual/hyper-waterfall.md`](mydocs/manual/hyper-waterfall.md) |
   | "왜 Supabase 를 걷었나" | [`mydocs/troubleshootings/supabase-limits.md`](mydocs/troubleshootings/supabase-limits.md) |

5. 오늘 작업 — `mydocs/orders/{yyyymmdd}.md`

**이 문서와 canonical 문서가 다르면 canonical 문서를 따른다.**

---

## 세 원칙

이것을 지키지 않으면 바이브 코딩으로 전락한다.

### 제1원칙 — 구현 목표가 AI 컨텍스트에 유지되게 한다

AI 는 지금 대화의 컨텍스트 안에서만 일관성을 유지한다. 목표·아키텍처 원칙·품질 기준이
컨텍스트에서 벗어나면 방향을 잃고 단편적인 코드만 나온다.

- 프로젝트의 결정은 문서로 외부화한다 — `mydocs/` 가 그것이다
- 타스크를 시작할 때 목표와 범위를 `mydocs/plans/` 에 먼저 적는다
- 컨텍스트가 길어지면 핵심 맥락을 요약해 다시 넣는다

### 제2원칙 — 통제권은 작업지시자(사람)가 유지한다

무엇을 만들지, 어떤 순서로 할지, 언제 멈출지는 사람이 정한다.

- 계획은 AI 가 쓰되 **승인은 사람이 한다**
- AI 가 임의로 작업 종료를 선언하지 않는다
- 아키텍처 변경 · 스키마 변경 · 배포 · 외부 게시는 사람 판단을 거친다
- **"좋아 보입니다"로 넘기지 않는다** — 돌려보고 출력을 붙인다

### 제3원칙 — 컨텍스트 유지를 주기적으로 확인한다

- AI 가 이전 결정을 잊기 시작하면 경고 신호다 — 압축 시점을 인지한다
- 합의된 결정은 AI 메모리가 아니라 **파일**에 남긴다 (`mydocs/tech/`, `mydocs/working/`)
- 새 세션은 이전 맥락 요약으로 시작한다
- 문서의 사실이 낡았는지 확인하고 `last_verified` 를 올린다. 읽었다고 올리지 않는다

---

## 역할 분담

| 작업지시자 (사람) | AI 페어 프로그래머 |
|---|---|
| 방향 설정 · 우선순위 | 코드베이스 분석 · 원인 추적 |
| 계획 검토 · 승인 | 수행 계획서 작성 |
| 품질 · 정확성 판단 | 구현 · 테스트 작성 |
| 아키텍처 결정 | 보고서 · 기술 문서 · 커밋 메시지 |
| 도메인 지식 제공 | 디버깅 · 수정안 제시 |
| 피드백 (`mydocs/feedback/`) | 피드백 반영 · 재시도 |

> **사람은 절대 생각을 멈추지 않는다.** AI 출력을 읽지 않고 수락하는 순간 이 방법론은 무너진다.

---

## 타스크 사이클

```
1. 등록   작업지시자가 범위를 정한다        → mydocs/orders/{yyyymmdd}.md 에 한 줄
2. 계획   AI 가 수행 계획서 작성 (3~6단계)   → mydocs/plans/{yyyy-mm-dd}-{슬러그}.md
          작업지시자: 검토 → 승인 또는 수정      ← 승인 없이 3 으로 가지 않는다
3. 구현   AI 가 단계별로 코드 + 테스트        → 단계 끝마다 커밋
4. 검증   npm run verify + 범위별 게이트      → mydocs/working/{yyyy-mm-dd}-{슬러그}.md
          실측 출력을 보고서에 붙인다
5. 마감   작업지시자 승인 → main 머지         → 계획서를 mydocs/plans/archives/ 로 이동
```

### 계획서를 쓸지 판단하는 기준

셋 중 **하나라도** 해당하면 2~4 를 거친다:

- 되돌리기 어려운가 (스키마 · 마이그레이션 · 배포 · 외부 게시)
- 3개 이상 파일에 걸치는가
- 코드만 봐서는 왜 그렇게 했는지 알 수 없는 결정이 들어가는가

해당 없으면 바로 커밋한다. 오탈자 · 한 줄 수정에 계획서를 쓰면 규율이 아니라 의식(儀式)이 된다.

### 각 문서가 담는 것

| 경로 | kind | 담는 것 |
|---|---|---|
| `mydocs/orders/{yyyymmdd}.md` | snapshot | 그날 할 일과 상태. 낡는 것이 정상 |
| `mydocs/plans/` | decision | 무엇을 왜 그 순서로. 끝나면 `archives/` 로 |
| `mydocs/working/` | snapshot | 단계별·최종 결과와 **실측 출력** |
| `mydocs/feedback/` | memory | 사람이 쓴 피드백. AI 가 채우지 않는다 |

---

## 품질 게이트

push 하기 전에 통과시킨다. 한 단계라도 실패하면 고치기 전에는 push 하지 않는다.

```bash
npm run verify          # typecheck → lint 순차 실행
npm run build           # prisma generate + next build (DATABASE_URL 필요)
```

범위별 추가 게이트:

| 변경 범위 | 추가로 통과시킬 것 |
|---|---|
| `prisma/schema.prisma` | 마이그레이션 + Zod 스키마 갱신 + 백필 스크립트를 같은 커밋에 (규칙 23) |
| `app/` · `components/` UI | [`ux-rules.md`](mydocs/manual/ux-rules.md) 규칙 11~30 자가 점검 |
| 인증 · SSO | `tsx scripts/verify-sso.ts` + `verify-sso-live.ts` |
| ip 스키마 · 함수 | `tsx scripts/verify-ip-import.ts` |
| 사용자 흐름 | `npm run test:e2e` (dev 서버가 떠 있는 상태에서) |
| 배포본 | 실제 HTTP 요청. 화면 확인만으로는 부족하다 |
| 문서만 | 게이트 없음 |

**보고서에는 돌린 명령과 그 출력을 붙인다.** 돌리지 않은 것을 "검증했다"고 쓰지 않는다.
새 규칙을 넣었으면 **거부되어야 하는 경우**를 함께 넣는다 — 통과 사례만 있는 시험은
아무것도 지키지 못한다.

---

## Git 워크플로우

```
feat/{주제}  ──커밋──커밋──┐
                            └─→ main 머지 (검증 후) ──→ vercel deploy --prod --yes
```

- Vercel git 자동배포는 꺼져 있다. 배포는 수동이다
- 커밋 메시지는 기존 스타일을 따른다: `feat(scope): 한국어 요약` / `fix(scope):` / `docs(scope):`
- 커밋 메시지에는 **무엇을 했는지가 아니라 왜 그랬는지**를 적는다. 무엇을 했는지는 diff 가 말한다
- 작업 단계가 바뀌면 현재 단계를 커밋한 뒤 다음 단계를 시작한다
- **push · PR 생성 · GitHub 코멘트 · 배포는 사용자 승인을 받은 뒤 수행한다**
- 다른 세션이나 사람이 만든 변경은 임의로 되돌리거나 삭제하지 않는다

---

## 코드를 쓸 때

아래 네 항목은 이 저장소가 원래부터 쓰던 지침이다. 문구를 그대로 옮겨 왔다.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

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

### 4. Goal-Driven Execution

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

## 공통 원칙

- 구현 전에 관련 기존 계획 · 보고서 · 트러블슈팅을 먼저 확인한다
- **파일을 고치기 전에 반드시 먼저 읽는다.** 예외 없다
- 태도를 문장으로 선언하지 않는다 — 한계는 사실로 적고 "정직하게 적었다"는 논평은 붙이지 않는다
- NAS(`~/NAS/HADD Science/`) 파일은 덮어쓰지 않는다.
  `{원본명}_{YYMMDD}_{이름}_{NN}.{확장자}` 로 새로 저장하고, 저장 뒤 다시 열어 무결성을 확인한다
- `.env` 의 DB 비밀번호 · API 키 · 인증 정보는 공개 채널에 올리지 않는다
