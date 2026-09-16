---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-16-chat-message-actions.md
last_verified: 2026-09-16
---

# 2026-09-16 — 채팅 수정 · 삭제 · 답장 (검증)

계획: [plans/2026-09-16-chat-message-actions.md](../plans/2026-09-16-chat-message-actions.md)
브랜치 `feat/chat-message-actions` · 커밋 `a6f6085`

## 품질 게이트

```
$ npm run verify      # typecheck → lint
✖ 41 problems (0 errors, 41 warnings)   # 경고는 전부 기존 scripts/ · tests/ 의 미사용 변수
```

마이그레이션 — 로컬 `omnis_chat_check`:

```
$ npx prisma migrate deploy
migrations/
  └─ 20260916000000_chat_message_actions/
All migrations have been successfully applied.
```

## 실측 — 로컬 dev(3002) · 정우창으로 로그인

| 무엇 | 화면 | DB |
|---|---|---|
| 답장 | 노혜린 글에서 「답장」 → 입력창 위 대상 한 줄 → 보낸 글에 인용 한 줄 | `replyToId` → 노혜린 글 |
| 수정 | 말풍선 자리에서 고치고 Enter → 본문 교체 · 시간 옆 「수정됨」 | `editedAt 01:28:07`, 본문 교체 |
| 삭제 | 확인 창(「자리는 남고 내용만 사라집니다」) → 「삭제된 메시지입니다」 한 줄, 답장 인용은 남고 버튼은 사라짐 | `deletedAt 01:30:14` (행은 남음) |

서버 로그:

```
POST   /api/chat/messages                           201 in 76ms
PATCH  /api/chat/messages/e531ca11-…                200 in 3.1s
DELETE /api/chat/messages/e531ca11-…                200 in 5.2s
```

권한: 내 글에는 답장 · 수정 · 삭제 세 버튼, 남의 글에는 답장 하나만 보였다(스냅샷 실측).

## 도중에 고친 것

- **고치거나 지운 글이 화면에 반영되지 않았다.** `fetchMessages` 는 `after=` 뒤에 새로 생긴 글만 가져오는데,
  고친 글은 `createdAt` 이 과거라 폴링에 걸리지 않는다. 응답으로 받은 글을 그 자리에서 갈아 끼우도록 고쳤다
  (`components/chat/chat-panel.tsx` `applyMessageChange`). DB 와 서버는 처음부터 맞았고 화면만 낡아 있었다.

## 남은 것 · 알려진 것

- **업무 스레드(오른쪽 패널)의 수정 · 삭제는 아직 화면에서 확인하지 않았다.** 그쪽은 `router.refresh()` 로
  서버에서 다시 읽으므로 채팅 패널과 같은 함정은 없을 것으로 보지만, 확인 전이다.
- 콘솔에 React key 중복 경고 1건(`4a552eab-…`)이 있다. `key={msg.id}` 로 main 과 같은 구조이고
  이번 변경과 무관하다 — 업무 카드 메시지가 같은 업무를 두 번 가리킬 때 난다.
- 지운 글의 첨부 파일은 파일 표에 그대로 남는다. 업무에 이미 연결된 파일을 함께 지우지 않기 위해서다.
