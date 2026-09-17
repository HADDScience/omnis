---
kind: snapshot
status: active
canonical: mydocs/troubleshootings/large-file-upload.md
last_verified: 2026-09-17
---

# 첨부 상한을 화면이 먼저 말한다 — 실측

배경과 원인은 [`troubleshootings/large-file-upload.md`](../troubleshootings/large-file-upload.md).

## 바꾼 것

```
 components/chat/chat-panel.tsx    | 업로드 실패 시 글을 보내지 않고 던진다
 components/chat/message-input.tsx | 4MB 넘는 파일을 고르는 순간 거르고 알린다
 lib/constants.ts                  | MAX_UPLOAD_BYTES (화면·서버 공용)
 lib/storage.ts                    | constants 의 값을 다시 내보낸다 — 서버 importer 는 그대로
```

## 품질 게이트

```
$ npm run verify
✖ 42 problems (0 errors, 42 warnings)

$ npx eslint components/chat/message-input.tsx components/chat/chat-panel.tsx lib/constants.ts lib/storage.ts
✖ 3 problems (0 errors, 3 warnings)     ← 전부 이전부터 있던 것 (handleSend deps · <img>)
```

## 화면 실측 — 로컬 dev(3002) · Playwright

시험 파일: 6,469,858B(운영에서 막힌 `족자_3.pdf` 와 같은 크기) · 200,000B.
로컬 세션은 API 가 401 을 돌려 줘서, 전송 쪽은 `page.route` 로 응답을 대신 줬다.

### 1. 고르는 순간 거른다

두 파일을 함께 골랐다.

```json
{"toasts":["4MB 가 넘는 파일은 첨부할 수 없습니다\n「족자_큰파일.pdf」 6.2MB — NAS 경로를 글로 남겨 주세요"],
 "smallAttached":1, "bigAttachedChip":0}
```

큰 파일은 첨부 목록에 들어가지 않고, 작은 파일은 그대로 붙는다.

### 2. 업로드가 실패하면 글을 보내지 않는다 (거부되어야 하는 경우)

`POST /api/files` 를 500 으로 돌려주고 작은 파일 + 「완성했습니다 (업로드 실패 시험)」 전송.

```json
{"filePosts":1, "messagePosts":0,
 "toasts":["NAS 업로드 실패 (HTTP 503) — 시험"],
 "textareaValue":"완성했습니다 (업로드 실패 시험)", "attachmentChips":1}
```

업로드 1회 시도 → 메시지 POST 0회 → 오류 표시 → 입력한 글과 첨부가 남았다.
고치기 전 코드는 이 경우 파일을 건너뛰고 메시지 POST 를 보냈다(`chat-panel.tsx` 의 `if (fRes.ok)` 만 있던 분기).

## 하지 않은 것

- 운영 배포 · 운영 재현 — 푸시 전
- 업무 스레드 입력창(`thread-composer.tsx`) 자체는 고치지 않았다. 같은 `MessageInput` 을 쓰므로 1번 거르기가 그대로 적용된다
- 큰 파일을 올리는 방법 — 2단계
