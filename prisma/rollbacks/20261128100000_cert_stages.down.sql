-- 되돌리기: 20261128100000_cert_stages (인증 단계 text + CHECK · 새 칸)
--
-- prisma migrate deploy 는 이 폴더를 읽지 않는다 — 손으로 돌린다. 다시 돌려도 된다(IF EXISTS).
-- **값을 잃는다.** 옛 enum 에 없는 단계는 가장 가까운 옛 값으로 접는다:
--   PREPARING · APPLIED · REVIEWING → CANDIDATE, STOPPED → NOT_ELIGIBLE.
--   사유 · 접수 마감 · 담당 · 준비물 · 근거 칸은 지운다. 지우기 전에 내보내 둔다:
--     psql "$URL" -c "\copy (select id, name, status, \"stageReason\", deadline, \"ownerId\", checklist, evidence from \"CompanyCertification\") to 'certs-before-rollback.csv' csv header"
-- 코드도 되돌려야 한다(옛 enum 을 읽는 코드) — 이 마이그레이션을 가진 PR 을 revert 한 배포와 함께 돌린다.
-- 대상 DB 를 먼저 찍고 확인한다. 운영은 작업지시자 승인 뒤에만.

SET lock_timeout = '5s';
BEGIN;
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_status_check";
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_checklist_check";
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_evidence_check";
UPDATE "CompanyCertification" SET "status" = 'CANDIDATE' WHERE "status" IN ('PREPARING', 'APPLIED', 'REVIEWING');
UPDATE "CompanyCertification" SET "status" = 'NOT_ELIGIBLE' WHERE "status" = 'STOPPED';
DO $$ BEGIN
  CREATE TYPE "CertStatus" AS ENUM ('HELD', 'RENEWAL_DUE', 'CANDIDATE', 'NOT_ELIGIBLE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "CompanyCertification" ALTER COLUMN "status" TYPE "CertStatus" USING "status"::"CertStatus";
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_ownerId_fkey";
DROP INDEX IF EXISTS "CompanyCertification_deadline_idx";
ALTER TABLE "CompanyCertification" DROP COLUMN IF EXISTS "stageReason";
ALTER TABLE "CompanyCertification" DROP COLUMN IF EXISTS "deadline";
ALTER TABLE "CompanyCertification" DROP COLUMN IF EXISTS "ownerId";
ALTER TABLE "CompanyCertification" DROP COLUMN IF EXISTS "checklist";
ALTER TABLE "CompanyCertification" DROP COLUMN IF EXISTS "evidence";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261128100000_cert_stages';
COMMIT;
