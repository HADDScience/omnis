---
kind: decision
status: active
canonical: mydocs/plans/2026-10-30-push-active-device.md
last_verified: 2026-10-30
---

# 쓰고 있는 기기가 있으면 다른 기기로 푸시를 보내지 않는다

앞 작업: [`2026-10-29-push-notifications.md`](2026-10-29-push-notifications.md).

## 문제

PC 에서 Omnis 를 쓰는 중인데 폰이 계속 울린다(작업지시자 정우창, 2026-10-30).

- 서버(`lib/push.ts` `deliverPush`)는 그 사람의 구독 **전부**로 보낸다
- 「그 방을 보고 있으면 띄우지 않는다」는 판단은 각 기기의 service worker 가 **자기 기기 안에서만** 한다(`public/sw.js` `isViewing`).
  폰은 PC 의 상태를 모른다
- 업무 · 일정 알림에는 그 판단조차 없다

## 작업지시자 결정 (2026-10-30)

- 다른 기기에서 쓰는 중이면 **모든 종류**의 푸시를 그 기기 말고는 보내지 않는다(멘션 · 업무 지정 포함)
- 벨 행(`Notification`)은 그대로 만든다 — 쓰는 기기의 벨 · 토스트 · 방 목록에서 본다

## 규칙

- **쓰는 중** = 그 기기에서 Omnis 화면을 마지막으로 만진 지(누르기 · 키 · 스크롤 · 마우스 움직임 · 탭으로 돌아오기) **5분**이 안 됐다
  - 탭을 숨겼다고 바로 끝나지 않는다. PC 에서 다른 탭 · 다른 앱으로 잠깐 옮겨도 5분은 PC 에 있다고 본다
  - 노트북을 덮고 떠나면 늦어도 5분 뒤부터 폰이 다시 울린다
- 쓰는 기기가 푸시를 구독했으면 그 기기로만 보낸다(그 기기의 service worker 가 보고 있는 방이면 띄우지 않는다 — 지금 그대로).
  구독하지 않은 기기(지금 정우창의 PC)면 **아무 기기로도 보내지 않는다**
- 한 사람이 두 기기를 번갈아 만지면 마지막으로 신호를 보낸 기기가 쓰는 기기다

## 구현

1. 스키마 — `PushPresence { userId @id, activeAt, endpoint? }`. 사람마다 한 줄, 신호마다 덮어쓴다. 새 표라 백필이 없다
2. `POST /api/push/presence { endpoint? }` — 로그인한 사람의 줄을 지금 시각으로 덮는다
3. 클라이언트 `PushPresence` 컴포넌트(`app/(main)/layout.tsx`) — 위 동작이 있을 때 보내되 **1분에 한 번까지**.
   만지지 않으면 요청이 없다 — Neon 이 잠들 수 있다(`use-visible-interval` 의 이유와 같다)
4. 순수 함수 `presenceTargets`(`lib/notify-rules.ts`) + 시험 — 구독 목록 · 신호 · 지금 → 보낼 구독.
   `deliverPush` 가 구독을 읽은 뒤 이것으로 거른다

## 검증

- `pnpm test:unit` — 쓰는 기기만 남는다 / 구독 없는 기기에서 쓰면 아무 데도 안 간다 / 5분 지나면 전부 / 다른 사람은 영향 없음
- `pnpm run verify` · `pnpm run build`
- 로컬 DB 에서 `deliverPush` 를 직접 불러 쓰는 중(구독 없는 기기)이면 `devices: 0` 인지.
  `PUSH_DRY_RUN=1` 은 구독을 읽기 전에 돌아가 이 거르기를 거치지 않는다 — 실제 경로로 보되, 걸러져 아무 데도 안 나가는 경우만 돌린다

## 운영 적용 순서

마이그레이션을 운영 DB 에 먼저(`pnpm run db:deploy`), 그 다음 머지 — 사용자 승인 뒤.
