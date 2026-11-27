---
kind: guide
status: active
canonical: mydocs/manual/govgrants-import.md
last_verified: 2026-11-27
---

# 국가과제 공고 — 수집기(govgrants) → GrantNotice cron

수집기(gov-grants 저장소의 GitHub Actions `collect-biweekly`)는 2주마다 월요일 07:00 KST 에 돈다. 돈 결과는 운영 Neon 의 `govgrants` 스키마(`runs` · `notices`)에 쓴다.
옴니스는 하루 cron(`/api/cron/daily`, 매일 04:00 KST)의 한 단계로 그 결과를 `GrantNotice` 로 옮긴다. 그래서 화요일 아침에 반영된다. 코드는 `lib/govgrants-sync.ts`, 규칙은 `lib/govgrants-sync-rules.ts` 에 있다.

## 무엇을 하나

- **어떤 실행을 옮기나:** `govgrants.runs` 중 status 가 success · partial 이고, 옴니스 `GovgrantsImport` 에 ok 로 남지 않은 실행을 오래된 순으로 옮긴다.
- **어떤 공고를 읽나:** 실행마다 `govgrants.notices` 에서 `last_run = 실행 id` 이고 `removed_run` 이 없는 공고다.
- **변환:** `noticeRow`(`lib/grants-import.ts`)로 만든다. `scripts/import-grants.ts` 와 같은 변환이다.
- **쓰는 규칙**
  - **새 공고**는 만든다.
  - **있던 공고**는 **바뀐 칸만** 고친다. 하나도 안 바뀌면 쓰지 않는다.
  - 새 값이 비어 있는 근거 · 첨부는 그대로 둔다(지우지 않는다). 가점 칸(`bonus*`)은 건드리지 않는다.
  - 첨부 크기는 아는 값을 지킨다. Neon 에 크기가 없는 첨부가 로컬 이식 때 받은 크기를 지우지 않게 한다.
  - **빠진 공고**(`removed_run`) · 마감이 지난 공고는 지우지 않는다. import-grants 와 같다.
- **쓴 쪽 표시:** 20건씩 트랜잭션으로 쓰고, 트랜잭션마다 `omnis.actor_kind=source` 를 건다(`lib/import-actor.ts` 와 같은 표시, #288).
- **기록:** 실행마다 `GovgrantsImport` 한 줄이 남는다(새 · 고침 · 그대로 수, 칸마다 바뀐 수). govgrants 쪽에는 쓰지 않는다 — `runs.imported_at` 은 비어 있는 채로 둔다.
- **실패:** `GovgrantsImport` 에 failed 로 남기고, 운영 알림 메일과 GitHub 이슈(「국가과제 공고 옮기기 실패」)를 보낸다. 다음 날 cron 이 다시 한다.
  - 앞 실행이 실패하면 뒤 실행은 옮기지 않는다. 옛 값이 새 값을 덮지 않게 하려는 것이다.

## 읽기 전용 연결 — `GOVGRANTS_READ_URL`

옴니스는 govgrants 를 **읽기만 하는 역할**로 읽는다. 수집기의 쓰기 역할(`govgrants_writer`)이나 옴니스 앱의 소유자 역할로 govgrants 를 읽지 않는다.
읽기도 `SET TRANSACTION READ ONLY` 트랜잭션 안에서만 한다.

**역할 만들기**(운영 Neon, 관리 접속 — 한 번). Neon 은 비밀번호를 평문 리터럴로만 받는다.

```sql
CREATE ROLE govgrants_reader LOGIN NOINHERIT CONNECTION LIMIT 3 PASSWORD '<새 비밀번호>';
ALTER ROLE govgrants_reader SET default_transaction_read_only = on;
ALTER ROLE govgrants_reader SET statement_timeout = '60s';
GRANT USAGE ON SCHEMA govgrants TO govgrants_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA govgrants TO govgrants_reader;
-- 수집기가 나중에 표를 더해도 읽을 수 있게(govgrants 의 표는 neondb_owner 가 만든다)
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA govgrants GRANT SELECT ON TABLES TO govgrants_reader;
```

**환경변수**(Vercel omnis-hadd · Production): `GOVGRANTS_READ_URL` = `postgresql://govgrants_reader:<비밀번호>@<직결 호스트>/neondb?sslmode=require`

- 풀러(-pooler) 말고 직결 호스트를 쓴다. 대화형 트랜잭션으로 읽기 때문이다.
- env 는 새 배포에만 반영된다.
- 값이 없으면 cron 은 이 단계를 건너뛴다(`govgrants: { configured: false }`). 알림은 보내지 않는다.

## 손으로 돌리기

```bash
GOVGRANTS_READ_URL=… npx tsx scripts/govgrants-import.ts            # 건식 — 옮길 실행 · 새 · 바뀐 칸 · 그대로 건수만
GOVGRANTS_READ_URL=… npx tsx scripts/govgrants-import.ts --apply    # cron 과 똑같이 쓴다
```

- 건식은 아무것도 쓰지 않는다. 마이그레이션 전 DB(`GovgrantsImport` 표 없음)에서도 돈다.
- 운영을 읽어 건식할 때는 연결 주소에 `options=-c%20default_transaction_read_only%3Don` 을 붙여 연결째 읽기 전용으로 둔다.

## 로컬 import-grants 와 겹침

`scripts/import-grants.ts` 도 공고를 upsert 한다. cron 이 붙은 뒤에는 공고를 두 길이 쓴다.
- 같은 열쇠 · 같은 변환이라 결과는 같다. 다만 로컬 내보내기가 Neon 보다 낡았으면 옛 값이 잠깐 돌아올 수 있다.
- 인증 · 우리 결정은 Neon 에 없으니 지금처럼 로컬 import-grants 로 옮긴다.
