---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-29-push-notifications.md
last_verified: 2026-10-29
---

# 채팅 · 업무 · 일정 푸시와 켜고 끄기 — 구현 · 실측

계획: [`../plans/2026-10-29-push-notifications.md`](../plans/2026-10-29-push-notifications.md) (작업지시자 결정 1~5 · 받는 사람 규칙 · 스키마).
브랜치 `feat/push-notifications`, 워크트리 `../omnis-push`(origin/main 9fb4ffb 위). push 하지 않았다.

## 커밋

| 커밋 | 내용 |
|---|---|
| `f73d9b7` | 받는 사람 규칙(`lib/notify-rules.ts`) · 시험 14건 · 스키마 추가(`ChatRoomPref.muted` · `NotificationPref`) · Zod |
| `9d81387` | 발송 배관 — 종류 설정 · 여러 사람 한 번에(`deliverPush`) · 발송 기록 · dry run · service worker(보는 방 · renotify) · 시험 4건 |
| `ddca740` | 채팅 글 · 옴니스 답 푸시 · 방별 알림 끄기(API · 목록 메뉴 · 밀기 칸 · 머리줄) |
| `146d2c1` | 업무 지정 경로를 `assignmentTargets` 하나로 · 새 일정 알림 · 캘린더 `?day=` · 크론에 캘린더 동기화 |
| `b623ada` | 마이 → 기기 알림: 이 기기 구독 상태 · iOS 안내 · 채팅 · 업무 · 일정 스위치 |
| `f3f1524` | `createNotification` 의 푸시도 응답 뒤(`after()`)로 |
| (이 문서가 든 커밋) | 검증 스크립트 · 스크린샷 · 결과 문서 · calendar.md 4b · ux-rules |

## 새 마이그레이션

`prisma/migrations/20261029050000_push_prefs/migration.sql` 하나 — 추가만.

```sql
ALTER TABLE "ChatRoomPref" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "NotificationPref" ("userId" TEXT PRIMARY KEY, "chatPush" BOOLEAN NOT NULL DEFAULT true,
  "taskPush" BOOLEAN NOT NULL DEFAULT true, "calendarPush" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL, FK → User ON DELETE CASCADE);
```

로컬 DB(5433 `omnis`)와 e2e 용 `omnis_test` 에만 적용했다. **운영 migrate 는 하지 않았다** — 머지 전에 `pnpm run db:deploy`.
SQL 은 `prisma migrate diff --from-url <로컬> --to-schema-datamodel` 로 뽑아 확인한 그대로다(다른 차이 없음).

## 결정별로 무엇을 했나

### 1. 채팅 푸시 — 모든 방 · 모든 글 · 기본 켜짐

- `lib/chat-push.ts` `queueChatPush` — 전사방 · 업무방 글은 `postChatMessage`(화면 · MCP `post_message` 가 같이 지난다),
  사람 1:1 · 단톡방 글은 `postPeopleMessage` 에서 부른다. 벨 행은 만들지 않는다
- 받는 사람(정본 `chatRecipients`):

  | 방 | 받는 사람 |
  |---|---|
  | 전사방 | 활성 구성원 전원 |
  | 업무방 | 담당자 · 지시자 + **그 업무방에 글을 쓴 적 있는 사람** + **그 업무방을 즐겨찾기한 사람** |
  | 사람 1:1 · 단톡방 | 참여자 |

  빼는 사람: 글쓴이 · 시스템 계정(그리고 시스템 계정 글은 아무에게도) · 방을 끈 사람 · 채팅 알림을 끈 사람 · 같은 글로 멘션 받는 사람 · 떠난 사람.
  전사방에서 `#슬러그` 로 이은 글은 쓴 자리(전사방) 글로 친다. `/업무` · MCP `create_task` 가 올리는 지시 원문 · 업무 카드는 채팅 푸시를 내지 않는다(담당자는 task_assigned 를 받는다)
- 방별 끄기: `ChatRoomPref.muted`(방 키 단위라 전사방 · 업무방도 된다). `PATCH /api/chat/prefs { roomKey, muted }` —
  목록 꾹 누르기 메뉴 · 왼쪽→오른쪽 밀기 칸(즐겨찾기 · **알림** · 폴더) · 네 종류 방 머리줄(`RoomMuteButton`). 꺼진 방은 목록 · 머리줄에 빗금 종
- 멘션은 지금처럼 벨 + 푸시. **방을 꺼도 멘션 푸시는 간다**(채팅 알림 전체를 끄면 멈춘다)
- 보고 있으면 안 띄운다: 페이로드의 `roomPath` 를 service worker 가 포커스 · 보이는 창의 주소와 비교(basePath 포함). 방마다 tag `omnis:chat:<방 키>` + `renotify`
- 내용: 제목 = 방 이름(업무방 `# 업무명`, 1:1 은 보낸 사람), 본문 = 「보낸 사람: 앞 60자」, 누르면 그 방
- 빠르게: 응답 뒤(`after()`)에 보낸다. 질의는 사람 수와 상관없이 후보 1~3 · 활성/끈 방/끈 종류 3(병렬) · 구독 1. 발송만 병렬, 한 건 10초 시간 제한

### 2. 옴니스 답 푸시

`lib/agent/store.ts` `savePass` 의 끝 셋 — 답 저장(DONE) · 확인 카드(AWAITING_APPROVAL, 「확인이 필요해요」) · 한도 멈춤(LIMIT) — 에서
`dispatchAgentPushSafe`. 방 주인에게, 방 끄기 · 채팅 알림 끄기를 따른다. 보고 있으면 service worker 가 거른다. Workflow 단계라 기다려 보내되 오류는 삼킨다.

### 3. 일정 알림

`lib/caldav/sync.ts` 가 새로 만든 행(`createManyAndReturn`)을 모아 응답 뒤에 `lib/calendar-notify.ts` 로 넘긴다.
첫 성공 동기화(`syncedAt` 없음)는 건너뛴다 · 공개 범위를 넓혀도 행이 새로 생기지 않아 조용하다 · 마스터만 · 취소 · 끝난 일정 제외 ·
audience ALL=전원 / ADMIN=관리자 · 주최자 본인 제외 · 4건 이상이면 하나로 묶음. 벨(`calendar_event_added`) + 푸시, 누르면 `/calendar?day=YYYY-MM-DD`.
**크론은 그동안 캘린더를 당기지 않았다** — 하루 한 번 `/api/cron/daily` 에 동기화를 더했다(새 크론 없음).

### 4. 업무 알림 — 지정 경로 점검

| 경로 | 지나는 곳 | 점검 결과 |
|---|---|---|
| 화면 업무 생성 · 채팅 `/업무` · AI 초안 확인 | `POST /api/tasks` | 알림은 있었다. **같은 담당자 id 가 두 번 오면 업무 생성이 500** 이었다(`P2002` `["taskId","userId"]`, 아래 실측) — 처음에 중복을 걷는다 |
| 화면 업무 수정(담당자 바꾸기) | `updateTask` | 있었다 |
| MCP `update_task` · 에이전트 확인 카드 `update_task` | `runTool` → `updateTask` | 있었다 |
| MCP `create_task` · 에이전트 확인 카드 `create_task` | `runTool("create_task")` (에이전트는 `executeWrite` → `runTool`) | 있었다 |
| `#슬러그` 재구성 | `runTaskRebuild` | 담당자를 바꾸지 않는다(`TaskRebuildResult` 에 담당자 칸 없음) — 지정이 없다 |

**task_assigned 가 빠진 경로는 없었다.** 자기 지정 제외 · 중복 제외가 세 곳에서 따로 구현돼 있어 `assignmentTargets` 하나로 모았다.

### 5. 설정 — 마이 → 기기 알림 탭

- 맨 위에 이 기기 상태 한 줄(「이 기기는 알림을 받고 있습니다 · 받는 기기 N대」 / 「받지 않습니다 · 다른 기기 N대는 받는 중」)
- 구독 안 됨이면 「이 기기에서 알림 받기」(있던 `subscribeToPush` · `/api/push/subscriptions`)
- iOS 이고 홈 화면 앱이 아니면 「홈 화면에 추가한 Omnis 앱에서만 알림을 받을 수 있습니다」 안내
- 「받을 알림」 카드 — 채팅 · 업무 · 일정 스위치(`GET/PATCH /api/notification-prefs`). **끄면 푸시만 멈추고 벨 기록은 남는다**(벨 행은 먼저 만들고 푸시 직전에 설정을 본다)
- column_review · website_inquiry · crm_invoice_request 는 설정과 상관없이 간다(종류 없음)

## 검증 — 실측

### verify · 단위 시험

```
$ pnpm run verify
✖ 37 problems (0 errors, 37 warnings)        ← 경고는 기존 것(내 파일에서 0)

$ pnpm run test:unit
ℹ tests 165
ℹ pass 165
ℹ fail 0
```

새 시험: `lib/notify-rules.test.ts` 14건(방 종류별 · 끄기 · 작성자 · 시스템 · 설정 · 업무 지정 · 일정 첫 동기화 · 묶음),
`lib/sw-push.test.ts` 4건(sw.js 를 vm 에 올려 보는 방 · 다른 방 · 백그라운드 · basePath · renotify).

### 발송 기록 — 실제 코드 경로, 누구에게 무엇이 나갔나

`deliverPush` 가 `PUSH_LOG_FILE` 에 한 사람 한 줄을 남기고, `PUSH_DRY_RUN=1` 이면 푸시 서비스에 보내지 않는다(로컬 DB 는 운영 스냅샷이라 실제 구독이 있다).

```
$ GEMINI_API_KEY= PUSH_DRY_RUN=1 PUSH_LOG_FILE=… pnpm exec tsx --env-file=.env scripts/verify-notify.ts

[1] 전사방 — 구성원 전원 − 글쓴이 − 방 끈 사람 − 채팅 끈 사람
  ✓ 받은 사람 = 활성 19명 − A(글쓴이) − B(방 끔) − C(채팅 끔) = 16명
  ✓ 모두 chat 종류 · 방 tag · 방 주소
  ✓ 본문 = 「보낸 사람: 앞부분」 · 제목 = 방 이름
  ✓ 벨 행(Notification)은 만들지 않는다
[2] 업무방 — 담당 · 지시 · 글쓴 사람 · 즐겨찾기만
  ✓ 받은 사람 = {A 지시, B 담당, F 글쓴, G 즐겨찾기} (D 글쓴이 제외) — 실제 A,B,F,G
  ✓ 업무와 무관한 구성원 · 방을 끈 전사방 설정과 상관없다
  ✓ 업무방 주소 · 제목 # 업무명
  ✓ B 가 업무방을 끄면 B 만 빠진다 — 실제 A,F,G
  ✓ 전사방에서 #슬러그 로 쓴 글은 전사방 받는 사람(전원)에게
[3] 사람 1:1 · 단톡방 — 참여자만, 멘션 받는 사람은 멘션으로 한 번
  ✓ 1:1 은 상대(B)만 · 제목 = 보낸 사람 · 본문 = 앞부분
  ✓ 단톡방 채팅 푸시 = {B, F} (D 는 멘션으로) — 실제 B,F
  ✓ D 는 멘션 푸시 한 번(chat 종류 · 그 방 주소 · 벨 행 있음)
  ✓ D 의 벨에 chat_mention 이 남는다
  ✓ D 에게 같은 글로 두 번 가지 않는다
  ✓ 방을 끈 D 도 멘션 푸시는 받는다
  ✓ 방을 끈 D 는 일반 글을 받지 않는다 — 실제 B,F
[4] 시스템 계정 글 · 옴니스 답
  ✓ 시스템 계정 글은 아무에게도 가지 않는다
  ✓ 확인 카드 · 답 → 방 주인 A 에게 두 번
  ✓ 확인 카드 본문 「확인이 필요해요」 · 답 본문은 기호를 뗀 앞부분
  ✓ 옴니스 방을 끄면 답 푸시도 멈춘다
  ✓ 채팅 알림을 끈 C 에게는 옴니스 답 푸시도 가지 않는다
[5] 업무 지정 — 자기 지정 · 중복 · 이미 담당 · 업무 알림 끔
  ✓ updateTask 저장 성공
  ✓ 화면 · MCP update_task 경로: G 한 명만 — 실제 G
  ✓ G 의 벨에 task_assigned(수락 대기) 한 건
  ✓ 순서만 바꾸면 아무도 받지 않는다
  ✓ 업무 알림을 끈 E — 푸시는 막히고(pref_off) 벨 행은 남는다
  ✓ E 의 벨에 task_assigned 가 있다
  ✓ MCP create_task 성공
  ✓ MCP · 에이전트 create_task: {B, F} 한 번씩 (A 자기 제외) — 실제 B,F
  ✓ 지시 원문 · 업무 카드는 채팅 푸시를 내지 않는다(task_assigned 와 겹친다)
[6] 일정 — 첫 동기화 제외 · 마스터만 · audience
  ✓ 첫 동기화: 행은 생기지만 알림 0
  ✓ 두 번째 동기화: 새로 생긴 행은 새 일정 하나(있던 일정 고침은 새 행이 아니다)
  ✓ audience ALL: 활성 전원 − 주최자 F = 18명
  ✓ 벨에도 남는다 · 누르면 그 날짜(entityId = YYYY-MM-DD:<id>) · 반복 표시
  ✓ 푸시 주소 /calendar?day=
  ✓ audience ADMIN: 관리자 9명만(시험 A 포함, B~G 제외)
  ✓ 일정 알림을 끈 A — 푸시만 막히고(pref_off) 벨은 남는다

37 통과 · 0 실패
```

시험 사람 · 방 · 업무 · 캘린더는 끝에 지웠다(잔여 0 — `User like '__vn%'` · 시험 방 · 업무 · `ExternalCalendar provider='verify'` · `NotificationPref` 모두 0건).

### HTTP — 실제 라우트(응답 뒤 `after()` 발송 포함)

dev: `GEMINI_API_KEY= PUSH_DRY_RUN=1 PUSH_LOG_FILE=… OMNIS_AGENT_APPROVAL_SECRET=<로컬 임시값> NEXTAUTH_URL=http://localhost:3106 pnpm next dev --webpack -p 3106`
(`env -u GEMINI_API_KEY` 는 Next 가 `.env` 에서 다시 읽어 키가 살아난다 — 빈 값으로 덮었다)

```
$ BASE=http://localhost:3106 PUSH_LOG_FILE=… pnpm exec tsx --env-file=.env scripts/verify-notify-http.ts
[1] 종류별 설정 API
  ✓ 로그인 없이 401
  ✓ 행이 없으면 전부 켜짐
  ✓ 업무만 끈다 → 나머지는 그대로
  ✓ 바꿀 것 없는 PATCH 400
  ✓ 불리언이 아니면 400
[2] 방 알림 끄기 API · 목록 표시
  ✓ B 가 전사방 알림 끄기 200 · muted=true
  ✓ B 의 방 목록에 muted=true 로 온다
  ✓ 남의 1:1 방은 끌 수 없다(없는 방과 같은 404)
  ✓ muted 가 불리언이 아니면 400
[3] 채팅 글 — 라우트 응답 뒤(after) 발송
  ✓ 글쓰기 201 (866ms)
  ✓ 받은 사람 13명 = 활성 15명 − A(글쓴이) − B(방 끔)
[4] 화면 업무 생성 · 수정 — 담당자 지정
  ✓ 같은 담당자 id 가 두 번 와도 업무 생성 201(예전에는 500)
  ✓ B 에게 한 번만 · A(지시자 자신)는 없음
  ✓ 담당자 바꾸기 200
  ✓ 새로 된 C 에게만
[5] 화면
  ✓ /calendar?day= 200
  ✓ 시험 알림은 dry run 이라 보내지 않고 200
17 통과 · 0 실패
```

「예전에는 500」 의 근거 — 같은 사용자를 담당자로 두 번 넣어 직접 만들어 봤다:

```
실패 P2002 {"modelName":"Task","target":["taskId","userId"]}
```

라우트는 slug 충돌이 아닌 P2002 를 다시 던진다 → 500.

### 옴니스 답 · 확인 카드 — 실제 모델 2회(gpt-6.1-sol, 합계 18.02원)

```
POST /api/agent/rooms {"content":"도구를 쓰지 말고 「푸시 시험」 이라고 한 줄로만 답해 줘"}  → AgentRun DONE · 14.41원
{"category":"chat","outcome":"dry_run","title":"옴니스 · 도구를 쓰지 말고 「푸시 시험」 이라고 한 줄로만 답해…",
 "body":"푸시 시험","tag":"omnis:chat:room:1b82c6b6-…","url":"/chat/1b82c6b6-…","roomPath":"/chat/1b82c6b6-…"}

POST /api/agent/rooms {"content":"다른 조회 없이 바로 create_task 로 업무를 만들어 줘. 이름 「푸시 확인 카드 시험」, 담당 정우창"}
  → AgentRun AWAITING_APPROVAL · AgentStep create_task PENDING · 3.61원
{"category":"chat","outcome":"dry_run","title":"옴니스 · 다른 조회 없이 바로 create_task 로 업무를 …",
 "body":"확인이 필요해요 — 옴니스가 바꾸려는 내용을 보고 [확인] 을 눌러 주세요","tag":"omnis:chat:room:2a6630c4-…"}
```

카드는 누르지 않았다(업무가 생기지 않았다). 두 방은 정우창 목록에서 숨겼다(`ChatRoomPref.hiddenAt`, 화면의 「대화 삭제」 와 같다).

### 화면 — Playwright 1440 · 375

`TOKEN=… BASE=http://localhost:3106 ROOM=<옴니스 방> node scripts/notify-screens.mjs` — 가로 넘침 전부 0px.

| 파일 | 무엇 |
|---|---|
| [`push-notifications/settings-1440.png`](push-notifications/settings-1440.png) · [`settings-375.png`](push-notifications/settings-375.png) | 마이 → 기기 알림: 이 기기 상태 · 「이 기기에서 알림 받기」 · 받을 알림 스위치 3개 |
| [`push-notifications/settings-ios-375.png`](push-notifications/settings-ios-375.png) | 아이폰 사파리 탭(UA) — 「홈 화면에 추가한 Omnis 앱에서만」 안내 |
| [`push-notifications/list-menu-1440.png`](push-notifications/list-menu-1440.png) · [`list-menu-375.png`](push-notifications/list-menu-375.png) | 꾹 누르기(우클릭) 메뉴의 「알림 켜기」 · 목록 줄의 빗금 종 |
| [`push-notifications/list-swipe-375.png`](push-notifications/list-swipe-375.png) | 왼쪽→오른쪽 밀기 칸: 즐겨찾기 · 알림 켜기 · 폴더 |
| [`push-notifications/header-muted-1440.png`](push-notifications/header-muted-1440.png) · [`header-muted-375.png`](push-notifications/header-muted-375.png) | 꺼진 방의 머리줄 빗금 종. 눌러서 켜면 `data-room-muted=false` 로 바뀌는 것까지 확인 |

헤드리스 크롬은 알림 권한이 「차단」 이라 설정 화면 2단계 문구가 「브라우저에서 알림이 차단돼 있습니다」 로 보인다(실제 기기에서는 권한을 묻는다).

### 로컬 e2e (CI 와 같은 조건)

메모리 `local-e2e-like-ci` 의 방식 — 로컬 컨테이너 안 별도 DB `omnis_test` 에 `prisma migrate deploy`(새 마이그레이션 포함) →
`db:seed:demo`(대상이 `localhost:5433/omnis_test` 인지 먼저 확인) → `ensure-e2e-accounts` → CI env 로 `pnpm run build` → `next start -p 3104`.
CI 에 없는 키(OPENAI · ANTHROPIC · VAPID)는 빈 값으로 덮었다. `.env.production.local` 이 없는 워크트리다.

```
$ BASE_URL=http://localhost:3104 pnpm run test:e2e
Running 49 tests using 1 worker
  -  13 [feature] › tests/feature/chat-task.spec.ts:56:3 › … (Gemini 라이브 호출)   ← E2E_LIVE_AI=1 일 때만(CI 와 같다)
  1 skipped
  48 passed (1.3m)
```

시드 전후 `omnis`(공유 스냅샷) 사용자 수 16 그대로 · `omnis_test` 5. 끝나고 3104 를 끄고 `DROP DATABASE omnis_test` (남은 것 0).

처음 빌드는 실패했다 — `scripts/verify-notify.ts` 가 `PUSH_LOG_FILE`(string | undefined)을 닫힌 함수 안에서 좁히지 못했다
(`next build` 는 scripts 까지 타입 검사한다). 고친 뒤 `tsc --noEmit` 통과 · 빌드 통과.

## 작업지시자가 실제 기기로 확인할 절차

자동화로는 「기기에 실제로 뜨는가」 를 볼 수 없다. 로컬 DB 에는 운영 스냅샷의 정우창 기기 구독 1건이 있고 VAPID 키가 운영과 같아,
**로컬 dev 에서 보내도 그 휴대폰에 실제로 뜬다**(다른 사람은 로컬 DB 에 구독이 없어 가지 않는다).

1. dry run 없이 띄운다 — `GEMINI_API_KEY= NEXTAUTH_URL=http://localhost:3106 pnpm next dev --webpack -p 3106`
2. PC 크롬으로 `http://localhost:3106` 에 정우창으로 로그인 → 마이 → 기기 알림 → 「이 기기에서 알림 받기」 (localhost 는 https 없이도 된다)
3. 다른 사람으로 글을 쓴다 — `T=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts <다른 사람 이름>)` 뒤
   `curl -X POST localhost:3106/api/chat/messages -H "cookie: authjs.session-token=$T" -H 'content-type: application/json' -d '{"roomId":"default-room","content":"푸시 확인"}'`
   (전사방 글은 로컬 DB 구성원 전원이 받는 사람이지만 구독이 있는 정우창 기기에만 실제로 간다)
4. 확인할 것
   - [ ] PC · 휴대폰에 「하드사이언스 / <보낸 사람>: 푸시 확인」 이 뜨고, 누르면 그 방이 열린다
   - [ ] 같은 방에 두 번 보내면 알림이 쌓이지 않고 바뀌며 다시 울린다
   - [ ] PC 에서 그 방을 열어 둔 채(창 포커스) 보내면 PC 에는 뜨지 않는다. 다른 방을 보고 있으면 뜬다
   - [ ] 방 머리줄 종으로 끄면 오지 않는다 · 다시 켜면 온다
   - [ ] 마이에서 채팅 알림을 끄면 오지 않는다 · 벨에는 변화 없음(채팅 글은 원래 벨이 없다)
   - [ ] 업무 지정: 다른 사람 쿠키로 `PATCH /api/tasks/<업무>` 에 정우창을 담당자로 넣으면 「새 업무」 가 뜬다. 업무 알림을 끄면 푸시는 없고 벨에는 생긴다
   - [ ] 옴니스: 옴니스 방에 묻고 바로 다른 방으로 옮기면 답이 끝날 때 뜬다. 그 방에 그대로 있으면 뜨지 않는다
5. 아이폰은 https 가 필요하다 — 운영 마이그레이션 · 머지 뒤 운영에서, 홈 화면 앱으로 연 상태에서 4 의 항목을 본다.
   사파리 탭에서는 마이 → 기기 알림에 iOS 안내가 뜨는지만 본다

## 남은 문제

- **iOS 에서 「보고 있으면 안 띄우기」 의 위험** — 푸시를 받고 알림을 띄우지 않는 것을 사파리가 「조용한 푸시」 로 셀 수 있고,
  여러 번이면 구독을 끊는다고 알려져 있다(크롬은 포커스된 창이 있으면 허용한다). 실기기에서 그 방을 보며 여러 번 받아 본 뒤에도
  구독이 살아 있는지 확인해야 한다. 문제가 되면 서버가 「지금 그 방을 보고 있다」 를 알고 보내지 않는 쪽으로 옮긴다(화면이 보고 있는 방을 알려야 한다)
- **오른쪽 패널에서 보고 있는 방은 「보고 있다」 로 치지 않는다** — service worker 는 주소만 본다. 업무 상세(`/tasks/<id>`)에서 스레드를 보고 있어도 업무방 푸시가 뜬다
- **일정 알림은 동기화가 돌 때만 나간다** — 캘린더를 열 때와 하루 한 번 크론. 아무도 안 열면 최대 하루 늦는다. 분 단위 바닥은 외부 스케줄러(calendar.md 4장, 미정)
- **다시 지정해도 알림이 다시 가지 않는 경우** — 수락하지 않은 task_assigned 가 벨에 남아 있으면 `createNotification` 의 중복 막기가 새 알림을 만들지 않는다(기존 동작)
- 전사방 글은 활성 구성원 전원이 받는다 — 운영 활성 구성원 12명 기준으로 글 하나에 발송 12건 안팎. 사람이 많이 늘면 발송을 묶는 큐가 필요하다
- 로컬 `omnis` DB 에 마이그레이션을 적용했다 — 같은 DB 를 쓰는 다른 체크아웃(omnis-local · omnis-chat-ui)의 코드는 새 칸 · 표를 읽지 않으니 영향이 없다
- 기존 `createNotification` 의 푸시도 `void` 대신 `after()` 로 옮겼다 — Vercel 에서 응답 뒤 함수가 얼어 잘리던 가능성을 막는다(운영에서 잘린 사례를 본 것은 아니다)
