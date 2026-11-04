---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-30-push-active-device.md
last_verified: 2026-10-30
---

# 쓰고 있는 기기가 있으면 다른 기기로 푸시를 보내지 않는다 — 구현 · 실측

계획: [`../plans/2026-10-30-push-active-device.md`](../plans/2026-10-30-push-active-device.md).
브랜치 `feat/push-active-device`, 워크트리 `../omnis-push-active`(origin/main 866f52e 위).

## 바뀐 것

| 파일 | 내용 |
|---|---|
| `prisma/schema.prisma` · `migrations/20261030120000_push_presence` | `PushPresence` 표(사람마다 한 줄). 추가만, 백필 없음 |
| `lib/notify-rules.ts` | `presenceTargets` · `PRESENCE_WINDOW_MS`(5분) · `PRESENCE_PING_MS`(1분) |
| `lib/push.ts` | `deliverPush` 가 구독과 신호를 함께 읽어 `presenceTargets` 로 거른다 |
| `app/api/push/presence/route.ts` | `POST { endpoint? }` — 신호 받기 |
| `components/push-presence.tsx` · `app/(main)/layout.tsx` | 화면을 만질 때 1분에 한 번까지 신호 |

## 실측 (2026-10-30)

```
$ pnpm test:unit
✔ 기기: 신호가 없으면 전부 보낸다
✔ 기기: 구독한 PC 에서 쓰는 중이면 그 PC 로만, 다른 사람은 그대로
✔ 기기: 구독하지 않은 PC 에서 쓰는 중이면 아무 기기로도 안 보낸다
✔ 기기: 5분이 지나면 다시 전부 보낸다(경계 포함)
ℹ tests 273
ℹ pass 273
ℹ fail 0

$ pnpm run verify        → exit 0 (경고 40건은 기존 파일 것. 바뀐 파일만 eslint → exit 0)
$ pnpm run build         → ✓ Compiled successfully, 라우트 목록에 ƒ /api/push/presence
```

로컬 DB(운영 스냅샷)에서 `deliverPush` 직접 호출 — 정우창 구독 1대(iPhone), PC(구독 없음)에서 방금 쓴 것으로 신호를 넣고:

```
구독 기기 수: 1
결과: {"sent":0,"removed":0}
{"category":"chat","outcome":"sent","title":"presence-check","devices":0}
```

마이그레이션: 로컬 DB 에 `prisma migrate deploy` 후 `migrate diff --from-url <로컬> --to-schema-datamodel` —
`PushPresence` 관련 차이 없음(남은 차이는 다른 브랜치의 `20261030020000_chat_message_changed_client` 몫).

## 돌리지 않은 것

- 브라우저에서 신호 요청이 실제로 나가는지(로그인한 dev 화면) — 확인하지 않았다
- 신호가 없을 때 실제 폰으로 가는 경우 — 로컬 DB 에 실제 구독이 있어 돌리지 않았다(단위 시험이 덮는다)
- e2e

## 남은 한계

- 판정은 「Omnis 화면을 만졌는가」 다. PC 에서 Omnis 를 5분 넘게 만지지 않고 다른 앱만 쓰면 폰이 다시 울린다
- PC 가 푸시를 구독하지 않았으면 쓰는 중에는 어느 기기에도 기기 알림이 없다. 화면이 보이면 벨 토스트 · 방 목록 배지로 보인다
