---
kind: canonical
status: active
canonical: mydocs/tech/chat-post.md
last_verified: 2026-09-15
---

# 채팅 쓰기 경로 — `lib/chat-post.ts`

채팅 · 업무 스레드 · MCP `post_message` 가 글을 쓰는 길은 이 파일 하나다. `#슬러그` 해석 · 스레드 연결 ·
멘션 · AI 재구성 · 상태 변경 · 알림 · 🤖 시스템 메시지가 전부 여기서 일어난다.
MCP 전용 지름길을 만들지 않는 이유는 [omnis-mcp.md](omnis-mcp.md) 「쓰기는 화면과 같은 길로만」 에 있다.

2026-09-15(PR #16)에 저장과 AI 재구성을 두 함수로 나눴다. 재구성은 예전 실측 8~13초, PR #16 점검에서는
Gemini 호출만 약 45초(7,006 토큰)였다. 그동안 스레드 입력창이 막혀 있었다.

## 두 함수

| 함수 | 하는 일 | 던지나 |
|---|---|---|
| `postChatMessage(input, { deferRebuild })` | 방 upsert · 메시지 저장 · 파일 연결 · `ChatMention` 저장 · 업무 연결 · 임베딩(백그라운드) | 던질 수 있다 (응답 전이다) |
| `runTaskRebuild(job)` | AI 재구성 · 상태 변경 · 완료 확인 요청 · 알림 · 🤖 메시지 · 끝 기록 | **던지지 않는다** |

- `deferRebuild: true` 면 재구성할 일을 `rebuild`(`RebuildJob`)로 돌려주고 끝난다. 호출한 쪽이 응답 뒤에 `runTaskRebuild` 를 돌린다.
- `deferRebuild` 가 없으면 안에서 `runTaskRebuild` 를 기다리고 `taskUpdate` 를 돌려준다.
- `runTaskRebuild` 는 응답 뒤에 돌 수 있어 받아 줄 사람이 없다. 그래서 던지지 않고, 실패하면 스레드에
  「🤖 업무 갱신에 실패했습니다 — 잠시 뒤 다시 한 번 적어 주세요」 한 줄을 남긴다.

## 누가 어떻게 부르나

| 호출 | 방식 | 왜 |
|---|---|---|
| `POST /api/chat/messages` (화면) | `deferRebuild: true` → `next/server` 의 `after()` 로 `runTaskRebuild`. `maxDuration = 60`. 응답에 `_rebuild: "queued"` | 글은 바로 보이고 입력창을 막지 않는다 |
| MCP `post_message` | 기다린다 | 결과(재구성 요약)를 도구 응답 글로 돌려줘야 한다 |

## 업무를 어떻게 고르나

1. **스레드 연결(`taskId`)이 먼저다.** 스레드 안에서 다른 업무를 `#멘션` 해도 메시지는 그 업무로 옮겨 가지 않는다 — 스레드 안의 멘션은 참조다(PR #9).
2. `taskId` 가 없으면 본문의 첫 `#슬러그`. 재구성에 넘기는 글은 태그를 뺀 나머지다.
3. **채팅에서 완료(`DONE`) 업무를 `#멘션` 한 것은 참조만이다.** 메시지 · 파일은 업무에 잇고, 재구성 · 상태 변경 · 알림은 없다.
   예전에는 재구성의 「진행 중이 아니면 진행 중으로」 규칙이 완료를 풀었다(PR #9). 완료 업무의 **스레드에 직접** 쓴 글은 예전처럼 재구성한다.
4. 태그를 뺀 글이 비어 있으면 연결만 하고 재구성하지 않는다.

## 재구성 결과와 끝 기록

`runTaskRebuild` 는 무엇으로 끝나든 `finally` 에서 활동 기록을 하나 남긴다.

```
action   task.rebuild.finished   (REBUILD_FINISHED_ACTION)
entity   task · entityId = 업무 id
metadata { messageId, outcome }
```

| outcome | 뜻 |
|---|---|
| `rebuild` | 카드 재구성 — 이름 · 배경 · 기대결과 · 우선순위 · 체크리스트 전체 교체. 진행 중이 아니면 진행 중으로. 체크리스트가 전부 체크면 완료 확인 요청 |
| `complete` | 담당자 전원에게 완료 확인 요청(`task_done_confirm`). 상태는 바꾸지 않는다 |
| `pause` · `resume` | 할 일 · 진행 중으로 바꾸고 관련자에게 알림 |
| `info` · `none` | 아무것도 바꾸지 않는다 |
| `superseded` | 더 새 글이 있어 결과를 버렸다 (아래) |
| `task_missing` | 업무가 사라졌다 |
| `failed` | 예외. 스레드에 실패 한 줄 |
| `fallback_complete` · `fallback_pause` · `fallback_resume` · `fallback_none` | `GEMINI_API_KEY` 가 없어 정규식으로 분류 |

결과가 있으면(`taskUpdate`) 시스템 계정 이름으로 🤖 메시지를 남긴다. `kind` 는 `TASK_REBUILT` · `TASK_DONE_PENDING` 또는 `NORMAL`.

### 늦게 끝난 옛 결과는 버린다 — `superseded`

진행 보고 · 완료 보고를 연달아 보내면 재구성 두 개가 동시에 돈다. 먼저 보낸 글의 재구성이 늦게 끝나면
나중 결과를 덮는다. 그래서 Gemini 응답을 받은 뒤, 쓰기 전에 **같은 업무에 이 글보다 새로운 사람의 `NORMAL` 메시지**
(시스템 계정 제외)가 있는지 본다. 있으면 아무것도 쓰지 않고 `superseded` 로 끝낸다. 새 글의 재구성이 이 글까지 읽고 반영한다.

- 2026-09-15 킥오프 시나리오: 정우창 진행 보고의 재구성이 27초 뒤 끝났지만, 8초에 반영된 완료 결과를 덮지 않았다.
- 이 확인은 Gemini 경로에만 있다. 정규식 대체 경로는 즉시 끝나 확인하지 않는다.
- Gemini 호출은 이미 끝난 뒤라 비용은 든다.

## 끝을 묻는 API — `GET /api/tasks/[taskId]/rebuild-status?messageId=`

- 로그인 필요(401), `messageId` 없으면 400.
- 그 업무의 `task.rebuild.finished` 기록 중 **최근 10분 · 최신 30건**에서 `metadata.messageId` 가 같은 것을 찾는다.
- 응답 `{ done: boolean, outcome: string | null }`. `superseded` · `failed` 도 `done: true` 다.

## 화면이 어떻게 기다리나

| 화면 | 표시 | 묻는 간격 | 끝나면 |
|---|---|---|---|
| 업무 스레드 (`app/(main)/tasks/[taskId]/task-sidebar.tsx`) | 「옴니스가 업무를 갱신하고 있어요」 한 줄. 입력창은 막지 않는다 | 1.5초 뒤 첫 확인, 이후 2초 | `router.refresh()`. 재구성 결과는 스레드에 사건 줄로 보인다 |
| 채팅 패널 (`components/chat/chat-panel.tsx` `waitForRebuild`) | 「#슬러그 업무를 분석하고 있습니다...」 | 2초 | 메시지 · 업무 목록 다시 읽기 |

- 둘 다 **90초 상한**이다. 넘으면 표시를 거두고, 결과는 새로고침 · 폴링으로 들어온다.
- 스레드 입력창(`components/chat/thread-composer.tsx`)은 응답의 `_rebuild === "queued"` 일 때만 `onQueued(messageId)` 를 부른다.

## 알려진 한계

- **채팅 패널의 「분석 중」 표시는 하나(`processing`)다.** 재구성 두 건을 연달아 기다리면 먼저 끝난 쪽이 표시를 지운다.
- **`after()` 는 함수 수명(`maxDuration 60`) 안에서만 돈다.** 한 번에 약 45초가 걸린 적이 있다. 60초를 넘기면 끝 기록이 남지 않을 수 있고,
  그때 화면은 90초 상한으로 거둔다.
- MCP 는 재구성을 기다리므로 도구 호출 시간이 Gemini 시간만큼 길다.

## 관련

- 겪은 문제와 순서: [troubleshootings/pr-traps-2026-09.md](../troubleshootings/pr-traps-2026-09.md) PR #9 · #16
- 🤖 메시지 작성자(시스템 계정): [omnis-mcp.md](omnis-mcp.md)
- 폴링 간격과 요청 한도: [request-budget.md](request-budget.md)
