---
kind: snapshot
status: active
canonical: hooks/use-room-list-nudge.ts
last_verified: 2026-11-03
---

# 왼쪽 방 목록 — 열린 방에 새 글이 생기면 맞춘다 (A안)

- 열린 방의 새 글(받은 글 · 보낸 글)만 목록을 다시 읽는다. 1.5초 묶음 · 방을 떠나면 기다리던 것을 바로 읽는다. `POLL_MS`(30초) · 탭 숨김 규칙은 그대로
- 대화창 폴링은 커서보다 앞부터 겹쳐 읽는다 — 응답에 글이 있다고 새 글이 아니어서 본 글 id 로 가른다
- 보내는 경로 점검: 전사 · 사람(`ChatPanel`) · 업무(`ThreadComposer`)는 부르지 않았다. 옴니스는 새 방을 만들 때와 답이 끝날 때만 불렀다. 옴니스는 서버가 글을 받은 때도 부른다
- 업무방은 3초 폴링이 없다. 다른 사람의 글은 새로고침 전에는 대화창에 뜨지 않으므로, 내가 보내거나 화면이 다시 그려질 때만 맞춘다
- 시험: `tests/feature/room-list-refresh.spec.ts`, `lib/trailing-debounce.test.ts`
