---
kind: guide
status: active
canonical: mydocs/manual/ai-pairing.md
last_verified: 2026-09-14
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
