---
kind: snapshot
status: active
canonical: mydocs/plans/2026-09-14-omnis-onboarding.md
last_verified: 2026-09-14
---

# Omnis 온보딩 구현·검증

사용자 승인 뒤 `feat/omnis-onboarding`에서 구현했다. 초기 구현 시점에는 main 머지·push·운영 DB 적용·배포를 수행하지 않았다. 이후 사용자 배포 요청과 전체 E2E 복구 결과는 마지막 절을 따른다.

## 구현 결과

- Hub의 중앙 타이포그래피·블러 전환·부유 도형을 Omnis 로고·색상·라이트/다크 토큰으로 옮겼다. 스크린샷을 재생하는 방식이 아닌 React/CSS 애니메이션이다.
- 사용자 추가 요청에 따라 실제 `TaskCard`의 읽기 전용 렌더링을 추가하고 기존 Badge·Checkbox·Avatar·Textarea와 Magic UI ShineBorder를 재사용했다. 예시 카드에는 링크나 업무 쓰기가 없다.
- 8장면이 자동 전환된다. `/업무` 입력, 파일 첨부, AI 정리, 카드 생성, 완료 보고와 담당자 확인, 추가 지시 후 진행 중 상태를 표현한다. 최종 「업무 시작하기」에서 자동 종료를 멈추고 사용자를 기다린다.
- 버튼 뒤 실제 화면을 8단계로 안내한다: 업무 → 대화 버튼 → 대화 영역 → Omnis AI → 회사 도구 → 프로필 → MCP → 다시 보기. 기본 자동 진행에 일시정지·건너뛰기를 제공한다.
- 화면 확대 비율과 모바일을 반영해 DOM 좌표를 측정한다. 모바일 메뉴는 안내 중 비모달로 열어 튜토리얼이 키보드 포커스를 맡는다. 안내 후 메뉴·패널의 원래 열림 상태를 복원한다.
- 이미 열려 있는 대화/AI 탭을 전환하지 않는다. 작성 중인 내용을 보존하며, AI 탭이 열려 있으면 전체 대화로 전환하는 방법을 설명한다. 원래 URL을 바꾸지 않는다.
- 일시정지·비활성 탭에서는 재생 시간을 소비하지 않는다. 모션 감소에서는 블러·부유 효과를 제거하고 자동 전환의 읽기 시간은 유지한다. Escape와 키보드 포커스 순환을 제공한다.
- 프로필의 「온보딩 튜토리얼」에서 재생 가능하다. 「Omnis MCP 등록」은 주소 복사와 기존 OAuth 연결 안내창을 연다. 외부 AI 앱 등록을 완료했다고 표시하지 않는다.
- Magic UI 공식 registry의 ShineBorder와 MIT 라이선스를 포함했다. 출처: https://magicui.design/docs/components/shine-border, https://magicui.design/r/shine-border.json.

## 계정 상태·마이그레이션

`User.onboardingVideoSeenAt`과 `User.onboardingCompletedAt`을 nullable timestamp로 추가했다. 기존 계정도 다음 첫 접속에 안내를 받는다. 영상만 마치면 다음 접속은 스포트라이트부터 시작한다. 건너뛰기도 해당 안내를 본 것으로 저장한다. 다시 보기는 기존 완료 이력을 지우지 않는다.

`/api/onboarding`은 활성 로그인 계정만 읽고 쓸 수 있다. POST 본문은 Zod strict schema의 video/complete만 허용한다. 사용자 ID·완료 시각 직접 지정과 다른 origin을 거부한다. 완료 쓰기는 NULL인 필드만 갱신하여 반복·순서가 바뀐 요청에도 완료 이력이 되돌아가지 않는다. 저장 실패 시 서비스는 계속 사용할 수 있고 토스트에서 다시 저장할 수 있다.

대상 확인: `localhost:5433/omnis`. 로컬 DB에 다른 작업의 마이그레이션 2개가 추가되어 있음을 확인했다. reset이나 기존 이력 수정 없이 `migrate deploy`로 이번 pending migration만 적용했다.

```text
$ npx prisma migrate deploy
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
Applying migration `20260914000000_onboarding`
All migrations have been successfully applied.

$ npx tsx scripts/backfill-onboarding.ts
대상: localhost:5433/omnis
온보딩 백필: 기존 계정 NULL 유지, 기존 완료 기록 보존. 잘못된 상태 0건.
```

백필 스크립트는 기존 사용자가 보았다고 꾸미거나 완료 기록을 초기화하지 않는다. 운영 반영 시 앱 코드보다 먼저 이 마이그레이션을 적용해야 한다.

## 검증 실측

```text
$ npm run verify
> npm run typecheck && npm run lint
> tsc --noEmit
> eslint
✖ 41 problems (0 errors, 41 warnings)
exit 0
```

41개는 기존 파일의 unused-vars·React Hooks·img 관련 경고다. 이번 온보딩 파일에는 오류·경고가 없다.

```text
$ npm run build
> prisma generate && next build --webpack
✓ Compiled successfully in 7.8s
  Running TypeScript ...
✓ Generating static pages using 11 workers (46/46) in 96.9ms
exit 0
```

```text
$ npx playwright test tests/feature/onboarding.spec.ts --project=feature --retries=0
✓ 8장면 자동 재생·일시정지·최종 CTA·스포트라이트
✓ 계정 저장·새 브라우저·다른 계정·재생·MCP 주소 복사
✓ 잘못된 요청·타 계정 쓰기·비활성 계정 거부, 반복 완료 멱등성
✓ 영상만 마치면 스포트라이트부터 재개, 실패해도 서비스 이용 가능
✓ 비활성 탭에서 재생 정지, 키보드 종료, 작성 중인 AI 질문 보존
✓ 모바일·다크·모션 감소에서 메뉴 안내와 종료 버튼 도달
6 passed (47.3s)
```

테스트마다 격리된 임시 계정을 만들고 정리한다. 로컬 DB 외에는 실행하지 않는다. 검증 뒤 `onboarding-` 접두사 임시 계정 잔여는 0건이다. 실시간 DB·HTTP·브라우저를 사용하며, 애니메이션의 시간만 Playwright clock으로 전진시켰다. 실제 캡처에서는 CSS 전환이 끝난 화면을 확인했다.

발견해 수정한 문제:

- React functional updater가 실행되기 전에 기준 시간이 바뀌어 일부 tick이 누락됨 → delta를 먼저 계산하여 고정.
- 모바일 아래쪽 안내창에 기본 top과 bottom이 함께 적용되어 높이가 늘어남 → 아래쪽 배치에서는 top을 auto로 해제. 모바일 안내창 높이 검사 추가.
- Playwright Chromium 다운로드 후 Node 압축 해제가 멈춤 → 다운로드된 동일 압축 파일을 시스템 unzip으로 해제하여 실행.

```text
$ npm start -- --port 3001
$ curl -s -o /dev/null -w 'production /login HTTP %{http_code}\n' http://localhost:3001/login
production /login HTTP 200
$ curl -s -o /dev/null -w 'production /api/onboarding (unauthenticated) HTTP %{http_code}\n' http://localhost:3001/api/onboarding
production /api/onboarding (unauthenticated) HTTP 401
```

로컬 프로덕션 빌드에 대한 HTTP 요청이며 외부 배포본 검증은 아니다.

## 전체 E2E 제한

기존 전체 feature suite의 로그인 전제인 팀장·부팀장·사원1·사원2·사원3 계정이 로컬 DB에 하나도 없다(읽기 조회: `0 / 5`). 따라서 전체 E2E 게이트는 통과하지 못했다. 기존 DB를 demo seed로 덮어쓰지 않았다.

초기 `npm run test:e2e -- --max-failures=3 --retries=0` 실행은 로그인 3건 실패, 2건 통과, 35건 미실행이었다. 동시에 실행한 전용 테스트와 기본 결과 디렉터리가 겹쳐 trace ENOENT도 발생했다. 원인을 구분하기 위해 아래 재실행은 별도 결과 디렉터리를 사용했다.

```text
$ npm run test:e2e -- --max-failures=1 --retries=0 --output=/tmp/omnis-existing-suite-results
✓ 로그인 페이지가 시연용 데모 안내를 표시한다
✓ 잘못된 비밀번호는 에러 메시지를 보여준다
✘ 관리자 계정 팀장 로그인 → 대시보드 진입
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
Testing stopped early after 1 maximum allowed failures.
1 failed
37 did not run
2 passed (1.3m)
```

별도 디렉터리 재실행에서는 trace ENOENT가 없었으며, 동일한 데모 계정 로그인 실패가 재현되었다. 전체 suite 통과로 보고하지 않는다.

## UX 규칙 11~30 점검

- 11~12: native alert/confirm/prompt·빈 핸들러 없음. 데모 카드는 readOnly, 체크박스·우선순위는 disabled이며 이미지 설명 영역 안에 있다.
- 13, 23: 상태 변경 입력은 Zod strict schema, Prisma 변경과 migration·백필 정책/스크립트 포함.
- 14~15: 온보딩·MCP popup은 `--z-dialog`; 기존 DialogHeader/Footer 구조 유지.
- 16~17, 20~22, 24~25, 27~28: 기존 detail/grid/탭 구조 변경 없음. 데모는 전용 읽기 화면이며 상태 배지 표시. MCP 조회는 loading/error/retry 제공.
- 18~19: 예시 대화는 읽기 전용 설명 영역과 Textarea를 함께 표시. 실제 TaskCard의 readOnly 렌더링 재사용.
- 26: 텍스트 버튼·포커스 표시·포커스 순환·Escape·모션 감소 제공. 본문은 Omnis foreground/muted-foreground 토큰 사용.
- 29: 저장·복사 실패는 토스트, MCP 주소 조회 실패는 인라인 오류와 재시도.
- 30: 390×844 모바일 가로 넘침 없음, 버튼 44px 이상, 모바일 사이드바와 안내창 위치 확인. 낮은 화면에서는 소개 화면을 세로 스크롤할 수 있다.

## 화면

![실제 업무 카드로 구성한 자동 재생 장면](onboarding-preview/desktop.png)

![모바일 다크 모드 첫 장면](onboarding-preview/mobile.png)

## 사용자 재시험 중 서버 종료 확인

「업무 시작하기」 오류 제보 뒤 조회에서 3000 포트의 리스너가 없었고 curl은 HTTP 000을 반환했다. 기존 dev 로그에는 해당 시점의 예외가 남아 있지 않았다. 종료된 서버로 인해 지연 로드하는 스포트라이트 청크를 받지 못했을 가능성이 있으나, 사용자 브라우저의 실제 오류 문구는 아직 확인하지 못했다.

서버를 작업 실행 세션과 분리된 프로세스(`start_new_session=True`, stdin DEVNULL, 로그 `/tmp/omnis-onboarding-dev-persistent.log`)로 다시 시작했다. 제품 코드는 변경하지 않았다.

```text
재시작 후 /login: HTTP 200
$ npx playwright test tests/feature/onboarding.spec.ts --project=feature --grep '8장면 자동 재생' --retries=0 --output=/tmp/omnis-onboarding-start-regression
✓ 8장면 자동 재생·일시정지·최종 CTA·스포트라이트 (15.7s)
1 passed (16.3s)
```

업무 시작하기 → 스포트라이트 8단계 → 안내 종료 경로와 브라우저 pageerror 없음 검사를 다시 통과했다. 사용자 기존 오류 화면은 새로고침이 필요하다.

## 화면 잘림·타이핑·스포트라이트 후속 개선

사용자의 잘린 화면 캡처와 후속 요청 2건을 반영했다.

- 장면의 최소 높이가 화면보다 커질 수 있던 flex 구조를 고정 높이 셸로 바꾸고 `ResizeObserver`로 장면과 남은 공간을 측정한다. 설명 장면만 비례 축소하며 헤더·재생 버튼·업무 시작하기 버튼은 바깥에 유지한다. 낮은 모바일에서는 중복 카드 설명과 부가 정보를 줄인다. 기존의 세로 스크롤 방식은 이 방식으로 대체했다.
- 3·4·5번 장면 모두 입력창에 글자가 입력되고, 2.4초에 입력창이 비워지면서 전송 버튼 반응과 말풍선 등장 효과가 시작된다. 이후 파일·AI 응답·업무 상태 변화가 이어진다. 타이핑·전송도 기존 재생 시계와 일시정지·모션 감소 설정을 따른다.
- 스포트라이트의 100ms 간격 추적을 프레임 단위 추적으로 바꾸고, 값이 바뀐 경우만 상태를 갱신한다. 스크롤 컨테이너에 가려진 부분을 제외한 경계에 5px 여백을 둔다.
- 대화 안내는 패널 전체 대신 실제 입력창을 비춘다. 설명창의 실측 높이와 화면 여유에 따라 좌·우·상·하 위치를 선택하고 연결선을 그린다. 이전·다음·일시정지·건너뛰기와 자동 진행 잔여 시간을 제공한다.

```text
수정 전:
$ npx playwright test tests/feature/onboarding.spec.ts --project=feature --grep '낮은 창' --retries=0 --output=/tmp/omnis-onboarding-fit-before
1 failed
Expected: true
Received: false
(장면·하단 버튼이 viewport 안에 모두 들어오는 조건)

수정 후:
$ npx playwright test tests/feature/onboarding.spec.ts --project=feature --retries=0 --output=/tmp/omnis-onboarding-refined-final
✓ 낮은 창과 확대 배율에서도 장면과 재생 버튼이 잘리지 않는다
✓ 업무 지시·완료 보고·추가 지시는 타이핑 후 전송되며 실제 쓰기는 없다
✓ 스포트라이트는 실제 대상에 밀착하고 설명창이 겹치지 않으며 앞뒤로 이동한다
✓ 기존 자동 진행·계정 이력·MCP·거부 사례·저장 실패·입력 보존·모바일 검증 6개
9 passed (1.0m)

$ npm run verify
✖ 41 problems (0 errors, 41 warnings)
exit 0 (기존 경고만)

$ npm run build
✓ Compiled successfully in 6.8s
✓ Generating static pages using 11 workers (46/46) in 181.8ms
exit 0
```

화면 크기/앱 CSS 배율 조합: 1440×800/1.25, 1024×600/1.1, 390×844/1, 320×568/1. 스포트라이트 테스트는 표시되는 테두리와 실제 요소 경계의 차이가 8px 이하이고 설명창과 겹치지 않음을 검사한다. SVG defs 안의 비표시 mask는 좌표 검사 대상에서 제외했다. 브라우저 실제 화면 캡처도 확인했다.

전체 기존 E2E의 데모 계정 부재 제한은 앞 절과 같다. 운영 반영은 하지 않았고, 로컬 서버 `/login` HTTP 200을 확인했다.

![좁은 모바일에서도 재생 버튼과 장면이 함께 표시됨](onboarding-preview/mobile-fit.png)

## 입력·메시지 확대와 스토리 수동 탐색

사용자 요청으로 자동 전용 재생 결정을 변경했다. 좌측 35% 탭은 이전, 우측 65% 탭은 다음 장면이며 자동 재생도 유지한다. 수동 이동은 새 장면을 처음부터 시작한다. 첫 이전·마지막 다음은 비활성이고 최종 CTA는 별도로 유지한다. 명명된 네이티브 버튼으로 키보드 탐색도 제공한다.

업무 지시·완료 보고·추가 지시의 입력창 확대 → 2.4초 전송 시 원위치 → 3.2~5초 전송 메시지 확대 → 전체 업무 상태 확인 순서다. 타이머로 일시정지와 동기화한다. 모바일 확대율은 줄이고 모션 감소에서는 확대를 생략한다. UX 관련 항목: 테마 토큰·기존 UI 재사용·접근 가능한 버튼·모바일 경계·최종 CTA 도달 확인.

```text
$ npx playwright test tests/feature/onboarding.spec.ts --project=feature --retries=0 --output=/tmp/omnis-onboarding-story
11 passed (2.2m)

$ npx playwright test tests/feature/onboarding.spec.ts --project=feature --grep '입력 확대' --retries=0 --output=/tmp/omnis-onboarding-zoom-capture-final
1 passed (10.9s)

$ npm run verify
✖ 41 problems (0 errors, 41 warnings)
exit 0

$ npm run build
✓ Compiled successfully in 9.8s
✓ Generating static pages using 11 workers (46/46) in 104.2ms
exit 0

$ curl localhost:3000/login (HTTP 상태 확인)
200
```

새 검증은 수동 이동 후 타이머 초기화·자동 진행 재개·마지막 장면 대기·확대 단계 순서·일시정지·320/390/1440px 화면 경계·모션 감소를 포함한다. 가상 시계로 재생 시 CSS 등장 애니메이션이 다른 시점을 가리켜 확대 테스트의 스크린샷 저장은 제거하고 DOM 경계와 상태를 검증한다. 기존 전체 E2E의 데모 계정 부재 제한은 앞 절과 동일하다.

## PR·배포 준비 (사용자 요청)

사용자가 PR 생성·머지·배포 확인을 요청했다. origin/main의 변경을 충돌 없이 병합했다. 원격 최신 AGENTS.md에서 자동 배포가 활성임을 확인하여 PR 머지 전에 운영 마이그레이션을 적용했다.

```text
$ npm run verify
0 errors, 41 warnings (exit 0)
$ npm run build
exit 0
$ npm run test:e2e -- tests/feature/onboarding.spec.ts --retries=0 --output=/tmp/omnis-release-onboarding
11 passed (1.7m)
$ npm run test:e2e -- --max-failures=1 --retries=0 --output=/tmp/omnis-release-e2e
1 failed (팀장 로그인), 42 did not run, 2 passed (1.4m)
로컬 데모 계정 읽기 조회: 0 / 5
```

전체 E2E 게이트 예외 여부를 사용자에게 요청했다. 답변 전에는 브랜치 push·PR 생성·머지를 진행하지 않는다. PR 본문은 로컬 임시 파일에 준비했다.

운영 Vercel 환경을 별도 임시 파일로 확인하고 non-pooling Neon 호스트를 검증한 뒤 `npx prisma migrate deploy`를 실행했다. Pending은 이번 `20260914000000_onboarding` 1개뿐이었다.

```text
29 migrations found
Applying migration 20260914000000_onboarding
All migrations have been successfully applied.
컬럼 확인: onboardingCompletedAt / onboardingVideoSeenAt, 모두 nullable YES
잘못된 온보딩 상태: 0
```

앱 운영 배포는 아직 수행하지 않았다. nullable 컬럼만 추가된 상태라 기존 앱과 호환된다.

## 전체 E2E 환경 복구 완료

사용자는 예외 승인을 선택하지 않고 전체 환경 복구를 요청했다. `npm run test:e2e:local`은 로컬 랜덤 DB·임시 앱 복사본·3002 포트를 만들어 기존 DB/3000 서버와 분리한다. 마이그레이션 29개와 데모 시드를 적용하고 일반 기능용 데모 계정은 온보딩 완료 상태로 준비한다. 온보딩 테스트는 별도 신규 계정으로 실제 최초 접속을 검사한다.

복구한 오래된 전제: 채팅 입력 접근 경로·업무 등록 창 제목/필드·업무 메뉴명·배너 문구·카테고리 링크의 정확한 이름·HADD 카테고리 API(`/api/omnis`)·보고서 메뉴 정확한 이름. 캔버스 검증은 대상 부재 시 조용히 통과하던 조건을 없애고 활성화→실제 노드 선택→더블클릭→UUID 상세 URL을 확인한다. AI 테스트는 실제 HTTP 응답과 체크리스트를 검사하고 fallback은 거부한다.

첫 개발 컴파일이 상세 페이지에서 50초 걸리는 사례가 있어 인증된 주요 경로를 먼저 준비한 뒤 브라우저 조작을 측정한다. 격리 모드에서 실패 스크린샷은 유지하고 영상·trace는 끈다. 실행 종료 시 자신이 만든 DB와 서버만 정리한다. 원격 DB 거부도 실제 실행했다. 사용법: `mydocs/manual/e2e-local.md`.

```text
복구 도중 전체 실행: 41 passed, 4 failed → 43 passed, 2 failed
$ npm run test:e2e:local -- --grep 'REGRESSION|API로 첫'
2 passed (10.7s)

최종 전체 실행:
$ npm run test:e2e:local
45 passed (1.8m)
Temporary E2E database removed
(내부 명령: npm run test:e2e -- --retries=0)

$ DATABASE_URL=postgresql://unused:unused@example.invalid/blocked node scripts/e2e-local.mjs
E2E requires a local PostgreSQL host; remote databases are rejected.
exit 1 — DB 생성 전 거부

$ npm run verify
0 errors, 41 warnings (exit 0)
$ npm run build
Compiled successfully in 11.2s
Generating static pages (46/46) in 137.4ms
exit 0
```

이제 전체 feature 게이트의 기존 계정 부재 제한은 해소됐다. 사용자 승인 범위에 따라 PR·머지·운영 배포를 진행한다. 배포 식별자와 운영 HTTP/브라우저 최종 결과는 PR 설명에 기록한다.
