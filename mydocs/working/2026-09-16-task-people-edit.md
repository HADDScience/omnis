---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-16-task-people-edit.md
last_verified: 2026-09-16
---

# 2026-09-16 — 담당자 · 지시자 변경 (검증)

계획: [plans/2026-09-16-task-people-edit.md](../plans/2026-09-16-task-people-edit.md)
브랜치 `feat/task-people-edit` · 커밋 `220d7fa`

## 바뀐 것

| 파일 | 무엇 |
|---|---|
| `lib/task-update.ts` | `UpdateTaskInput` 에 `assigneeIds` · `instructorId`. 담당자는 통째로 교체(`deleteMany` + `create`), 시스템 계정 · 없는 사용자 거부, 새 담당자에게만 `accept_task` 알림, 활동 기록 metadata 에 바뀐 사람 |
| `app/(main)/tasks/[taskId]/page.tsx` | 고를 사람 목록(`users`) 조회 — 🤖 시스템 계정 제외 |
| `app/(main)/tasks/[taskId]/task-detail.tsx` | 담당자 칩 토글 · 지시자 셀렉트 · 저장/취소. 평소에는 hover 로 나타나는 연필 하나 |

## 품질 게이트

```
$ npm run verify      # typecheck → lint
✖ 41 problems (0 errors, 41 warnings)   # 경고는 전부 기존 scripts/ · tests/ 의 미사용 변수
```

## 실측 — 로컬 dev(3003) · DB `omnis_chat_check`

업무 `[09150209] 자가검사 앱 화면 프로토타입 제작` 에서 **담당자 정우창 → 노혜린**, **지시자 김아리 → 허채정** 으로 바꾸고 저장.

```
$ psql -c "select t.name, ui.name instructor, (…assignees…) from Task t …"
[09150209] 자가검사 앱 화면 프로토타입 제작 | 허채정 | 노혜린

$ psql -c "select u.name, n.type, n.content, n.actionType … from Notification …"
노혜린 | task_assigned | 정우창님이 담당자로 지정했습니다. | accept_task | 01:25:56

$ psql -c "select action, title, metadata from ActivityLog order by createdAt desc limit 1"
task.updated | 업무 수정: [09150209] 자가검사 앱 …
{"status": "TODO", "assigneeIds": ["758191f7-…"], "instructorId": "627535b6-…"}
```

화면도 저장 직후 「노혜린 / 지시: 허채정」 으로 바뀌었다.

- 빠진 사람(정우창)에게는 알림이 가지 않았다 — 의도한 대로.
- 새 담당자 알림은 생성 때와 같은 `accept_task` 라, 노혜린이 수락할 때까지 남는다.

## 아직 안 한 것

- MCP `update_task` 인자에는 더하지 않았다. 화면에서만 바꾼다.
- 권한 제한을 두지 않았다 — 이름 · 마감 · 상태와 같은 규칙(로그인하면 고칠 수 있다)을 따른다.
