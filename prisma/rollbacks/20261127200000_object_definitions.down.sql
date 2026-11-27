-- 되돌리기: 20261127200000_object_definitions (공통 층 유형 정의 표 5개, P2)
--
-- prisma migrate deploy 는 이 폴더를 읽지 않는다 — 손으로 돌린다. 이 표들은 P2 시점에 읽는 코드가 없어
-- 지워도 화면 · 도구가 바뀌지 않는다. 정의는 코드(lib/objects/types)에 있어 objects:sync 로 다시 채울 수 있다.
--
--   psql "$POSTGRES_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261127200000_object_definitions.down.sql
--
-- 다시 돌려도 된다(IF EXISTS). 표와 함께 _prisma_migrations 의 기록 줄도 지운다 — 그래야 다음 migrate deploy 가
-- 이 마이그레이션을 「아직 적용 안 됨」 으로 보고 다시 만든다. `prisma migrate resolve --rolled-back` 은 실패한
-- 마이그레이션에만 통해 여기서는 쓸 수 없다(2026-11-27 로컬에서 「not in a failed state」 로 거절됨).
-- 코드에서도 빼려면 schema.prisma 의 다섯 모델과 마이그레이션 폴더를 지우는 PR 을 낸다. 폴더를 남기면 다음
-- migrate deploy 가 표를 다시 만든다(마이그레이션이 멱등이라 실패하지는 않는다).
--
-- P3(20261127230000_object_evidence) 가 적용된 DB 에서는 그 되돌리기를 먼저 돌린다 — Proposal · ObjectRevision 이
-- ObjectType 을 가리켜(ON DELETE RESTRICT) 이 파일의 DROP TABLE "ObjectType" 이 막힌다.
--
-- 대상 DB 를 먼저 찍고 확인한다(mydocs/manual/ai-pairing.md 「DB 를 건드리기 전에」). 운영은 작업지시자 승인 뒤에만.

BEGIN;
DROP TABLE IF EXISTS "ObjectTypeVersion";
DROP TABLE IF EXISTS "ActionType";
DROP TABLE IF EXISTS "ObjectField";
DROP TABLE IF EXISTS "OptionValue";
DROP TABLE IF EXISTS "ObjectType";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127200000_object_definitions';
COMMIT;
