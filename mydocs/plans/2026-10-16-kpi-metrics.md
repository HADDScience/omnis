---
kind: decision
status: active
canonical: mydocs/plans/2026-10-16-kpi-metrics.md
last_verified: 2026-10-16
---

# 운영 KPI 수집 1단계 — 업무 변경 이력 · 일일 KPI 스냅샷

상태: 2026-10-16 작성, 작업지시자 승인 대기.
스키마 추가 · 운영 마이그레이션 · 배포가 들어가 AGENTS.md 타스크 사이클 2단계(승인)를 거친다.

## 왜

「옴니스가 제 역할을 하는가」를 숫자로 보고 싶은데, 그 숫자의 재료가 남지 않는다.

| 보고 싶은 것 | 지금 (2026-10-16 운영 DB 실측) |
|---|---|
| 지시에서 완료까지 걸린 시간 · 카드 상태가 현실을 따라가는지 | **상태 변경 이력이 없다.** `ActivityLog` 의 `task.updated` 는 바뀐 뒤 값만 남기고, AI 경로(`lib/chat-post.ts` 보류·재개·재구성)와 알림 완료 확인(`lib/notifications.ts`)은 아예 안 남긴다 |
| AI 가 바꾼 것과 사람이 바꾼 것 구분 | 남지 않는다 |
| 주간 실사용자 · 직접 입력 비율 · AI 비용 추이 | 원재료(`ChatMessage`, `GeminiUsage` 1,606건, `Notification` 87건, `OmnisQuery` 45건)는 있지만 매번 손으로 쿼리해야 한다 |

과거 이력은 복원할 수 없다. 이력 기반 지표는 **반영한 날부터** 쌓인다. 원재료가 이미 있는 지표는 백필한다.

## 무엇을 만드나

### 1. `TaskEvent` — 업무 변경 이력

```prisma
model TaskEvent {
  id        String   @id @default(uuid())
  taskId    String
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actorId   String?  // 사람이면 그 사람, AI·이식이면 시스템 계정 또는 null
  via       String   // "web" | "mcp" | "chat-ai" | "notification" | "import"
  field     String   // "created" | "status" | "assignees" | "deadline" | "archived" | "checklist"
  before    Json?
  after     Json?
  createdAt DateTime @default(now())
  @@index([taskId, createdAt])
  @@index([field, createdAt])
}
```

- **값이 실제로 바뀔 때만** 한 줄. 같은 상태로 다시 저장하면 남기지 않는다.
- `via` 는 문자열 + Zod union (규칙 23). enum 이 아니라서 경로가 늘어도 마이그레이션이 필요 없다.
- `ActivityLog` 에 얹지 않는 이유는 세 가지다.
  - `ActivityLog` 는 연혁·CRM 기록과 섞여 있다.
  - 쓰기 실패를 삼킨다(`writeActivity` 의 try/catch).
  - before/after 가 JSON 안에 묻힌다.
  - KPI 는 「상태가 언제 무엇에서 무엇으로」를 매일 묻기 때문에 전용 표가 질의도 검증도 단순하다.

기록하는 곳:

| 경로 | 파일 | via |
|---|---|---|
| 업무 생성 (화면 · MCP) | `app/api/tasks/route.ts` · `lib/omnis-mcp.ts` | web · mcp |
| 업무 수정 (화면 · MCP `update_task`) | `lib/task-update.ts` — 바꾸기 전 값을 함께 읽는다 | web · mcp |
| 채팅 AI 보류 · 재개 · 재구성 | `lib/chat-post.ts` | chat-ai |
| 알림에서 완료 확인 | `lib/notifications.ts` | notification |
| 체크리스트 체크 · 해제 | `lib/checklists.ts` | web · mcp |
| 카톡 이식 (생성 · 상태 올림) | `omnis-kakao` 브랜치의 `import-tools` | import — **이 브랜치가 머지된 뒤 그쪽에서 붙인다** |

`updateTask` 는 지금 호출자가 화면인지 MCP 인지 모른다. 인자 하나(`via`)를 더 받는다.

### 2. `KpiDaily` — 하루 한 번 스냅샷

```prisma
model KpiDaily {
  day       DateTime @db.Date   // 한국 날짜
  key       String              // 지표 이름
  value     Float
  detail    Json?
  createdAt DateTime @default(now())
  @@id([day, key])
}
```

세로(긴) 모양이라 **지표를 늘려도 마이그레이션이 없다.** 같은 날을 다시 계산하면 덮어쓴다(upsert).

1단계 지표:

| 층 | key | 정의 | 백필 |
|---|---|---|---|
| 채택 | `users.active` | 그날 직접 쓴 사람 수 — 옴니스 채팅(이식분 제외) · 업무 변경(web/mcp) · 옴니스 질문 중 하나라도 | ✅ 이벤트 제외분 |
| 채택 | `messages.native` / `messages.imported` | 그날 메시지 수, 직접 입력 / 카톡 이식 | ✅ |
| 추적 | `tasks.created.native` / `tasks.created.imported` | 그날 생긴 업무 | ✅ |
| 추적 | `tasks.done` | 그날 완료로 바뀐 업무 (`TaskEvent`) | ❌ 반영일부터 |
| 추적 | `tasks.leadtime.p50` | 그날 완료된 업무의 생성 → 완료 중앙값(일) | ❌ 반영일부터 |
| 추적 | `tasks.open` · `tasks.stale30` · `tasks.doneOpenChecklist` | 그날 끝 기준 열린 업무, 30일 넘게 조용한 업무, 완료인데 체크리스트가 남은 업무 | ❌ 그날 상태만 알 수 있다 |
| 추적 | `messages.linkedRate` | 그날 메시지 중 업무에 붙은 비율 | ✅ (지금 연결 기준) |
| AI | `ai.statusChanges.byAi` / `.byHuman` | 상태 변경 중 AI·이식 몫과 사람 몫 | ❌ 반영일부터 |
| 알림 | `notifications.actionable` / `.resolved` / `.responseHours.p50` | 응답이 필요한 알림, 응답된 것, 응답까지 걸린 시간 | ✅ |
| 비용 | `ai.calls` · `ai.tokens` · `ai.costKrw` | `GeminiUsage` 합. 비용은 모델 단가 × 토큰 추정, `detail` 에 경로별 내역 | ✅ |

- 계산은 `lib/kpi.ts` 의 `computeDailyKpis(day)` 한 곳에 둔다.
- **이미 있는 하루 크론(`app/api/cron/daily`)에 일 하나로 붙인다.** Neon 을 따로 깨우지 않는다(그 파일 머리말의 원칙). 매번 **어제와 오늘**을 다시 계산해서, 크론이 하루 빠져도 메운다.
- 백필: `scripts/kpi-backfill.ts --from 2026-09-02` 로 백필 가능한 지표만 채운다. `GeminiUsage` 기록이 9/2 부터 시작한다.

### 3. 대시보드

이미 만든 「옴니스 운영 현황」 대시보드가 `KpiDaily` 를 읽게 바꾼다. 대시보드는 운영 DB 에 직접 붙을 수 없다. 그래서 `scripts/kpi-export.ts` 가 JSON 을 뽑고, 그걸 대시보드에 올린다(지금과 같은 수동 갱신). 자동 갱신은 이번 범위가 아니다.

## 이번에 하지 않는 것

- 접속(페이지뷰) 기록. `users.active` 는 「직접 쓴 사람」으로 시작하고, 읽기만 하는 사용자는 2단계에서 다룬다.
- AI 구조화 원본 보관과 수정률, 옴니스 답변 👍·👎, AI 호출 실패율·지연, 카톡 이식 실행 기록. 앞의 계획 메모에서 2~5번으로 둔 것들이다.
- 기존 `ActivityLog` 쓰기는 그대로 둔다.

## 단계

1. **스키마**: `TaskEvent` · `KpiDaily` 모델, 마이그레이션, `via`·`field` Zod union.
   → 검증: 로컬 DB `prisma migrate dev`, `pnpm run verify`
2. **이력 기록**: `lib/task-events.ts`(변경분만 골라 쓰는 함수)를 만들고 위 표의 다섯 경로에 붙인다.
   → 검증: `scripts/verify-task-events.ts`
   - 바꾼 경우 한 줄씩 남는다.
   - **거부 사례**: 같은 값으로 저장하면 0줄, 없는 업무면 0줄.
3. **KPI 계산 · 크론**: `lib/kpi.ts` 와 크론 연결, 백필 스크립트.
   → 검증: 로컬 스냅샷 DB 에서 백필을 돌린다. 몇 개 날짜를 손 쿼리와 대조해서 출력을 보고서에 붙인다.
4. **대시보드**: export 스크립트를 만들고 대시보드를 KPI 화면으로 바꾼다.
5. **검증 보고서와 반영 요청**: `mydocs/working/2026-10-16-kpi-metrics.md`, `pnpm run verify` · `pnpm run build` 출력.
   - 운영 반영 순서: 운영 DB 에 `pnpm run db:deploy` → PR 머지 → 운영 백필 1회
   - **반영과 푸시는 각각 승인을 받은 뒤** 진행한다.

## 비용

월 0원 추가.
- 새 표는 하루 수십~수백 줄이다. 운영 DB 저장량에 견주면 무시할 크기다.
- 계산은 이미 매일 깨우는 크론에 얹어서 Neon 이 깨어 있는 시간이 몇 초 늘 뿐이다.
- AI 호출은 늘지 않는다.

## 열린 결정

- **AI·이식이 바꾼 것의 `actorId`**: 시스템 계정(🤖, `SYSTEM_USER_ID`)을 쓸지 null 로 둘지. 제안은 시스템 계정이다. 이미 AI 글의 작성자로 쓰고 있어서 「사람 몫 / AI 몫」을 같은 기준으로 가를 수 있다.
