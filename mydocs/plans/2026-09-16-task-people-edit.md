---
kind: decision
status: active
canonical: mydocs/plans/2026-09-16-task-people-edit.md
last_verified: 2026-09-16
---

# 2026-09-16 — 업무의 담당자 · 지시자를 나중에 고칠 수 있게

## 왜

업무를 만들 때 담당자와 지시자가 정해지고, **그 뒤로는 어디서도 바꿀 수 없다.**

| 자리 | 지금 |
|---|---|
| 생성 | `app/api/tasks/route.ts:182` — 지시자는 `/업무` 를 친 사람(`session.user.id`), 담당자는 모달에서 고른 사람 |
| 수정 | `lib/task-update.ts:12` `UpdateTaskInput` 에 사람 필드가 **없다** — 상태 · 이름 · 우선순위 · 마감 · 배경 · 프로젝트 · 제품만 |
| 화면 | `task-detail.tsx:243` 담당자 이름, `:246` 「지시: 이름」 — 둘 다 읽기 전용 |
| MCP | `update_task` 도 같은 `updateTask` 를 부르므로 마찬가지 |

2026-09-16, 작업지시자가 운영(`haddscience.vercel.app/omnis`)에서 시험하다 지시자와 담당자를 반대로 넣은 업무가 생겼다.
로직은 정상이고 입력이 반대였는데, **고칠 방법이 화면에 없어 DB 를 직접 만져야 하는 상황**이 됐다.

운영 DB 를 손으로 고치는 대신 화면에서 고친다 — 같은 실수가 다시 나면 또 DB 를 열어야 하기 때문이다.

## 범위

스키마 변경 없음. `TaskAssignee` 표는 이미 있고, 바뀌는 것은 그 행들과 `Task.instructorId` 뿐이다.

| # | 무엇 | 파일 |
|---|---|---|
| 1 | `UpdateTaskInput` 에 `assigneeIds?: string[]` · `instructorId?: string` 추가. 트랜잭션에서 `TaskAssignee` 를 갈아끼우고 지시자를 바꾼다 | `lib/task-update.ts` |
| 2 | 검증 — 담당자 최소 1명, 실재하는 사용자, 시스템 계정 제외, 지시자는 1명 | `lib/task-update.ts` |
| 3 | 새로 담당이 된 사람에게 `task_assigned`(수락 필요) 알림. 빠진 사람에게는 보내지 않는다 | `lib/task-update.ts` |
| 4 | 업무 상세에서 담당자 칩 토글 · 지시자 선택 | `app/(main)/tasks/[taskId]/task-detail.tsx` |
| 5 | 활동 기록에 바뀐 사람을 남긴다 (`task.updated` metadata) | `lib/task-update.ts` |

**범위 밖:** MCP `update_task` 인자 확대(뒤로 미룬다), 권한 제한(지금 다른 필드도 로그인만 하면 고칠 수 있다 — 여기만 다르게 하지 않는다).

## 단계

```
1. lib/task-update.ts 확장          → verify: 타입 통과 + 로컬에서 PATCH 호출로 두 사람 교체
2. task-detail UI                   → verify: 로컬 dev 에서 담당자·지시자 바꿔 보고 새로고침 후 유지 확인
3. 알림 · 활동 기록                  → verify: 바뀐 담당자 계정에 알림이 뜨는지 로컬에서 확인
4. npm run verify + 문서             → verify: 출력 첨부, ux-rules 에 한 줄
```

## 그다음 (운영의 잘못된 업무)

배포 뒤 **작업지시자가 화면에서 직접 고친다.** 운영 DB 직접 수정은 하지 않는다 — 화면에 길이 생기면 그쪽이 안전하고 기록도 남는다.
