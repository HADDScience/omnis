---
kind: snapshot
status: active
canonical: mydocs/plans/2026-09-17-nas-file-link.md
last_verified: 2026-09-17
---

# NAS 파일 연결 · 실패 알림 — 실측

계획 [`plans/2026-09-17-nas-file-link.md`](../plans/2026-09-17-nas-file-link.md) · 원인 [`troubleshootings/large-file-upload.md`](../troubleshootings/large-file-upload.md).

## 품질 게이트

```
$ npm run verify
✖ 42 problems (0 errors, 42 warnings)

$ npx eslint <바꾼 파일 15개>
✖ 3 problems (0 errors, 3 warnings)   ← uploadProgress 미사용 · handleSend deps · <img> — 모두 origin/main 에 이미 있다
```

## 검증 스크립트 — 42 통과

```
$ BASE=http://localhost:3002 npx tsx --env-file=.env scripts/verify-nas-link.ts

[1] 경로 다듬기
  ✓ 윈도우 드라이브 · 맥 /Volumes · 맥 ~/NAS · 맥 /Users/이름/NAS
  ✓ 거부: .. 로 탈출 · 마운트 경로 안의 .. · 다른 공유폴더 · 다른 공유폴더 안의 같은 이름 폴더 · 공유폴더 없는 마운트
  ✓ 링크 path 왕복 · 올린 파일 path 는 NAS 가 아니다
[2] 공개 이슈 다듬기 · 지문
  ✓ 파일명이 빠진다 · 다른 파일, 같은 오류 → 같은 지문 · 다른 상태 → 다른 지문
  ✓ NAS 경로 · 설명 꼬리가 빠진다 · UUID 가 :id 로
[3] GitHub 이슈 (fetch 가로채기)
  ✓ 열린 이슈가 없으면 새로 연다 · 새 이슈 본문에 표식
  ✓ 열린 이슈가 있으면 댓글 · 댓글일 때 새 이슈를 열지 않는다 · 토큰이 없으면 건너뛴다
[4] 실제 NAS (읽기만)
  ✓ 파일 정보 — 6469858B
  ✓ 194MB 파일도 내용 없이 정보만 — 194270316B
  ✓ & 가 든 폴더를 연다 — 15건 · 목록에 크기가 보인다 · 목록의 경로로 다시 연다
  ✓ 거부: 폴더 · 거부: 없는 파일
  ✓ 연결 파일을 끝까지 읽는다 — 6469858B · 4289ms
  ✓ 거부: DB 에 공유폴더 밖 경로가 들어 있어도 읽지 않는다
[5] HTTP — http://localhost:3002
  ✓ stat=1 은 194MB 파일을 JSON 정보로만
  ✓ 연결 → 201 · path 가 NAS 링크 · 크기 · pdf 타입
  ✓ 말풍선 링크로 연다 — 6469858B
  ✓ 메시지에 붙는다
  ✓ 거부: .. → 400 · 다른 공유폴더 → 400 · 폴더 → 404 · 없는 파일 → 404 · 로그인 없이 → 401
  ✓ 오류 보고를 받는다 · 같은 사람 · 같은 오류는 30분 안에 다시 보내지 않는다 · 거부: 모르는 종류 → 400
통과: 42 passed, 0 failed
```

처음 돌렸을 때는 6건이 실패했다 — 크기 `null`, 194MB `.ai` 를 못 찾음. 원인은 NAS 응답의 `lp1:` 접두사 · `&amp;` · NFD 파일명이었고
기존 NAS 탐색기에도 있던 버그다(트러블슈팅 문서의 표).

## 화면 — 로컬 dev · Playwright · 시험 계정

1. 6.2MB 파일을 고름 → 알림 「4MB 가 넘는 파일은 바로 올릴 수 없습니다 / 「족자_큰파일.pdf」 6.2MB — NAS 에 올린 뒤 「NAS 파일 연결」 로 다시 첨부해 주세요」 + 버튼.
   `POST /api/errors {kind: upload_too_large, size: 6469858, fileName: 족자_큰파일.pdf}` 가 나갔다
2. 알림의 버튼 → 「NAS 파일 연결」 창, 공유폴더 루트 목록
3. `/Volumes/HADD Science/…/260916_G-SUMMIT 족자.ai`(NFC) 붙여넣고 열기 → 창이 닫히고 칩 「NAS 260916_G-SUMMIT 족자.a…」
4. `Z:\HADD Science\…\회사홍보자료 배너&포스터` 붙여넣기 → 폴더가 열리고 크기가 보인다(`족자.ai 185.3 MB`) → 클릭으로 고름
5. 보내기 → `POST /api/files/nas 201` → `POST /api/chat/messages 201 files=[260916_G-SUMMIT 족자.ai]` → 말풍선 「260916_G-SUMMIT 족자.ai · AI · 185.3MB」
6. 말풍선 링크 → `200 application/octet-stream`, `attachment; filename*=…족자.ai`, 앞 5,275,648B 를 2,606ms 에 받음(로컬 맥 → NAS)

좁은 화면 — 창을 직접 쟀다:

```json
[{"width":320,"docScrollX":false,"dialogLeft":13,"dialogRight":307,"dialogOverflowX":false,"openBtnInside":true,"closeInside":true},
 {"width":200,"docScrollX":false,"dialogLeft":13,"dialogRight":187,"dialogOverflowX":false,"openBtnInside":true,"closeInside":true}]
```

행 높이가 36px 이라 탐색기 행에 `.touch-target`(coarse 포인터에서 44px)을 붙였다.

`scripts/narrow-audit.mjs` 는 320px 을 돈 뒤 dev 서버가 내려가 240px · 200px 이 전부 연결 거부였다. 320px 결과에서
`/nas` 는 통과, 실패 4건(`/omnis` · `/crm/samples` · `/crm/inventory` · 업무 상세)은 이번에 건드리지 않은 화면이다 — main 과 비교하지는 않았다.

시험 계정 · 메시지 · 파일 행 · 색인은 지웠다(로컬 DB 에서 `__nas%` 사용자 0 · `/api/nas%` 파일 0 · 색인 0 확인).

## 하지 않은 것

- 운영 배포 · 운영에서 185MB 내려받기가 함수 수명 안에 끝나는지
- 실제 GitHub 저장소에 이슈 만들기 — 토큰이 없고, 공개 저장소에 시험 이슈를 남기지 않았다
- 업무 스레드 입력창(`thread-composer`) 화면 시험 — 같은 `MessageInput` 이고 보내기 코드는 채팅 패널과 같은 순서다. 타입 검사만
