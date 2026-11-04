---
kind: decision
status: active
canonical: mydocs/manual/ux-rules.md
last_verified: 2026-11-03
---

# 메신저 입력창을 하나로

작업지시자 지시(2026-11-03): 사람 · 전사 · 업무 방과 옴니스 방의 입력창을 합친다. 모양과 동작은 옴니스 방 기준, 방 종류별로 기능을 켜고 끈다. PR 까지, 머지 · 배포는 하지 않는다.

## 설계

- `components/chat/room-composer.tsx` — 입력창 하나(`RoomComposer`) · ＋ 메뉴(`ComposerPlus`) · 첨부 칩(`AttachChips`)
- `message-input.tsx`(사람 · 전사 · 업무) · `omnis-room.tsx` Composer · `cached-room-preview.tsx` EntryComposer 는 이것을 그리고 자기 기능만 넘긴다
- 자동완성은 `message-input.tsx` 만 넘긴다. 옴니스 방은 넘기지 않아 `/업무` · `@이름` · `#업무` 가 `/api/agent/rooms` 로 가는 글로만 남는다(`/api/chat/messages` 의 업무 재구성으로 가지 않는다)
- 첨부를 올리는 시점은 그대로다 — 사람 방은 보낼 때 올리고, 옴니스 방은 고르는 즉시 private 로 올린다. 권한 범위가 달라 합치지 않는다
- 무지개 단추는 옴니스(AI)에게 보내는 입력창만

## 옴니스 기준으로 바뀌는 동작

- 사람 방도 보내는 동안 입력칸을 막지 않는다 — 글은 보내는 즉시 비우고 실패하면 되돌린다
- 패널 · 업무 상세의 입력창도 알약 모양(메신저 밖 작은 크기)
- 첨부는 칩으로, 가짜 「올리는 중」 0.8초를 없앤다
- 보내기 단추 이름은 어디서나 「보내기」

## 검증

`pnpm run verify` · `pnpm run test:unit` · `pnpm run build`(운영 env 없는 워크트리) · `pnpm run test:e2e:local`(격리 DB) · 데스크톱 · 폰 폭 캡처
