-- 되돌리기: 20261127235000_object_change (P4 트리거 · outbox)
--
-- **트리거 때문에 맞춤 화면 쓰기가 느려지거나 실패하면 이것부터 돌린다.** 트리거 셋을 걷으면 세 표의 쓰기는 P3 이전과 같아진다.
-- prisma migrate deploy 는 이 폴더를 읽지 않는다 — 손으로 돌린다. 다시 돌려도 된다(IF EXISTS).
--
--   psql "$POSTGRES_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261127235000_object_change.down.sql
--
-- 1) 트리거만 걷는다(가장 빠른 되돌림) — 아래 BEGIN 블록의 앞 세 줄
-- 2) 함수 · outbox 표까지 지우고 마이그레이션 기록 줄을 지운다 — 다음 migrate deploy 가 다시 건다
--    (`prisma migrate resolve --rolled-back` 은 실패한 마이그레이션에만 통한다 — migration-traps.md)
-- 처리 안 된 ObjectChange 는 함께 지워진다. 그 변경의 색인은 매일 대조 작업이 다시 맞춘다.
-- 대상 DB 를 먼저 찍고 확인한다. 운영은 작업지시자 승인 뒤에만.

SET lock_timeout = '5s';
BEGIN;
DROP TRIGGER IF EXISTS "omnis_capture_change" ON "CompanyRecord";
DROP TRIGGER IF EXISTS "omnis_capture_change" ON "GrantDecision";
DROP TRIGGER IF EXISTS "omnis_capture_change" ON "CrmOrg";
DROP FUNCTION IF EXISTS omnis_capture_change();
DROP TABLE IF EXISTS "ObjectChange";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127235000_object_change';
COMMIT;
