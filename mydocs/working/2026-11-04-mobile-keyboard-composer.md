---
kind: snapshot
status: active
canonical: hooks/use-keyboard-open.ts
last_verified: 2026-11-04
---

# 폰 입력창을 키보드 바로 위에 붙인다

## 바뀐 것

- 판정(`lib/keyboard-viewport.ts`): 터치 폰 폭 + 글자 칸 포커스 + `visualViewport` 높이가 폭별 최대에서 120px 이상 줄어듦. 예전 판정은 `innerHeight` 의 3/4 와 비교했고, 판정이 맞아도 nav 자리(`--nav-offset-bottom`)가 비어 있었다
- 포커스가 `RoomComposer`(사람 · 전사 · 업무 · 옴니스 · 대화 패널 공통)면 `html[data-keyboard-docked]` 동안 `--app-vh` 를 보이는 높이로, `--nav-offset-bottom` · `--safe-bottom` 을 0 으로 둔다. 입력창 아래 빈 줄도 걷는다
- 다른 입력 칸(검색 등)은 nav 만 내리고 화면 높이는 그대로다 — 브라우저가 칸을 찾아 올리는 동작을 막지 않는다
- 대화 스크롤 칸(`data-keep-bottom`)은 높이가 바뀌는 동안 맨 아래까지 남은 거리를 지킨다
- md 이상과 터치가 아닌 좁은 창은 판정에서 빠진다

## iOS 키보드 보조 막대(^ v ✓)

앱은 PWA 다(`app/manifest.ts` 의 `display: "standalone"`, `public/sw.js`). 저장소에 Capacitor · Cordova · `ios/` · `android/` 가 없다.

- 웹 페이지에서 막대를 숨기는 표준 · WebKit API 를 찾지 못했다. Apple 이 「안 된다」 고 쓴 문서도 찾지 못했다
- MDN 의 VirtualKeyboard API 는 키보드의 레이아웃 영향만 다루고 이 막대를 다루지 않는다
- WebKit 의 숨김 속성은 앱이 쓰는 `_WKFormInputSession` 쪽이다 — [WebKit 버그 155574](https://bugs.webkit.org/show_bug.cgi?id=155574)
- 앱 래퍼라면 Capacitor Keyboard 플러그인의 `setAccessoryBarVisible({ isVisible: false })` 로 끌 수 있다(iPhone 전용) — [Capacitor 문서](https://capacitorjs.com/docs/apis/keyboard). 도입은 결정 전이고 이번 범위 밖이다

## 시험

- `lib/keyboard-viewport.test.ts`, `tests/feature/mobile-keyboard.spec.ts`(`visualViewport` 모의)
- 실제 아이폰에서는 확인하지 못했다. 특히 iOS 가 화면을 미는 동작을 `window.scrollTo(0, 0)` 로 되돌리는 부분과 키보드가 올라오는 동안의 움직임은 모의로 재현되지 않는다
