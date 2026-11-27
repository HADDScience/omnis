-- 되돌리기: 20261127230000_object_evidence (공통 층 근거 · 이력 · 제안 표 3개, P3)
--
-- prisma migrate deploy 는 이 폴더를 읽지 않는다 — 손으로 돌린다. P3 시점에는 이 표들을 쓰는 코드가 없어
-- 지워도 화면 · 도구가 바뀌지 않는다. 단, P7 이후 행이 쌓였다면 지우기 전에 내보내 둔다(판단 기록이다).
--
--   psql "$POSTGRES_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261127230000_object_evidence.down.sql
--
-- 다시 돌려도 된다(IF EXISTS). 표와 함께 _prisma_migrations 의 기록 줄도 지운다 — `prisma migrate resolve --rolled-back` 은
-- 실패한 마이그레이션에만 통한다(migration-traps.md). P2 정의 표(ObjectType 등)는 남긴다 — 그 되돌리기는
-- prisma/rollbacks/20261127200000_object_definitions.down.sql 이고, 그것을 돌리려면 이 파일을 먼저 돌린다
-- (Proposal · ObjectRevision 이 ObjectType 을 가리킨다).
--
-- 대상 DB 를 먼저 찍고 확인한다(mydocs/manual/ai-pairing.md 「DB 를 건드리기 전에」). 운영은 작업지시자 승인 뒤에만.

BEGIN;
DROP TABLE IF EXISTS "ObjectRevision";
DROP TABLE IF EXISTS "Evidence";
DROP TABLE IF EXISTS "Proposal";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127230000_object_evidence';
COMMIT;
