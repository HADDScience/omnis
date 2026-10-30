---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-30-chat-entry-and-app-nudge.md
last_verified: 2026-10-30
---

# 방 입장 · 완료 업무 묶음 · 앱 설치/알림 권유 — 실측

계획과 이유: [`../plans/2026-10-30-chat-entry-and-app-nudge.md`](../plans/2026-10-30-chat-entry-and-app-nudge.md). 브랜치 `feat/chat-instant-entry`.

## 게이트

```
$ tsc --noEmit                         # 출력 없음 (통과)
$ eslint                               # ✖ 40 problems (0 errors, 40 warnings) — 경고는 전부 기존 파일의 것
$ tsx --test "lib/**/*.test.ts"        # ℹ tests 200 · pass 200 · fail 0
$ pnpm run build                       # exit 0
```

새 시험: `lib/chat-entry.test.ts`(맡김 한 번만 꺼냄 · 30초 경계 · 방 머리 찾기), `lib/app-nudge.test.ts`(권유 규칙 — 띄우지 않는 경우 전부),
`lib/chat-list.test.ts` 의 splitDoneTasks(업무방이 아닌 DONE · 진행 중 업무는 묶지 않음).

## 1. 방을 누르면 바로 쓰기 — 운영 빌드(`next build` + `next start`, 로컬 DB)

시험 방법: Playwright 로 실제 이동 요청(RSC, prefetch 제외)만 2.5초 늦추고, 줄을 누른 뒤 입장 입력창에 글을 쓴다.
업무방은 Enter 로 보내기를 눌러 두고, 전송 요청(`POST /api/chat/messages`)은 가로채 500 으로 돌려준다.
`WAIT` = 줄이 화면에 들어온 뒤 누르기까지의 시간(0 이면 prefetch 전에 누른다).

```
[1440] WAIT=0
첫방(옴니스) 입장 화면에서 씀: true | 입력창까지 48ms | 머리: 올해 정부과제 목록을 하나씩 자세히 설명해 줘 | 포커스: TEXTAREA "첫방 인계 시험 5541"
업무방      입장 화면에서 씀: true | 입력창까지 50ms | 머리: #부스 홍보용 판넬 제작 | 포커스: TEXTAREA "업무방 인계 시험 8454"
보낸 요청: ["업무방 인계 시험 8454"]   ← 방이 열리자 눌러 둔 글을 보냈고, 500 이라 입력칸에 되돌아왔다
[1440] WAIT=1000 — 같은 결과(48ms · 47ms · 보낸 요청 일치)
[375]  WAIT=0 / 1000 — 입력창까지 47~76ms, 쓴 글 · 커서 · 포커스 인계. 폰은 Enter 가 줄바꿈이라 줄바꿈까지 그대로 넘어간다("…5634\n")
```

덮개 전후 비교(업무방을 prefetch 전에 누름, 5ms 간격으로 칸을 찍음):

```
덮개 전  59ms 입장 화면 → 80ms 주소 바뀜 · 방 칸 비어 있음 → 2581ms 방 화면     ← 2.5초 동안 빈 칸
덮개 뒤  66ms 입장 화면 → 89ms 주소 바뀜 · 입장 화면 그대로 → 2614ms 방 화면
```

## 2. 완료된 업무 묶음

```
[1440] 완료 묶음: 1 「완료된 업무 15」 | 접힘 aria-expanded=false 줄 0 | 펼침 aria-expanded=true 줄 15
[375]  같음
```

## 3. 앱 설치 · 알림 권유 (navigator.webdriver 를 false 로 덮어 시험)

```
탭 첫 접속: install
「다음에」 뒤 같은 세션 새로고침: null
새 탭(새 세션): install
「더 이상 안 보기」 뒤 새 탭: null
홈 화면(display-mode: standalone) · 권한 denied(헤드리스 기본값): null
홈 화면 · 권한 default: push
```

## e2e (CI 와 같은 조건 — 별도 DB omnis_test · 데모 시드 · 운영 빌드)

```
$ playwright test --project=feature chat-folders.spec.ts chat-task.spec.ts onboarding.spec.ts
  1 skipped      ← chat-task 의 Gemini 라이브 호출(E2E_LIVE_AI=1 옵트인, CI 와 같다)
  11 passed (57.7s)
```

## 좁은 화면 (narrow-audit, 320~200px)

`/chat` · 옴니스 방 · 업무방 · `/settings` — overflow 0 · bleed 0. clip/ellip 은 긴 방 이름 · 방 머리 부제의 의도된 `truncate`,
tiny 1 은 업무 스레드의 기존 31px 단추로, 이번 변경 요소(묶음 머리 · 입장 입력창 · 권유 창)에서는 나오지 않았다.

## 확인하지 못한 것

- iOS 실기기에서 입장 입력창 → 방 입력창으로 포커스가 옮겨질 때 키보드가 유지되는지. 같은 커밋의 layout effect 에서 포커스를 옮기지만 실기기로는 보지 못했다
- 알림 권유의 「알림 켜기」 실제 구독(헤드리스는 권한 창이 없다). 구독 경로는 설정 화면과 같은 `subscribeToPush` 다
