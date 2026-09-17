---
kind: investigation
status: active
canonical: mydocs/troubleshootings/large-file-upload.md
last_verified: 2026-09-17
---

# 4MB 넘는 파일을 첨부하면 메시지째 보내지지 않는다

2026-09-17 09:53 무렵. 업무 `#gsummit-족자-제작` 스레드에서 족자 파일을 붙여 「완성했습니다」 를
보내려는데 오류가 떴다. **해결되지 않았다** — 화면이 이유를 말하게 한 것(1단계)까지만 했고,
큰 파일을 실제로 올리는 길(2단계)은 계획 단계다.

## 무엇이 일어났나

| 확인한 것 | 결과 |
|---|---|
| 첨부 후보 크기 | 같은 폴더의 족자 파일이 `.ai` 118~194MB, `.pdf` 6.4MB~193MB. 가장 작은 것도 4MB 를 넘는다 |
| 앱의 상한 | `MAX_UPLOAD_BYTES = 4MB` (`lib/storage.ts`) |
| 플랫폼의 상한 | Vercel 은 4.5MB 넘는 요청 본문을 **함수에 닿기 전에** 413 으로 끊는다 |
| 운영 로그 09:47~09:54 | 업무 페이지 GET 은 있고 `POST /api/files` · `POST /api/chat/messages` 는 **0건** |
| 업무 스레드 | 메시지 저장 안 됨 — 스레드에는 지시 글 1건뿐 |

```
$ vercel logs --environment production --since 1h -n 100
09:53:45.10  λ GET /omnis/tasks/46091728-…
09:53:46.41  λ GET /omnis/api/notifications
…                                   ← POST 없음
```

스레드 입력창(`thread-composer.tsx`)은 파일을 먼저 올리고 실패하면 글을 보내지 않는다.
Vercel 이 돌려준 413 은 JSON 이 아니라서 서버의 「파일이 너무 큽니다」 문구도 못 읽고
「「파일명」 을 올리지 못했습니다」 만 떴다. **크기가 이유라는 것을 화면도 로그도 말하지 않았다.**

같은 자리를 보다가 하나 더 찾았다. 채팅 패널(`chat-panel.tsx`)은 반대로 **업로드가 실패하면 그 파일만
조용히 건너뛰고 글을 보냈다** — 첨부가 빠진 줄 모른 채 「보냈다」 가 된다.

## 1단계 — 이유를 말하게 한다 (`fix/upload-size-limit`)

| | |
|---|---|
| 고르는 순간 거른다 | `message-input.tsx` `addFiles` — 4MB 넘는 파일은 첨부 목록에 넣지 않고 파일명·크기와 함께 알린다 |
| 상한을 한 곳에 | `MAX_UPLOAD_BYTES` 를 `lib/constants.ts` 로 옮기고 `lib/storage.ts` 가 다시 내보낸다 — storage 는 `node:tls` 를 써서 화면이 읽을 수 없다 |
| 채팅 패널이 멈춘다 | 업로드 실패 시 글을 보내지 않고, 임시 말풍선을 거두고, 오류를 띄우고, 던진다 — 입력한 글과 첨부가 남는다(스레드 입력창과 같은 약속) |

실측은 [`working/2026-09-17-upload-size-limit.md`](../working/2026-09-17-upload-size-limit.md).

이것으로 **큰 파일은 여전히 못 올린다.** 사람이 막혔다는 사실과 이유를 즉시 알게 됐을 뿐이다.

## 왜 그냥 상한을 올리지 못하나

- **Vercel 요청 본문 4.5MB** — 코드로 바꿀 수 없는 플랫폼 상한이다.
- **브라우저가 NAS 로 직접 올릴 수 없다** — NAS WebDAV(`hadd.synology.me:2506`)는 Synology 자체서명 인증서라
  브라우저가 거부하고, 서버는 지문 고정으로만 붙는다(`lib/storage.ts`). 인증도 서비스 계정 Basic 인증이라
  브라우저에 줄 수 없다.
- **내려받기도 같은 길을 지난다** — `/api/files/[id]/raw` 와 `/api/nas` 는 NAS → Vercel 함수 → 브라우저로 스트리밍한다.
  194MB 를 함수 수명 안에 흘려 보낼 수 있는지는 **아직 재 보지 않았다.**

## 남은 것 — 2단계

계획서 승인 전. 후보와 판단 근거는 작업지시자와 합의한 뒤 `plans/` 에 옮긴다.

| 후보 | 요지 |
|---|---|
| NAS 에 이미 있는 파일은 **경로로 잇는다** | 올리지 않는다. `File.path` 를 `/api/nas?path=…` 로 둔다. 이번 사례(족자 원본이 이미 공용 NAS 에 있다)에 맞다 |
| 4MB 조각으로 나눠 올린다 | Vercel 을 그대로 지나되 요청마다 4MB 이하. NAS 에 조각으로 두고 내려받을 때 이어 흘린다 |
| NAS 에 업로드 수신기를 둔다 | Omnis 가 서명한 짧은 토큰으로 브라우저가 NAS 에 직접 올린다. 정식 인증서 · 공개 포트 · 운영할 컨테이너가 생긴다 |
