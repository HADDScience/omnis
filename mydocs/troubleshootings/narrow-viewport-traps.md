---
kind: reference
status: active
canonical: mydocs/manual/ux-rules.md
last_verified: 2026-09-09
---

# 좁은 뷰포트 · 터치 타깃에서 실제로 밟은 함정

[`working/2026-09-09-narrow-viewport-and-inventory.md`](../working/2026-09-09-narrow-viewport-and-inventory.md)
작업에서 나온 것들. 다음에 같은 자리를 밟지 않으려고 적는다.

## 1. `truncate` 는 `min-w-0` 없이는 먹지 않는다 — 그리고 조용히 부모를 밀어낸다

```tsx
// 잘못
<div className="flex items-center gap-2">
  <Badge />
  <span className="text-xs truncate">{긴 제목}</span>
</div>
```

flex 아이템의 기본 `min-width` 는 `auto` 라 콘텐츠보다 작아지지 못한다. `truncate` 가
말줄임을 만들지 못하고 **줄 전체가 부모를 밀어낸다.** 부모가 `overflow-hidden` 인
Card 면 잘린 채로 조용히 넘어간다 — 스크롤바도 안 생겨서 눈치채기 어렵다.

실측: 팀원별 현황 카드가 200px 에서 **145px** 을 잘라내고 있었다.

```tsx
// 맞게
<span className="min-w-0 flex-1 line-clamp-2 text-xs">{긴 제목}</span>
```

## 2. `max-w-[NNpx] truncate` 는 화면 폭과 무관하게 자른다

칸반 프로젝트 칩이 `max-w-[160px]` 이었다. 320px 든 1440px 든 항상 같은 자리에서
잘린다 — 좁은 화면 문제가 아니라 **넓은 화면에서도 이미 잘려 있었다.** 실측에서
12건 전부, 최대 110px.

폭 상한은 부모에게 맡기고(`max-w-full`), 넘치면 줄을 접는다.

## 3. 미디어쿼리의 `rem` 과 문서의 `rem` 은 기준이 다르다

미디어쿼리 안의 `rem` 은 **루트 글꼴이 아니라 초기값(16px)** 을 본다. 그래서
`--breakpoint-xs: 22.5rem` 은 루트가 13px 이어도 360px 이다(의도대로).

하지만 문서 안의 `rem` 은 루트를 따른다. 루트가 81.25% 면 **Tailwind 크기가 전부
81.25% 로 줄어든다.**

```
h-8   = 2rem     → 26px    (32px 아님)
h-12  = 3rem     → 39px    (48px 아님)
min-h-11 = 2.75rem → 35.75px  ← 44px 을 의도했는데 35.75px 이다
```

**터치 타깃 44px 은 rem 유틸리티로 만들 수 없다.** `min-h-11` 을 쓴 5곳이 실제로는
35.75px 이었다. px 로 직접 쓴다 — `globals.css` 의 `.touch-target`.

## 4. `.touch-target` 은 정의만 있고 아무도 안 쓰고 있었다

`@media (pointer: coarse)` 안에 `min-height: 44px` 규칙이 있었지만 `.touch-target` 을
붙인 TSX 가 **0곳**이었다. 규칙이 있다고 지켜지는 게 아니다.

```bash
# 규칙을 넣었으면 쓰이는지 센다
grep -rc "touch-target" --include='*.tsx' app components
```

## 5. 44px 버튼은 39px 헤더에 안 들어간다

`.touch-target` 을 붙이면 버튼이 44px 이 되는데 헤더가 `h-12`(=39px, 위 3번)라
버튼이 헤더를 뚫는다. 헤더부터 키워야 한다 — 터치 기기에서만.

```tsx
className="... h-12 [@media(pointer:coarse)]:h-[52px]"
```

## 6. `TabsList` 는 높이가 고정이다

`h-9` 로 못 박혀 있어서, 트리거가 두 줄이 되거나 44px 터치 타깃을 받으면 **활성 탭
박스가 바 밖으로 삐져나온다.** 트리거에 높이를 주지 말고 바가 자라게 한다
(`h-9` → `min-h-9`).

## 7. `Separator` 의 `data-vertical:self-stretch` 가 `h-4` 를 이긴다

`className="h-4"` 를 줘도 세로 구분선이 가운데가 아니라 **맨 위에 붙는다.**
`[data-vertical]` + 클래스 = 특이도 (0,2,0) 이라 `self-center`(0,1,0)로는 못 이긴다.
`self-center!` 로 누른다.

## 8. Playwright 의 `isMobile: true` 는 `pointer: coarse` 를 주지 않는다

```js
{ isMobile: true, hasTouch: true }  →  matchMedia("(pointer: coarse)").matches === false
{ hasTouch: true }                  →  true
```

`isMobile` 을 켜고 재면 **터치 전용 CSS 가 빠진 채로 측정된다.** 같은 스크립트를
`hasTouch` 만으로 돌려야 실제 폰과 같은 규칙이 적용된다.

`hasTouch: true` 만 켜도 실행마다 `coarse` 가 뒤집히는 경우를 봤다(CSS 재빌드 타이밍
추정). 재기 전에 `matchMedia("(pointer: coarse)").matches` 를 같이 찍어 두면 어느
모드로 잰 값인지 남는다.

## 9. `buttonVariants()` 는 서버 컴포넌트에서 못 부른다

`components/ui/button.tsx` 가 `"use client"` 라서다.

```
Attempted to call buttonVariants() from the server but buttonVariants is on the client.
```

서버 컴포넌트에서 링크에 버튼 모양을 입히려면 클래스를 직접 쓴다.

## 10. `vercel deploy` 는 커밋하지 않은 것까지 올린다

작업 트리를 그대로 업로드한다. 다른 세션의 미커밋 변경이 있으면 **검증하지 않은 남의
작업이 운영에 올라간다.**

```bash
git worktree add --detach <dir> origin/main
git -C <dir> merge --no-ff <내 브랜치>
cp -R .vercel <dir>/.vercel
cd <dir> && vercel deploy --prod --yes
```

홈페이지(`hadd-website`)는 2026-09-08 부터 **main 푸시가 곧 배포**라 이 문제가 없다.
Omnis 는 아직 수동이다.

## 11. Next dev 서버가 스윕 중에 스스로 재시작한다

72번 페이지를 도는 동안 컴파일 캐시가 불어나 이 경고와 함께 재시작했다.

```
⚠ Server is approaching the used memory threshold, restarting...
```

그 구간의 `page.goto` 가 `ERR_CONNECTION_REFUSED` / 타임아웃으로 실패한다. 측정값이
아니라 서버 상태 문제이므로 그 행은 버리고 다시 잰다.
