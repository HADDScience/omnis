---
kind: snapshot
status: active
canonical: components/layout/right-panel.tsx
last_verified: 2026-11-04
---

# md 미만 대화 단추 · 패널 제거 — #144 뒤에 남은 것

단추 · 패널 제거 자체는 PR #144 의 a8972ac 에 들어 있다. 이 문서는 그 뒤 패널로 들어가는 길을 전부 점검해 남은 것을 고친 결과다.

## 점검한 길

| 길 | md 미만에서 |
|---|---|
| `PanelDock` · `RightPanel` · 저장값 `omnis:right-panel-open` | 그리지 않는다(#144) |
| ⌥⇧C · ⌘⇧F | `/chat`(#144) |
| `?taskId=<id>` | `/chat/task/<id>`(#144). 코드에는 이 주소를 만드는 곳이 패널 자신 말고 없다 |
| `chat_mention` 알림 | 이미 `/chat/<방>` |
| `task_*` 알림(지시 · 수락 · 상태 · 재구성 · 완료 확인) | **업무 상세 그대로.** 패널을 연 적이 없고 내용이 업무 카드 변경이다. 상세의 「이 업무 대화 보기」 로 업무방에 간다. 푸시 주소는 서버가 정해 기기 폭을 모른다 |
| 온보딩 `data-onboarding="conversation"` | 어느 장면도 이 표식을 쓰지 않는다 |
| `CHAT_HOME_READY` 분기(`floating-nav`) | 상수가 true 라 돌지 않는다 |

## 고친 것

- IP 안내 창(`components/ip/tutorial.tsx`): 폰에서 단추를 비키려 띄운 `+72px` 를 `+12px` 로. 640px 이상은 그대로다
- `scripts/usability-scenarios.mjs` panel 장면: 375px 에서 없는 단추를 눌러 멈췄다. 375 는 없음을 확인하고, 여는 장면은 1440 만 돈다
- `tests/feature/_setup.ts` `openChatDock`: md 미만은 전사방으로 간다(`mobile` 프로젝트)
- `tests/feature/mobile-no-panel.spec.ts`: 업무 알림 경로 · 창을 줄였다 늘릴 때를 더했다. 업무방 링크는 `:visible` 로 잡는다 — 스트리밍 중 같은 링크가 숨은 임시 칸(`div#S:1[hidden]`)에 약 180ms 더 있어(MutationObserver 로 잼) 700px 창에서 10번 중 2번 시험이 깨졌다. 화면에는 보이지 않는다
- `ux-rules.md` 규칙 14 · viewport 표

## PC 까지 뺄 때의 영향 (조사만, 코드 변경 없음)

| 영역 | 영향 |
|---|---|
| `main-with-chat.tsx` | `RightPanel` · `PanelDock` · `togglePanel` 을 뺀다. `initialMessages` prop 이 사라지고 `app/(main)/layout.tsx` 의 전사방 메시지 조회(`CHAT_PAGE_SIZE`)가 함께 빠진다 — 지금은 패널을 못 여는 폰에도 이 조회와 전송이 일어난다. 스크롤 칸과 `CommandPalette` 는 남는다 |
| `right-panel.tsx` 306줄 · `panel-dock.tsx` · `panel-omnis.tsx` · `right-panel-context.tsx` | 통째로 지운다. `RightPanelProvider` · `RegisterPanelTask`(`tasks/[taskId]/page.tsx`) · `floating-nav.tsx` 의 `useRightPanel` 두 곳과 죽은 `CHAT_HOME_READY` 분기가 같이 정리된다 |
| 업무 상세 | 스레드를 보는 곳이 패널뿐이라 「이 업무 대화 보기」 의 `md:hidden` 을 풀어야 한다. PC 에서 **업무 카드와 스레드를 나란히 보는 일이 없어진다.** `sidebarMessages` 조회도 빠진다 |
| 단축키 ⌥⇧C · ⌘⇧F | `lib/shortcuts.ts` 의 두 항목을 지우면 저장값은 `sanitizeShortcuts` 가 모르는 키를 버려 문제없다. 설정 화면에서 줄이 사라진다. `lib/shortcuts.test.ts` 가 `togglePanel` 을 예로 쓰고 있어 고쳐야 한다. 다른 화면에서 바로 찾는 ⌘⇧F 를 대신할 길은 정해야 한다 |
| 저장 상태 `omnis:right-panel-open` | 읽는 코드가 사라지면 기기에 값만 남고 해가 없다. 표에 없다 |
| `?taskId=` | 옛 링크를 위해 `/chat/task/<id>` 이동은 남긴다 — 지금 `RightPanel` 안에 있어 옮겨야 한다 |
| 함께 죽는 코드 | `ChatPanel` 의 `filterTaskId`, `OmnisRoom` 의 `embedded`, `/api/chat/threads/recent`, `TaskCmdModal` 의 패널 쪽 호출 |
| 기능 손실 | 어떤 화면을 보면서 옆에서 전사 채팅 · 옴니스에 묻는 일. 지금은 PC 와 태블릿(768px 이상)에 이 길뿐이다 |
| 시험 · 스크립트 | `tests/feature/_setup.ts`(`chat-task`), `room-composer` 패널 시험, `mobile-no-panel` PC 절, `tests/scenario/_actors.ts`(`openPanel` 호출 3곳 — 시나리오가 전부 패널로 말한다), `scripts/verify-agent-stop.mjs` · `verify-omnis-attach.mjs` · `usability-scenarios.mjs` 의 패널 장면 |

## 시험

데모 빌드 + 별도 DB(`omnis_fab_test`, 끝나고 지움) + `next start -p 3114`. CI 의 e2e 와 같은 env.

```
pnpm run verify                    0 errors, 39 warnings
pnpm run test:unit                 tests 371 / pass 371 / fail 0
pnpm run build                     통과
playwright --project=feature mobile-no-panel · mobile-keyboard · new-chat-entry · composer-plus-sheet · room-composer · chat-task · shortcuts
                                   45 passed, 1 skipped (E2E_LIVE_AI 없음)
playwright --project=feature mobile-no-panel -g "업무 상세에서 그 업무방으로|업무 알림은" --repeat-each=15
                                   60 passed
playwright --project=mobile  chat-task · mobile-no-panel
                                   13 passed, 1 skipped, 2 failed
usability-scenarios.mjs panel      전부 통과 (375 · 1440)
narrow-audit.mjs                   exit 1 — 28/88 화면 ✗
```

- `--project=mobile` 의 2건은 `chat-task` 가 Enter 로 `/업무` 를 보내는 시험이다. 폰의 Enter 는 줄바꿈이라(`room-composer` 시험) 다이얼로그가 안 뜬다. 패널과 무관하고, 이 프로젝트는 CI 에 없다. 390px 전사방에서 보내기 단추로 보내면 「업무 등록」 창이 뜬다
- `narrow-audit` 는 가로 넘침 · 번짐 0건이고 ✗ 는 모두 글자 잘림이다: 채팅 15 · 옴니스 4 · NAS 3 · CRM 6. 업무 상세는 전 폭 통과다. 이 PR 이 바꾼 앱 코드는 `/ip` 안내 창 하나이고 `/ip` 는 점검 목록에 없다. main 과 비교하지는 않았다
- 390×844 실측: `/calendar` · `/tasks` · `/tasks/<id>` 에 단추 · 패널 없음, 가로 넘침 없음, 저장값 「열림」 이어도 패널 쪽 API 호출 없음. IP 안내 창은 하단 nav 위에 떠 겹치지 않는다
- 844×390(가로 폰)은 md 이상이라 단추가 **보인다.** 범위가 md 미만이라 그대로 뒀다

## 확인 못 한 것

실제 폰. 가로 폰에서 패널의 쓸모. 전체 e2e 는 CI 결과를 본다.
