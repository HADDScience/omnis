---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-10-login-fixes.md
last_verified: 2026-09-10
---

# 2026-09-10 — 로그인 화면과 소셜 오류 처리

## 변경 내용

- 비밀번호 입력에 표시/숨김 버튼을 추가했다. 버튼은 `aria-label`과 `aria-pressed`를 제공하고, 입력 타입을 `password`와 `text` 사이에서 전환한다.
- 로그인 화면의 바깥 높이를 `100dvh`로 맞추고 내부 영역은 필요한 경우만 스크롤하도록 조정했다.
- 소셜 로그인 콜백의 `error=notlinked`는 연결되지 않은 소셜 계정이라는 뜻이다. 메시지를 한 번 보여준 뒤 `history.replaceState`로 URL의 오류 파라미터를 제거한다. 새로고침이나 이름·비밀번호 재시도 때 이전 소셜 오류가 되살아나지 않는다.

## 조사 결과

프로덕션 로그에서 자격 증명 로그인 성공 요청을 확인했고, 정우창 계정의 이름·비밀번호 로그인도 대시보드로 정상 이동했다. 당시 브라우저 탭의 `notlinked`는 비밀번호 오류가 아니라 연결되지 않은 Google/Kakao 로그인 시도의 결과였다.

## 배포와 검증

- 커밋: `abb6c42`, `4c2c523`, `91a87aa`
- 프로덕션 배포: `https://omnis-hadd.vercel.app` (Vercel READY, 2026-09-10 확인)
- `npm run build` 성공
- 변경 파일 ESLint 성공
- `pnpm lint`는 의존성 재설치 중 pnpm의 빌드 스크립트 승인(`ERR_PNPM_IGNORED_BUILDS`)에서 중단되었고, 배포 빌드와 대상 파일 ESLint로 대체 검증했다.
