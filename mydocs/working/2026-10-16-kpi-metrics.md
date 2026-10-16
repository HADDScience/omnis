---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-16-kpi-metrics.md
last_verified: 2026-10-16
---

# 운영 KPI 수집 1단계 — 구현 · 실측

계획: [`../plans/2026-10-16-kpi-metrics.md`](../plans/2026-10-16-kpi-metrics.md). 브랜치 `feat/kpi-metrics`, 워크트리 `../omnis-kpi`.
운영 반영(마이그레이션 · 머지 · 백필)은 아직 하지 않았다.

## 커밋

```
43bc9ec feat(kpi): 대시보드에 올릴 KPI 를 내보낸다 — 마이그레이션 전 DB 에서도 읽기만으로
133478f feat(kpi): 하루 크론이 운영 지표를 계산해 쌓는다
23ae6d5 feat(kpi): 업무가 바뀌는 다섯 길에서 변경 이력을 남긴다
7a487c2 feat(kpi): 업무 변경 이력·일일 지표 표를 더한다
```

## 만든 것

| 파일 | 하는 일 |
|---|---|
| `prisma/schema.prisma` · `migrations/20261016000000_kpi_metrics` | `TaskEvent` · `KpiDaily` 표 추가. 기존 표는 건드리지 않는다 |
| `lib/schemas/task-event.ts` | `via`·`field` Zod enum (규칙 23) |
| `lib/task-events.ts` | 바뀐 것만 골라 이력을 쓴다. 날짜는 ISO, 담당자는 정렬, 객체는 키 순서와 무관하게 비교 |
| `lib/task-update.ts` · `lib/checklists.ts` · `lib/notifications.ts` · `lib/chat-post.ts` · `lib/omnis-mcp.ts` · `app/api/tasks/route.ts` | 다섯 경로에 이력 기록. `updateTask` 와 체크리스트 함수는 `via` 인자를 받는다(기본 web, MCP 는 mcp) |
| `lib/kpi.ts` | 하루 지표 계산 · 저장 · 크론 진입점 |
| `app/api/cron/daily/route.ts` | 기존 하루 크론에 KPI 일 하나 추가 |
| `scripts/kpi-backfill.ts` · `scripts/kpi-export.ts` | 지난 날짜 채우기, 대시보드용 JSON 내보내기(`--compute` 는 읽기만) |
| `scripts/verify-task-events.ts` · `scripts/verify-kpi.ts` | 검증 |

## 검증 (2026-10-16, 로컬 DB `localhost:5433` — 운영 스냅샷)

### 품질 게이트

```
$ pnpm run verify
✖ 43 problems (0 errors, 43 warnings)      ← main 과 같은 경고 43개, 오류 0
$ pnpm run build
… exit 0
```

### 이력 기록 — `npx tsx --env-file=.env scripts/verify-task-events.ts`

실제 함수(`updateTask` · 체크리스트 · `respondToAction`)를 부른다. Gemini 키를 비워 AI 호출이 나가지 않는다.

```
── 업무 수정 (updateTask)
✓ 할 일 → 진행 중: 한 줄 → [["status","TODO","IN_PROGRESS","web"]]
✓ 거부: 같은 상태로 다시 저장 · 이름만 바꿈 → 0줄 → 0
✓ 담당자 추가: 한 줄 · 정렬된 목록 → [["assignees",["<id>","<id>"]]]
✓ 거부: 같은 담당자를 순서만 바꿔 저장 → 0줄 → 0
✓ 마감 설정: 한 줄 (null → 날짜) → [["deadline",null,"2026-11-30T14:59:59.000Z"]]
✓ 거부: 같은 마감으로 다시 저장 → 0줄 → 0
✓ MCP 로 바꾸면 경로가 mcp → [["REVIEW","mcp",true]]
✓ 거부: 없는 업무 → 오류 · 0줄 → [true,0]
── 체크리스트
✓ 추가: 한 줄 (없음 → 항목) → [["checklist",null,{"done":false,"name":"견적서 받기"}]]
✓ 체크: 한 줄 → [[{"done":false,"name":"견적서 받기"},{"done":true,"name":"견적서 받기"}]]
✓ 거부: 메모만 바꿈 → 0줄 → 0
✓ 삭제: 한 줄 (항목 → 없음) · mcp → [[{"done":true,"name":"견적서 받기"},null,"mcp"]]
── 알림에서 완료 확인
✓ 완료 확인: 검토 → 완료 · notification → [["status","REVIEW","DONE","notification"]]
✓ 거부: 같은 알림을 두 번 눌러도 0줄 → 0
── 비교 규칙 (recordTaskEvents)
✓ Date 와 같은 ISO 문자열은 같은 값 → 0
✓ 키 순서만 다른 객체는 같은 값 → 0
✓ undefined 와 null 은 같은 값 → 0
✓ 여러 변경 중 바뀐 것만 → 1
✓ 정리: 업무를 지우면 이력도 남지 않는다 → 0

✓ 전부 통과
```

첫 실행에서 3건이 실패했다. Postgres JSONB 가 객체 키를 정렬해 돌려주는데, 비교를 `JSON.stringify` 로 했기 때문이다. 시험만 고치지 않고 `lib/task-events.ts` 의 비교도 키 순서와 무관하게 바꿨다. DB 에서 읽은 「이전 값」과 코드가 만든 「이후 값」의 키 순서가 다르면, 바뀌지 않았는데도 한 줄이 남는 버그였을 것이다.

### KPI 계산 — `npx tsx --env-file=.env scripts/verify-kpi.ts`

시험 업무를 2031-01-07(한국 시간)에 만들어 다른 기록과 섞이지 않게 했다.

```
── 이력 지표
✓ 상태 변경 3건 · 경로별 → [3,{"web":1,"notification":1,"chat-ai":1}]
✓ 완료 2건 (되돌린 것도 그날 완료된 사실은 남는다) → [2,{"web":1,"notification":1}]
✓ 완료까지 중앙값 — 2일과 0.5일의 가운데 1.25일 → 1.25
✓ 다시 열림 1건 · chat-ai → [1,{"chat-ai":1}]
── 채택 지표
✓ 직접 입력 2건 · 이식 0건 → [2,0]
✓ 연결 비율 1/2 → 0.5
✓ 그날 직접 쓴 사람 1명 → [1,{"names":["<시험 사용자>"]}]
✓ 그날 생긴 업무 1건 (이틀 전 것은 아니다) → 1
── 넣지 말아야 할 것 (거부)
✓ 거부: 이력 전 날짜에는 이력 지표가 없다 — 0 이 아니라 칸이 없다 → 0
✓ 거부: 상태 스냅샷을 안 넣으면 열린 업무 칸이 없다 → false
✓ 거부: 메시지가 없는 날은 연결 비율 칸이 없다 (0% 로 적지 않는다) → false
✓ 거부: 완료가 없는 날은 중앙값 칸이 없다 → false
✓ 스냅샷을 넣으면 열린 업무 · 조용한 업무 · 체크리스트 남은 완료 세 칸 → 3
── 날짜
✓ UTC 15시는 한국 다음 날 → "2031-01-08"
✓ UTC 14:59 는 한국 그날 → "2031-01-07"
✓ 정리: 시험 이력이 남지 않는다 → 0

✓ 전부 통과
```

경계 시험으로, 한국 시간 그날 0시 1초 전(전날 23:59:59)과 다음 날 0시의 이력을 넣었다. 「상태 변경 3건」에 들어가지 않은 것으로 확인했다.

### 백필 값 대조 — 다른 방식으로 다시 세기

`lib/kpi.ts` 는 「한국 0시 ~ 다음 날 0시」 구간으로 센다. 대조는 `("createdAt" at time zone 'UTC' at time zone 'Asia/Seoul')::date = 날짜` 로 묶어 센다.

```
2026-09-29 손계산 {"native":5,"imported":24,"linked":0.3793,"calls":16}  | KPI {"messages.native":5,"messages.imported":24,"messages.linkedRate":0.3793,"ai.calls":16}
2026-09-30 손계산 {"native":1,"imported":101,"linked":0.7255,"calls":280} | KPI {"messages.native":1,"messages.imported":101,"messages.linkedRate":0.7255,"ai.calls":280}
2026-10-02 손계산 {"native":0,"imported":162,"linked":0.9506,"calls":1720}| KPI {"messages.native":0,"messages.imported":162,"messages.linkedRate":0.9506,"ai.calls":1720}
```

### 크론 진입점 — `runDailyKpis()` 를 로컬에서 직접 호출

```
runDailyKpis → {"days":["2026-10-14","2026-10-15","2026-10-16"],"rows":33}
```

- 어제(10-15)만 상태 세 칸(`tasks.open` 35 · `tasks.stale30` 11 · `tasks.doneOpenChecklist` 76)이 들어갔다. 로컬 스냅샷 기준 값이다.
- 로컬에 이력이 없어 이력 지표는 빠졌다. 의도한 동작이다.

### 운영 숫자 (읽기만)

```
$ npx tsx --env-file=../omnis-local/.env.production.local scripts/kpi-export.ts --from 2025-08-20 --to 2026-10-15 --out kpi_daily.json --compute
4489칸 · 422일 → kpi_daily.json
```

이 파일을 「옴니스 KPI」 대시보드에 올렸다. 운영 DB 에는 아무것도 쓰지 않았다.

## 돌리지 않은 것

- **채팅 AI 경로(`runTaskRebuild`)**: Gemini 응답이 있어야 분기에 들어가서 시험에서 부르지 않았다. 이력을 쓰는 코드는 다른 경로와 같은 `recordTaskEvents` 다.
- **크론 HTTP 호출**: `/api/cron/daily` 는 부르지 않았고, 그 안에서 부르는 `runDailyKpis()` 만 돌렸다.
- **카톡 이식 경로(`via: "import"`)**: `omnis-kakao` 브랜치가 머지된 뒤 그쪽에 붙인다.

## 운영 반영 순서 (승인 필요)

1. 운영 DB 에 `pnpm run db:deploy` — 표 두 개 추가뿐이라 기존 화면에 영향이 없다
2. PR → 머지 (운영 · 데모 배포)
3. 운영 백필 1회: `scripts/kpi-backfill.ts --from 2025-08-20`
4. 다음 날 새벽 크론 결과 확인(`KpiDaily` 에 어제 칸이 생겼는지)
