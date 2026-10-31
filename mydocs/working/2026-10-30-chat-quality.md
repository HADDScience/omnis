---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-30-chat-quality.md
last_verified: 2026-10-31
---

# 채팅 품질 — 결과와 실측

계획: [`../plans/2026-10-30-chat-quality.md`](../plans/2026-10-30-chat-quality.md). 브랜치 `feat/chat-quality`.

## 한 것

| 단계 | 내용 | 주요 파일 |
|---|---|---|
| 1 커서 | `after`·`before` 커서를 `시각\|id` 쌍으로. 이전 페이지는 같은 시각이면 id 로 가르고, 폴링은 10초 겹쳐 읽어 id 로 거른다. 시각만 보내는 옛 화면도 받는다 | `lib/chat-cursor.ts`, `app/api/chat/messages/route.ts` |
| 2 전송 실패 | 실패 말풍선에 「다시 보내기 · 지우기」. 어떤 길로 끝나든 폴링 재개(try/finally). 화면이 만든 `clientId` 로 다시 보내도 한 번만 저장 — 남의 글 · 다른 방 글의 clientId 는 409 | `components/chat/chat-panel.tsx`, `lib/chat-client-id.ts` |
| 3 남의 수정 · 삭제 | 고치기 · 지우기 · 업무 연결 때 `changedAt`. 폴링이 `changes=1` 을 실으면 `{ messages, changed, checkedAt }` 로 답한다(옛 화면은 배열 그대로) | `[messageId]/route.ts`, `lib/chat-post.ts`, `app/api/tasks/route.ts` |
| 4 스크롤 | 맨 아래 근처이거나 내 글이면 따라가고, 위에서 읽는 중이면 자리를 지키고 「새 메시지 N개 ↓」 | `lib/chat-follow.ts`, `components/chat/message-list.tsx` |

마이그레이션 하나 — `prisma/migrations/20261031000000_chat_message_changed_client`(nullable 두 칸 + 인덱스 둘, 백필 없음).
리베이스로 main 에 `20261030120000_push_presence` 가 먼저 들어와 이름을 그 뒤로 옮겼다.

## e2e 가 잡은 회귀 두 개 (같은 브랜치에서 고침)

1. **방을 열면 맨 위에 머물렀다.** ChatPanel 은 방을 열 때 목록을 비웠다 다시 채우는데, 빈 목록 화면에는 스크롤 칸이 없어
   다음 칸이 새로 생긴다(scrollTop 0). 4단계 판정이 직전 id 를 그대로 들고 있어 「새 글 없음」 으로 보고 내리지 않았다 → 빈 목록이면 처음 그리는 것으로 되돌린다
2. **빈 방에서 보낸 글의 실패 말풍선이 사라졌다.** 커서가 없어 다음 폴링이 첫 읽기로 목록을 통째로 갈아 끼웠다 → 첫 읽기에도 로컬 말풍선은 남기고,
   진짜 글이 들어온 것만 clientId 로 걷는다

## 실측

```
$ pnpm run verify
✖ 40 problems (0 errors, 40 warnings)        ← 작업 전과 같은 수. 새 경고 없음

$ pnpm run test:unit
ℹ pass 303
ℹ fail 0

$ pnpm run build
build=0

$ pnpm run test:e2e:local tests/feature/chat-quality.spec.ts
  ✓ 서버에 닿지 못한 글은 「보내지 못함」 으로 남고, 다시 보내면 한 번 저장된다 · 폴링은 멈추지 않는다
  ✓ 응답만 끊긴 글을 다시 보내도 두 번 저장되지 않는다
  ✓ 거부 — 남의 clientId 로 다시 보내면 그 글을 받아 가지 못한다
  ✓ 남이 지운 글은 새로고침 없이 내 화면에서도 걷힌다
  ✓ 위로 올려 읽는 중에 남의 글이 오면 자리를 지키고 「새 메시지」 로 알린다
  ✓ 커서 — 같은 시각의 글이 페이지 경계에 걸려도 빠지지 않는다 · 늦게 커밋된 글을 폴링이 줍는다
  6 passed (1.3m)
```

전체 기능 e2e(`pnpm run test:e2e:local`) — 44 통과 · 9 실패 · 1 건너뜀(Gemini 라이브).
실패 9건 중 채팅은 없다. 같은 시간대에 좁은 화면 점검과 dev 서버를 함께 돌려 1분 시간 초과가 몰렸다.
그 다섯 파일만 부하 없이 다시 돌린 결과:

```
$ pnpm run test:e2e:local tests/feature/{omnis-hub,onboarding,record-proposals,reports,tasks-overview}.spec.ts
  18 passed (2.9m)
  1 failed — onboarding.spec.ts:151 「장면 순서대로 화면을 옮겨 다니며 비추고 …」
```

남은 1건은 **origin/main(5824658)에서도 같은 자리에서 실패한다** — 이 브랜치와 무관하다:

```
(origin/main 분리 체크아웃) $ pnpm run test:e2e:local tests/feature/onboarding.spec.ts
  ✘ onboarding.spec.ts:151 … (1.0m)
  1 failed · 7 passed
```

좁은 화면 점검(`narrow-audit.mjs`, 로컬 스냅샷 DB · 정우창 세션) — 전사방 320px 에 clip 5 · ellip 9 · tiny 9.
걸린 요소는 방 머리 설명 줄 · 업무 배지 · 파일 이름 · 31px 아이콘 버튼으로 **이번에 손대지 않은 것**이다.
새로 넣은 알약 · 다시 보내기 버튼은 `min-h-11`(44px)이지만 점검 화면에는 그 상태가 나타나지 않아 측정되지 않았다.
점검 도중 dev 서버가 죽어 200px 구간은 재지 못했다.

## 남은 일 (작업지시자 승인 필요)

1. push · PR
2. **운영 DB 에 마이그레이션 먼저** — 이 워크트리에서 `pnpm run db:deploy`(운영 env). 그 다음 머지
3. 머지 뒤 이 계획서를 `plans/archives/` 로, 워크트리 정리
