---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-29-onboarding-tab-tour.md
last_verified: 2026-10-29
---

# 온보딩을 스포트라이트 하나로 — 구현 결과 (2026-10-29)

계획서: [`mydocs/plans/2026-10-29-onboarding-tab-tour.md`](../plans/2026-10-29-onboarding-tab-tour.md)

## 장면

| # | id | 화면 | 비추는 것 | 넘어가는 법 |
|---|---|---|---|---|
| 0 | `social` | 그대로 | 가운데 설명창 + 연결 버튼(켜진 제공자만) | 「나중에」 — 저절로 안 넘어간다 |
| 1 | `create-task` | `/chat/new` | 옴니스 방 대화 칸 = 시연 층(대본 1) | 대본 15초 |
| 2 | `write-doc` | `/chat/new` | 같은 자리(대본 2 — 지식 카드) | 대본 18초 |
| 3 | `tasks` | `/tasks` | nav 업무 탭 + 본문(옅게) | 7초 |
| 4 | `calendar` | `/calendar` | nav 캘린더 탭(`data-onboarding="calendar"` 새로 붙임) + 본문 | 7초 |
| 5 | `archive` | `/omnis` | nav 아카이브 탭 + 본문 | 7초 · 끝나면 시작한 화면으로 |

- 시계는 그 화면에 도착한 뒤부터 돈다. 4초 안에 못 가면 기다리지 않는다(시연은 화면 가운데에서라도)
- 소셜 연결은 나가기 전에 `sessionStorage["omnis-tour-resume"]` = `{ stop, from, at }` 을 적고 돌아오면 그 장면부터. 30분 지나면 버린다.
  안내를 마친 사람이 「다시 보기」 중에 연결하고 돌아와도 이어진다(provider 가 기록을 보고 다시 띄운다)

## 소셜 문구의 근거

`lib/auth.ts` signIn 콜백 → `lib/auth-identity.ts` 가 `UserIdentity` 에 남기는 칸은 `provider` · `providerAccountId` · `email` 뿐이다.
사람은 `provider + providerAccountId` 로 찾고(`resolveIdentity`), 세션 이름은 옴니스 계정 이름이다(jwt 콜백).
`UserIdentity.email` 은 마이의 연결 목록(`listIdentities`)에만 쓰인다. 어댑터가 없어(JWT 세션) OAuth 토큰도 저장하지 않는다.
그래서 「이름 · 사진 같은 계정 정보는 가져다 쓰지 않아요. 메일 주소는 어느 계정을 연결했는지 보여 드리는 데만 남겨요」.

## 시연이 API 를 부르지 않는 근거

- `components/onboarding/tour-demo.tsx` 에 `fetch` · import 된 API 함수가 없다. 화면은 시간의 순수 함수 `frameAt(script, t)` 다
- 층 전체가 `inert` — AgentCard 의 확인 · 취소, Composer 의 입력 · 보내기에 닿지 않는다. `onDecide` · `onSend` 는 빈 함수
- 진짜 OmnisRoom 은 시연 층 · 그늘 · TourSurface(포커스 · 키 가두기) 밑에 있다
- 로컬 dev 에서 안내 한 바퀴 동안 `window.fetch` 를 감싸 본 기록: `/api/agent` 없음. 나온 것은 화면 자체의 읽기
  (`/api/notifications` · `/api/chat/rooms` · `/api/calendar` · RSC) 와 끝낼 때의 `POST /api/onboarding`
- e2e `옴니스 시연은 … API 를 부르거나 쓰지 않는다` 가 `page.on("request")` 로 `/api/agent` · GET 아닌 `/api/` 요청이 0 건, DB 의 옴니스 방 · 업무가 0 건임을 본다

## 검증

- `pnpm run verify` — `✖ 37 problems (0 errors, 37 warnings)` (경고는 기존 것)
- 로컬 dev(`localhost:3000`, 로컬 DB) · 데모 계정 사원1 의 「다시 보기」 로 확인: 1200·1440 폭 PC, 390×844 폰, 모션 감소.
  시연 층과 설명창이 겹치지 않음(1440: 시연 330~1435 · 설명창 18~312), 업무 탭 강조가 탭에 5px 안쪽으로 맞음
- e2e 는 로컬에서 돌리지 않았다(별도 DB `omnis_test` 가 필요) — CI 가 돈다
