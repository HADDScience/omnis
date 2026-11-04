---
kind: snapshot
status: active
canonical: app/globals.css
last_verified: 2026-11-04
---

# iPad 에서 앱이 화면을 못 채우고, 뱃지가 잘리고, 입력창이 키보드에 안 붙는다

## 원인

| 증상 | 원인 | 근거 |
|---|---|---|
| 앱 아래가 빈다 | `--app-vh: calc(100svh / 1.1)`. iOS 26.0 Safari 는 zoom 이 걸려도 `100svh` 를 화면 높이 그대로 그려, 셸이 화면의 1/1.1 이 된다 | iPad Air 11 시뮬레이터 가로: 화면 734, 셸 아래끝 667.3 |
| 키보드 위 빈 공간 | 위 빈 칸이 그대로 따라 올라온다. 키보드 맞춤은 `max-width: 767px` 조건이라 iPad 에서 돌지 않는다 — 계산 중복이 아니라 미적용이다 | `PHONE_TOUCH_QUERY`. 모의 e2e 가 수정 전 실패 |
| 뱃지 잘림 | `.touch-target` 이 터치 기기에서 버튼을 44px 로 키워 원(2.5rem = 32.5px)을 넘고, 뱃지가 그 가장자리 기준 `-top-1` 이다 | 데모 배너 기준 뱃지가 nav 보다 8.9px 위. 배너가 없으면 화면 밖 |

엔진 차이(같은 시험 페이지, `html { zoom: 1.1 }`):

| 브라우저 | 화면 높이 | `calc(100svh / 1.1)` |
|---|---|---|
| Chromium · Playwright WebKit | 820 | 820 |
| macOS Safari 26.6 | 853 | 853 |
| iOS 26.0.1 Safari (iPad 시뮬레이터) | 1094 | 994.5 (화면 px 로 환산) |

- PR #144 가 만든 문제가 아니다. `--app-vh` 와 뱃지 위치는 main 에 있던 것이다. #144 의 키보드 계산은 iPad 에서 돌지 않았다
- 폰은 배율이 1 이라 이 원인에 해당하지 않는다. iPhone 시뮬레이터 Safari 에서 셸은 714/714 로 찬다. nav 아래 빈 공간은 Safari 하단 도구막대 자리이거나, 설치 앱이면 안전 영역 + 8px 일 수 있다. 설치 앱에서는 재지 못했다

## 고친 것

- iOS · iPadOS 에서 `--ui-zoom` 을 1 로 둔다(`@supports (-webkit-touch-callout: none)`). 값을 엔진에 맞추면 iOS 버전이 올라갈 때 반대로 깨질 수 있어 배율을 없앴다. **iPad 화면 배율이 110% 에서 100% 로 내려간다**
- 키보드 판정을 터치 기기 전체로 넓혔다. 안드로이드 태블릿은 zoom 이 남아 있어 맞춤 높이도 배율로 나눈다
- md 이상의 `--nav-offset-bottom` 을 `--safe-bottom` 으로 — iPad 입력창이 홈 인디케이터에 겹치지 않는다. PC 는 0
- 뱃지를 버튼 가장자리가 아니라 가운데 기준으로 놓는다
- 대화 패널 높이를 `--app-vh` 로 재서 키보드와 함께 줄어든다. PC 는 위 8px · 아래 0.5rem 그대로다

## 시험

- 수정 전 코드에 새 e2e 를 돌리면 11건 중 6건 실패(뱃지 · 키보드 · 패널)
- 수정 뒤 데모 빌드: `ipad-viewport` · `mobile-keyboard` · `mobile-no-panel` · `composer-plus-sheet` · `new-chat-entry` · `room-composer` · `chat-task` · `shortcuts` 53건 통과, 1건 건너뜀
- `scripts/verify-ios-viewport.mjs`(iOS 26.0.1 시뮬레이터 Safari): iPad 가로 `{"inner":734,"shellBottom":734,"uiZoom":"1","badgeTop":34.5}`, iPhone `{"inner":714,"shellBottom":714,"uiZoom":"1"}`
- `narrow-audit`: 수정 전후 88행이 같다. 25/88 은 이 변경 전부터 있던 값이다

## 확인하지 못한 것

- 실제 iPad · iPhone
- 실제 화면 키보드: 시뮬레이터 자동화로 키보드를 띄우지 못해 `visualViewport` 모의로만 봤다
- 설치한 PWA: 시뮬레이터에서도 재지 못했다
- 보고된 빈 공간은 약 270px 이고 시뮬레이터 iPad Air 11 가로는 66.7 CSS px(기기 133px)이다. 기기 · OS · 보고 단위 차이인지 확인하지 못했다
