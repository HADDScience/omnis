---
kind: decision
status: active
canonical: mydocs/plans/2026-09-16-chat-message-actions.md
last_verified: 2026-09-16
---

# 2026-09-16 — 채팅 메시지 수정 · 삭제 · 답장

## 왜

지금 채팅은 **보내면 끝이다.** 오타를 고칠 수도, 잘못 보낸 글을 지울 수도, 위의 어떤 글에 답하는지 가리킬 수도 없다.
`ChatMessage`(`prisma/schema.prisma:89`)에 `editedAt` · `deletedAt` · `replyToId` 가 없고,
`app/api/chat/messages/route.ts` 에는 `GET` 과 `POST` 만 있다.

업무 스레드에서 이것이 더 크게 걸린다 — 스레드의 글은 **AI 재구성의 입력**이라,
잘못 쓴 한 줄이 업무 카드에 그대로 반영되고 지울 방법이 없다.

## 스키마

```prisma
model ChatMessage {
  editedAt   DateTime?      // 고친 시각. null 이면 원본
  deletedAt  DateTime?      // 지운 시각. 행은 남긴다
  replyToId  String?
  replyTo    ChatMessage?   @relation("MessageReply", fields: [replyToId], references: [id])
  replies    ChatMessage[]  @relation("MessageReply")
}
```

- **지울 때 행을 지우지 않는다**(soft delete). 답장이 가리키는 글, 업무에 붙은 글, 색인이 함께 사라지기 때문이다.
- 본문은 DB 에 그대로 두고 **API 가 내려보내지 않는다** — 목록 응답에서 「삭제된 메시지입니다」로 바꾼다.
- 마이그레이션 1건. 운영 DB 에 `npm run db:deploy` 를 **머지 전에** 적용한다(AGENTS.md).

## 범위

| # | 무엇 | 파일 |
|---|---|---|
| 1 | 스키마 + 마이그레이션 | `prisma/schema.prisma`, `prisma/migrations/` |
| 2 | `PATCH`/`DELETE /api/chat/messages/[messageId]` — 본인 글만, `NORMAL` 만, 시스템 메시지 제외 | 새 라우트 |
| 3 | `POST` 에 `replyToId` 받기 · `GET` 에 `replyTo`(작성자 · 본문 앞부분) 포함, 지운 글은 본문 치환 | `app/api/chat/messages/route.ts`, `lib/chat-post.ts` |
| 4 | 재구성 입력에서 **지운 글 제외** — 안 하면 지워도 업무 카드에 남는다 | `lib/chat-post.ts:197` |
| 5 | 색인 — 고치면 다시, 지우면 뺀다 | `lib/embeddings.ts` 호출부 |
| 6 | 말풍선 hover 액션(답장 · 수정 · 삭제) · 인라인 수정 · 「수정됨」 표시 · 답장 인용 줄 · 입력창 답장 대상 바 | `components/chat/message-list.tsx`, `message-parts.tsx`, `chat-panel.tsx`, `message-input.tsx`, `thread-composer.tsx`, `task-sidebar.tsx` |

**범위 밖:** 남의 글 삭제(관리자 포함), 수정 이력 보기, 반응(이모지).

## 규칙

| 규칙 | 왜 |
|---|---|
| 본인 글만 고치고 지운다 | 업무 지시의 근거가 되는 대화다. 남이 바꾸면 근거가 흔들린다 |
| 🤖 시스템 메시지 · 업무 카드(`__TASK_CREATED__`)는 대상이 아니다 | 사람이 쓴 글이 아니다 |
| 지운 자리는 남는다 — 「삭제된 메시지입니다」 한 줄 | 답장과 흐름이 끊기지 않게 |
| 고친 글에는 시간 옆에 「수정됨」 | 나중에 읽는 사람이 원문과 다름을 안다 |
| 업무 스레드의 글을 고치거나 지우면 **재구성을 다시 돌린다**(작업지시자 결정 2026-09-16) | 지운 글의 내용이 업무 카드에 남아 있으면 지운 의미가 없다. 응답 뒤(`after`)에 돌고, 늦게 끝난 결과는 기존 `superseded` 규칙이 버린다 |

## 단계

```
1. 스키마 + 마이그레이션(로컬)        → verify: migrate deploy 통과, prisma studio 로 컬럼 확인
2. API(PATCH · DELETE · replyTo)      → verify: curl 로 본인/남의 글 · 시스템 글 거부 확인
3. 재구성 · 색인에서 지운 글 제외      → verify: 지운 뒤 재구성 입력에 안 들어가는지 로컬 확인
4. UI 3곳(패널 · 스레드 · 입력창)     → verify: 로컬 dev 에서 수정 · 삭제 · 답장 왕복
5. npm run verify + feature e2e       → verify: 출력 첨부
6. 운영 DB 마이그레이션 → 머지         → 작업지시자 승인
```
