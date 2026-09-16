---
kind: guide
status: active
canonical: mydocs/manual/ai-pairing.md
last_verified: 2026-09-16
---

# 기존 데이터와 분리된 전체 E2E

```bash
npm run test:e2e:local
# 한 흐름만 재현
npm run test:e2e:local -- --grep 'REGRESSION|API로 첫'
```

로컬 PostgreSQL(pgvector 설치, CREATE DATABASE 권한), 설치된 node_modules·Prisma Client·Playwright Chromium, `.env`의 로컬 DATABASE_URL과 인증 설정이 필요하다. AI 자동완성 검증은 GEMINI_API_KEY로 실제 호출하며 fallback 응답을 통과로 취급하지 않는다.

실행기는 localhost/127.0.0.1/IPv6 loopback만 허용한다. 랜덤 이름 `omnis_e2e_*` DB를 새로 만들고 모든 마이그레이션과 익명 데모 시드를 적용한다. 기존 DB에 시드를 실행하지 않는다. 임시 앱 복사본과 3002번 포트를 사용하므로 3000번 개발 서버와 빌드 디렉터리가 충돌하지 않는다. 3002번이 이미 사용 중이면 중단한다.

데모 5인 계정은 일반 기능 검증을 위해 온보딩을 완료한 상태로 준비한다. 온보딩 테스트 자체는 별도 최초 접속 계정을 생성하고 삭제한다. 앱의 인증 페이지와 주요 경로를 먼저 준비하여 개발 컴파일 시간을 브라우저 조작 시간과 분리한다.

전체 feature 프로젝트를 재시도 없이 실행한다. 이 모드에서는 실패 스크린샷·오류 컨텍스트를 남기고 영상·trace는 끈다. 통과하거나 테스트가 실패하면 실행기가 자신의 서버를 종료하고 임시 DB를 삭제한다. 앱 복사본과 server.log, test-results, playwright-report는 출력된 임시 경로에 남는다. OS 강제 종료로 정리되지 않았다면 출력된 임시 DB 이름과 서버를 확인해서 해당 자원만 정리한다.

`npm run test:e2e`는 기존처럼 이미 준비된 서버에 대해 실행한다. 개발 DB의 데모 계정·데이터가 없으면 전체 기능 게이트용으로 `test:e2e:local`을 사용한다. scenario·legacy 프로젝트는 feature 게이트와 별도다.

## 시나리오 테스트 (`npm run test:scenario`)

여러 사람이 동시에 로그인해 채팅 · 스레드로 일하는 흐름을 한 테스트 안에서 돌린다(`tests/scenario/`). 목킹이 없고 Gemini 도 실제로 부른다.
이미 떠 있는 서버와 그 DB 의 계정을 쓰므로 **점검용으로 새로 만든 로컬 DB** 에서 돌린다.

| 환경변수 | 뜻 |
|---|---|
| `E2E_ACCOUNTS` | 출연자 계정 JSON `{"이름": "비밀번호", ...}`. 없으면 `E2E_ACCOUNTS_FILE`, 그것도 없으면 `tests/scenario/accounts.local.json`(저장소에 올리지 않는다) |
| `E2E_RECORD_DIR` | 있으면 `createActor` 가 사람마다 `<폴더>/<이름>/` 에 화면을 녹화한다(1280×800) |

- **Playwright 설정의 `video` 는 여기에 닿지 않는다.** 설정은 러너가 만드는 컨텍스트에만 적용되고, `createActor` 는 `browser.newContext()` 로 직접 만든다. 그래서 녹화는 `E2E_RECORD_DIR` 로 `recordVideo` 를 준다.
- **`replyInThread` 는 「옴니스가 업무를 갱신하고 있어요」 줄이 뜨는 것을 먼저 기다리고(최대 10초), 사라지는 것을 기다린다(최대 120초).** AI 재구성이 응답 뒤에 돌기 때문이다(PR #16). 뜨기 전에 「없음」 을 확인하면 AI 가 끝나기 전에 다음 글을 보낸다 — 2026-09-15 녹화에서 진행 · 완료 보고가 2초 간격으로 나갔다. 재구성이 첫 확인보다 빨리 끝나 줄을 못 보면 넘어간다.
- **`/업무` 창의 담당자 칩은 이번 명령의 옵션 · @멘션 초기값이 들어온 뒤에만 나타난다.** 그 전에는 자리 표시(펄스)만 있고 AI 자동완성 버튼도 잠긴다. 창을 다시 열 때 직전 칩을 누르면 곧이어 들어온 초기값에 되돌려졌다(PR #16). 칩을 누르는 단계는 칩이 보이는 것을 기다린 뒤에 누른다.
- 새 브라우저 컨텍스트에서는 오른쪽 패널이 닫혀 있다 — `openPanel` 이 헤더의 「채팅 열기」 부터 누른다.
