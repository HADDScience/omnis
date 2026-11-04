---
kind: snapshot
status: active
canonical: mydocs/plans/2026-11-04-active-assignees.md
last_verified: 2026-11-04
---

# 담당자 후보는 재직자만 — 결과와 실측

계획: [`../plans/2026-11-04-active-assignees.md`](../plans/2026-11-04-active-assignees.md).

## 운영 현황 (읽기 조회, 2026-11-04)

| 이름 | isActive | 인력 표 | 담당 업무 수 | 후보 |
|---|---|---|---|---|
| 김아리 | true | EMPLOYED | 131 | 나옴 |
| 노혜린 | true | EMPLOYED | 186 | 나옴 |
| 윤훈 | true | EMPLOYED | 32 | 나옴 |
| 정우창 | true | EMPLOYED | 420 | 나옴 |
| 허찬 | true | EMPLOYED | 4 | 나옴 |
| 허채정 | true | EMPLOYED | 31 | 나옴 |
| 박소정 | false | FORMER | 91 | 빠짐 |
| 주용석 | false | FORMER | 86 | 빠짐 |
| 주진호 | false | 없음 | 49 | 빠짐 |
| Omnis(시스템) | false | 없음 | 0 | 빠짐 |

두 칸이 어긋나는 사람은 없다. 계정 없는 인력 표의 퇴사자(사니 아마르 · 현튜이)는 원래 후보가 아니다.

## 경로별 변경

| 경로 | 전 | 후 |
|---|---|---|
| 업무 상세 — 담당자 칩 · 지시자 선택 | **퇴사자 전원 노출** | 재직자 + 이 업무에 걸린 사람(표시) |
| AI 초안 `/api/ai/structure-task` 프롬프트 | **퇴사자 포함** | 재직자 |
| 업무 생성 `POST /api/tasks` ownerNames | **퇴사자로 해석됨** | 재직자만 |
| 업무 생성 `POST /api/tasks` ownerIds | **검사 없음** | 재직자 아니면 400 |
| 업무 수정 `PATCH /api/tasks/[id]` · MCP update_task | **퇴사자 허용** | 새로 고르는 사람은 재직자만 |
| 사람 방 @ 후보 · 멘션 알림 | **떠난 참여자 포함** | 재직 참여자만(참여자 이름 · 수는 그대로) |
| 목록 검색칸 | 담당 4명 이상이면 뒤 이름 못 찾음 | 전체 이름 |

같은 판정으로 통일(이미 isActive 라 지금 결과는 같고, 인력 표 퇴사까지 본다): `/api/users`(/업무 모달 · 전사방 @ · 업무 스레드 @ · 사람 고르기),
담당 칩 · 「담당 지정」(`load-overview`), AI 말로 고치기 `revise-task-draft`, MCP `create_task` · `list_members` · 옴니스 에이전트(같은 도구), 사람 방 만들기 · 초대.

손대지 않아도 맞는 곳: /업무 모달의 AI 이름 매칭(`matchUserByName`, `/api/users` 안에서만 찾는다). 카드 · 보드 · 상세의 담당자 표시는 저장된 행을 그대로 읽는다.

## 실측

```
$ pnpm run verify        → exit 0 · ✖ 39 problems (0 errors, 39 warnings)
$ pnpm run test:unit     → pass 395 · fail 0  (lib/active-members.test.ts 11건 포함)

$ pnpm run test:e2e:local tests/feature/{active-assignees,tasks,tasks-overview,chat-task,people-rooms,room-composer}.spec.ts
  37 passed · 1 skipped(Gemini 라이브)

MCP findUsers (로컬 스냅샷)
  재직자 이름:            찾음 1
  퇴사자 이름 셋:         찾음 0 · 없음 [주용석, 박소정, 주진호]
  이미 담당인 퇴사자(keep): 찾음 1
```

## 한계

- `active-assignees.spec.ts` 의 퇴사자 시험 7건은 DB 에 직접 넣어 `E2E_ISOLATED` 에서만 돈다 — **CI 에서는 건너뛴다.** 로컬 러너에서 돌린 결과다
- AI 경로는 프롬프트를 실제로 Gemini 에 보내 보지 않았다. 후보 조회 조건이 재직자를 돌려주는 것만 운영 읽기로 확인했다
