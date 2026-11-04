---
kind: snapshot
status: active
canonical: mydocs/working/2026-11-02-unassigned-tasks.md
last_verified: 2026-11-02
---

# 담당 미배정 업무를 보이게 — 칩 · 필터 · 바로 지정 · list_tasks

미완료인데 담당자가 없는 업무는 알림도 담당자별 화면도 닿지 않아 묻혔다. list_tasks 에도 필터가 없어 전체를 받아 걸러야 했다.

## 기준

보관 안 됨 + 상태가 DONE 이 아님 + 담당 0명. 판정은 `lib/task-unassigned.ts` 한 곳이고 칩 · 필터 · MCP 가 함께 쓴다. 스키마 변경과 기존 데이터 변경은 없다.

## 동작

- 현황 띠에 「담당 미배정 N」 칩. 누르면 `?filter=unassigned`. 필터 메뉴에도 같은 항목이 있다
- 이 필터의 목록은 마감 지남 → 임박 → 마감 없음 순이다
- 목록 줄의 「담당 지정」 은 한 사람을 고르고 기존 `PATCH /api/tasks/:id` 를 부른다. 업무 상세는 담당이 없을 때 hover 없이 「담당 지정」 을 보인다
- MCP `list_tasks {unassigned:true}`. mine · assignee · status=DONE 과 함께 쓰면 오류다
- 질문 경로 현황 첫 줄에 미배정 건수를, 에이전트 · 질문 경로 안내에 `unassigned=true` 를 넣었다
- 폰에서는 칩 줄이 좁아 숫자가 잘려 「담당 미배정」 · 「멈춤」 을 진행률 앞으로 올렸다. PC 순서는 그대로다

**담당 지정 시 기존 `task_assigned` 알림 · 푸시가 나간다.** 새 발송 경로를 만든 것이 아니라 기존 PATCH 의 동작이다.

## 검증

운영 env 없는 셸에서 실행했다(`DATABASE_URL` 은 `.env` 의 로컬 DB).

```
typecheck  exit 0
lint       exit 0 · ✖ 40 problems (0 errors, 40 warnings)
test:unit  tests 311 · pass 311 · fail 0
build      exit 0
```

e2e 는 로컬에서 돌리지 않았다(PR CI 에서 돈다). 화면은 운영을 읽기 전용으로 덤프해 가린 별도 DB 에서 푸시 키를 비우고 Playwright 로 확인했다.

| 확인 | 결과 |
|---|---|
| 칩 · 필터 건수 | 8 / `업무 · 8` |
| 정렬 | 마감 「오늘」 이 맨 위, 마감 없음 7건이 뒤. 「지남」 은 단위 시험으로 확인 |
| 지정 후 | 줄이 빠지고 칩 · 툴바 7, `TaskEvent assignees/web` 기록 |
| 폰 390 · 320 칩 | 칸 왼쪽부터 담당 미배정(13~113px) · 멈춤(119~194px), 잘림 없음, 페이지 가로 넘침 0 |
| PC 1440 칩 | 멈춤 → 담당 미배정 → 사람 순서 그대로 |
| MCP | `unassigned` 7건, `mine` 과 함께 쓰면 오류, 플래그 없으면 전체 713건 |
| 운영 대조(읽기 전용) | 같은 기준에서 건수 · 업무 ID 7개 일치 |

## 범위 밖 제안

- 미배정 업무가 생기면 지시자에게 알리거나 일일 요약에 넣기
- 카드 구조화에서 수신인 호칭을 담당 후보로 제안하기
- 보드 카드에서 바로 지정(드래그와 충돌 확인 필요)
