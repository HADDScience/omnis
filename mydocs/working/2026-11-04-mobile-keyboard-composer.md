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

# 폰의 ＋ 메뉴를 바텀시트로

- 터치 폰 폭에서 ＋ 는 `ComposerPlusSheet`(`components/ui/drawer.tsx`, vaul)를 연다. 손잡이 · 어두운 바탕 누르기 · 아래로 밀기로 닫는다. 키보드가 열려 있으면 입력칸 포커스를 풀어 내린 뒤 연다. PC 와 터치가 아닌 좁은 창은 기존 메뉴다
- 항목은 메뉴와 같은 목록(`ComposerPlusAction`)이다. 시트에만 「사진」 이 더 있고, 이것은 파일 고르기를 `accept="image/*"` 로 좁힌 것이다. 데모는 지금처럼 첨부 항목이 없다
- 항목은 시트를 닫은 같은 탭 동작 안에서 부른다 — 파일 고르기 창과 키보드는 사용자 동작 안에서만 열린다. `focusAt` 도 그래서 포커스를 먼저 준다
- `capture` 를 주지 않는다. [MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) 대로 주면 촬영을 지시하게 되어 보관함을 고를 수 없다. [MDN input file](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file) 은 `accept="image/*"` 에서 많은 모바일 기기가 촬영도 고르게 한다고 적는다

## 최근 사진 가로 목록을 만들지 않은 이유

웹이 파일을 받는 길은 사용자가 고른 파일(`input.files`)이다. 사진 보관함을 목록으로 읽는 웹 API 를 찾지 못했다. 네이티브 앱의 권한 모델과 다르다.

## 시험

- `tests/feature/composer-plus-sheet.spec.ts`(데모 빌드 — 열기 · 닫기 · 언급 항목 · PC 메뉴)
- `scripts/verify-composer-plus-sheet.mjs`(일반 빌드 — 네 방 항목, 사진 · 파일 · 시놀로지, 첨부 유지). 데모 빌드에 첨부가 없어 CI 에는 들어가지 않는다
- 실제 아이폰에서 고르기 창의 메뉴 구성 · 밀기 감각 · 키보드 내림과 시트가 겹치는 순간은 확인하지 못했다
