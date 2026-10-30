---
kind: snapshot
status: active
canonical: mydocs/manual/ux-rules.md
last_verified: 2026-10-30
---

# 랜딩 모션 스토리 로컬 확인

계획 승인 후 구현. 사용자 로컬 시각 검토 대기. 서버는 http://localhost:3001 이다. 3000은 다른 체크아웃(omnis-hadd-logo)의 서버라 건드리지 않았다.

## 변경

- 고정 장면의 스크롤 진행도에 따라 아이콘 이동·헤더 등장·메시지·AI 문제·AX 전환.
- 실제 제품 구성을 참고한 가상 UI로 업무 지시부터 초안까지 7단계 자동 시연. 장면 선택·일시정지·재생·다시 보기·건너뛰기 지원.
- 도입 효과 세 가지·비전·로그인 CTA·문의 안내·푸터. 문의는 확인된 외부 연락처가 없어 페이지 내 안내로 연결.
- 시연 데이터는 가상이며 실제 업무 생성·AI·MCP 호출은 없다.

## 실행 결과

`pnpm run verify`: exit 0 (typecheck, eslint). 타이머 수정 후 재실행.

`pnpm run build`: exit 0. 출력:
```
✓ Compiled successfully in 32.4s
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```
이 빌드 뒤 타이머의 시간차 계산을 수정했다. 수정 후 타입·린트와 브라우저 초안 표시를 확인했다.

`curl http://localhost:3001`: HTTP 200.

Playwright 로컬 브라우저 실측:
```
landing 1
1440 false
390 false
320 false
200 false
automatic answer: 어느 고객사를 위한 제안서인가요? 제출 기한과 제안 범위도 알려주세요.
paused: 1
reduced motion paused: 1
draft count: 1
```
false는 문서 가로 넘침 없음. 초안 전환 검증 중 타이머의 지연 상태 업데이트가 변경된 previous를 참조하는 문제를 발견해 delta를 먼저 고정하도록 수정했다.

`BASE_URL=http://localhost:3001 ROUTES=/ node scripts/narrow-audit.mjs`:
```
320/280/240/200px: overflow=0 bleed=0 clip=0 ellip=0 tiny=1
잘리거나 넘친 화면: 0 / 4
```
기존 tiny=3 중 랜딩 링크 둘은 수정했다. 남은 이름 없는 36×44 button은 개발 도구 버튼으로 추정되며 추가 식별은 하지 않았다.

`git diff --check`: 출력 없음.

전체 feature e2e는 실행하지 않았다. 기존 사용자 흐름·실제 DB 쓰기는 변경하지 않았으며 랜딩은 별도 브라우저로 확인했다. UX 11~30 중 관련 항목은 키보드 포커스·모바일 대응·재생 제어·장식 구분을 적용했다. 전체 장면의 시각적 품질과 문구 간 연결은 사용자 검토가 필요하다.

## 로컬 검토 피드백 반영

- 다른 AI에 동일 질문을 보내고 각 답을 받는 장면을 추가했다. 그 다음 고민 문구를 흩어 표시하고 AI 도입 → AI 전환 → AX 어떻게 하지?로 전환한다.
- 실제 `AgentCard`와 `ToolTrail`을 가져다 쓴다. 나머지 시연 셸은 실제 MessengerShell의 방 목록·새 대화 FAB·옴니스 메뉴·입력 구성을 참고한 재현이다. 전체 앱을 직접 실행하는 영상 녹화는 아니다.
- 새 대화·보내기·확인 위치에 포인터와 클릭 파동을 표시한다. 확인 카드는 PENDING → APPROVED → EXECUTED로 전환하고 별도 업무 생성 완료 표시를 남긴다. 실제 쓰기는 없다.
- 관리자와 사원의 각 대화는 누적되며, 화면 높이를 넘으면 대화 안쪽에서 자동으로 스크롤한다. 카드와 새 메시지를 넣을 때 대화가 늘어나 셸을 밀던 min-height 문제를 수정했다.

실행 출력:
```
pnpm run verify: exit 0, 0 errors, 37 warnings (수정한 랜딩 외 파일 경고)
Playwright:
pending 1 messages 4
executed 1 created 1 messages 5
draft 1 employee messages 6
final draft 1
scroll { top: 634, height: 990, client: 356 }
overflow 390 false
overflow 320 false
overflow 200 false
errors []
```
확인 버튼 클릭 전후 상태와 누적 메시지 수, 마지막 장면의 실제 타이머 재생·초안·대화 스크롤을 검사했다. 가속 시계를 사용한 전체 자동 타임라인 검사는 기존 performance 타이머와의 시각 차이로 기대 시점에 상태가 일치하지 않아 통과 근거에 포함하지 않는다.

`BASE_URL=http://localhost:3001 ROUTES=/ node scripts/narrow-audit.mjs` 재실행:
```
320/280/240/200px: overflow=0 bleed=0 clip=0 ellip=0 tiny=0
잘리거나 넘친 화면: 0 / 4
```

타입·린트 후 `pnpm run build` 재실행 exit 0. 출력은 `✓ Compiled successfully in 19.0s`, 라우트 생성 완료. 전체 feature e2e는 이번에도 미실행.

## 추가 시각 피드백 반영

- 플레이어 컨트롤을 화면 내부 hover/focus-within 오버레이로 이동했다. 터치에서는 상시 표시한다. 실제 Button과 Hugeicons를 적용했다. 진행 막대 두 종류는 사용자 지시로 제거했다.
- 헤더에 OmnisMark를 고정하여 도입 영역 밖에서도 아이콘이 남는다. 첫 중앙 아이콘에는 느린 부유 효과를 넣었다. 영문 eyebrow는 전부 삭제했고 등장 이동량과 페이드를 부드럽게 했다.
- 공통 질문창은 기존 glass 유틸리티와 전송 아이콘을 적용했다. Claude·ChatGPT·Gemini·Grok 화면은 각 서비스의 색·입력창·툴바를 구분한 코드 재현이며 원본 서비스 UI 코드를 복제한 것은 아니다. 참고: https://claude.com/product/overview · https://chatgpt.com/overview/ · https://gemini.google/overview/ · https://grok.com . 실제 응답이나 기능 비교가 아닌 가상 상황이다.
- 도입은 휠/스와이프 한 제스처마다 한 장면씩 멈추고 같은 제스처의 관성은 소비한다. 키보드 방향키·PageUp/Down·Space도 연결했다.
- Omnis 단어는 한 개의 공유 요소로 유지하며 첫 문장에서 두 번째 문장의 위치로 이동한다.
- 업무 시연은 190svh 트랙의 sticky 화면으로 바꾸었다. 스크롤로 소개에서 헤더 아래 전체 화면까지 확대한 후 재생하고 축소 시 멈춘다. 대화창 overscroll containment가 소개 구간의 페이지 스크롤을 막던 원인을 제거했다.

브라우저 실행 출력:
```
providers 4 header mark true
hidden 0
hover 1
inside 1
overflow 390 false / 320 false / 200 false
errors []
one gesture 0.20506666666666667
two gestures 0.37506666666666666
eyebrows 0 float 1
hero first { x: 362.15625, y: 507.625, width: 221.28125, height: 91 }
hero next { x: 577.765625, y: 355.78125, width: 221.28125, height: 91 }
progress bars 0
intro { x: 24, y: 274, width: 1392, height: 700 }
expand 1 box { x: 0, y: 76, width: 1440, height: 924 }
```
`pnpm run verify`: exit 0 (0 errors, 37 warnings, 랜딩 외 기존 경고). 최신 스크롤 확대 변경까지 빌드 실행, 마지막 overscroll CSS 보완은 브라우저로 재확인했다. 전체 feature e2e는 미실행.

## 타이핑·흡수 전환과 컨트롤 보완

시작 안내의 선을 없애고 텍스트 밝기 변화로 대체했다. 공유 Omnis의 소스/도착 장면에 translate를 없애고 left/top의 지연 추적을 제거해 직선 경로로 연결했다. 다음 문장과 AI 질문은 타이머로 타이핑한다. AI 질문창 가로 확장이 끝난 뒤 타이핑하고 Claude→ChatGPT→Gemini→Grok 순으로 등장한다. 카드 hover는 scale 1.09다.

고민 문구는 10개, 이모지는 3개로 줄였다. AI 도입이 나와도 고민을 유지하고 다음 장면에서 좌표가 중앙에 수렴하며 축소·흐림·페이드되고 AI 전환이 된다. 시작 안내는 후속 장면에서 visibility를 숨긴다.

Arial 오버라이드를 확인해 디자인 시스템의 `var(--font-sans)`로 교체했다. computed font는 Pretendard Variable이다. 헤더 로고는 기존 `/Users/jeong-uchang/work/omnis-hadd-logo/public/hadd-logo-white.png` 원본을 이 저장소 public으로 복사했다. PNG 전역 ignore 대상이라 이 파일만 명시적으로 추적한다. 작업 흐름 안내 링크는 제거했다.

컨트롤은 hover/focus-within 지속 표시 대신 포인터 활동 후 2초 타이머로 숨긴다. 키보드 focus-visible 접근은 유지한다. 시연 구간은 wheel capture에서 한 제스처 최대 150px로 이동하고 관성을 소비한다. 터치에서 이 마지막 wheel 속도 제한은 적용되지 않는다.

브라우저 출력:
```
question typing 우 first opacity 0
question full 우리 회사 고객사 제안서 작성해줘.
scale 1.09
film scroll delta 150
controls shown 1
controls hidden 0
font "Pretendard Variable", Pretendard, -apple-system, "system-ui", system-ui, sans-serif logo true
0.745 title AI 도입 worry { opacity: '1', left: '388.797px' }
0.795 title AI 전환 worry { opacity: '0.10963', left: '683.688px' }
```
흡수 끝점을 0.800에서 0.790으로 보완해 0.795 정지점에서는 완전히 사라지게 했다. 입력창 전체 span에 원형 버튼 배경이 적용되는 문제는 `.question-send` 전용 선택자로 고쳤다.

`pnpm run verify`: exit 0, 0 errors, 37 warnings. `BASE_URL=http://localhost:3001 ROUTES=/ node scripts/narrow-audit.mjs`: 320/280/240/200 모두 overflow=0 bleed=0 clip=0 ellip=0 tiny=0, 잘리거나 넘친 화면 0/4. 빌드는 현재 변경으로 실행했으며 마지막 흡수 끝점·시작 안내 visibility는 빌드 시작 뒤 추가했다. 전체 feature e2e 미실행.

## 검토 뒤 수정 (2026-10-30)

1. 헤더 바탕 `#080b1280` → `#080b12eb` — 밝은 시연 위에서 탁한 회색이 되던 것
2. 폰(≤767px)에서 `.cinema-wordmark span` 숨김이 옴니스 마크 · 구분선까지 숨기던 것 → 「업무의 새로운 흐름」 링크만 숨긴다
3. 시연 재생 시작을 확대 0.95 → 0.6, 시연 고정 구간 190svh → 280svh — 스크롤하는 동안 빈 화면만 보이고 지나가던 것
4. 문의하기 → `mailto:jwoochang@haddscience.com` (2026-10-29 결정)
5. 시연 화면이 60% 미만으로 보이면 멈춘다(IntersectionObserver ratio)

실측(Chromium 1440 · 390): 스크롤 중 7번째 제스처에 「02 업무 지시」로 진행 · 시연을 지나친 뒤 12초 동안 장면 그대로(멈춤) · 폰 헤더 마크 보임 · 문의 href mailto · 가로 넘침 없음.

## 최신 main 으로 옮기고 시연을 실제 메신저 컴포넌트로 (2026-10-30)

- 모션 랜딩을 `components/landing/motion/` 으로 옮겨 `/` 에 건다. v2 는 `/landing/v2`(noindex), 그 전 것은 `/landing/legacy` 그대로
- 시연 창에 `data-messenger` — 실제 컴포넌트가 메신저 안과 같은 크기를 쓴다. 랜딩이 따로 정하던 색 변수(`--primary: #536bd0` …) · 확인 카드 크기 덮어쓰기를 걷었다
- 대화 칸: RoomHeader · OmnisWelcome · MyMessage · OmnisMessage · LiveOmnis · AgentCard · Composer (omnis-room.tsx 의 첫 화면을 `OmnisWelcome` 으로 꺼냈다)
- 목록: `RoomRowPreview` — 실제 목록 줄의 보이는 부분(`RoomRowContent`)을 꺼내 메뉴 · 밀기 · 링크 없이 그린다
- 도구 줄은 옴니스에 실제로 있는 도구만(get_task · search_knowledge · get_context). 대사의 「공개 자료 검색 · 문서 도구」 문구는 그대로 두었다 — 작업지시자 확인 필요
- 시연에만 있는 덧붙임(업무 생성 완료 · 우선순위 · 제안서 초안)은 랜딩 마크업 그대로

실측: `pnpm run verify` 에러 0(경고 40 — main 과 같다). landing.spec 3/3 · onboarding.spec 8/8(첫 회 1건은 dev 의 /omnis 첫 컴파일 60초 초과, 다시 돌려 통과) · chat-folders · omnis-hub 통과(BASE_URL=http://localhost:3004).
