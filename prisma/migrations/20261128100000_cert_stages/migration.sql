-- 인증 단계 (2026-11-28) — 아카이브 › 인증 탭. 국가과제 우리 결정과 같은 목록 · 보드 전환 · 제자리 편집
-- 후보 → 준비 → 신청 → 심사 중 → 보유 → 갱신 필요 → 만료, 어디서든 → 중단.
-- 단계는 Postgres enum 대신 text + CHECK 로 둔다 — 선택지를 바꿀 때 enum 을 다시 만들지 않는다(국가과제 #274 와 같다).
-- 칼럼 이름은 status 그대로 둔다(칸 키는 stage — lib/certs.ts CERT_FIELDS). 이름표 · 순서: lib/grants-labels.ts CERT_STAGES
--
-- 옛 값 → 새 단계(lib/certs.ts LEGACY_STAGE 와 같다): HELD · RENEWAL_DUE · EXPIRED · CANDIDATE 는 키가 같다(표시 이름만 바뀐다).
-- NOT_ELIGIBLE(자격 안 됨) → STOPPED(중단) + 사유 「자격 안 됨」(조사의 판정 이유가 있으면 뒤에 붙인다).
-- 옮기는 인증마다 활동 기록을 남긴다. action 을 사람의 고침(company.certification.updated)과 달리해
-- 이식 스크립트의 「사람 손질 보호」 가 이것을 사람 수정으로 읽지 않는다.
--
-- 다시 돌려도 같은 결과가 되게 쓴다(IF EXISTS · IF NOT EXISTS · 옮길 행이 없으면 0줄). 데모 미리보기가 PR 브랜치에서
-- 공용 데모 DB 에 migrate deploy 를 건다(migration-traps.md). 이름은 처음부터 최종 이름이다 — 바꾸지 않는다.
-- 되돌리기: prisma/rollbacks/20261128100000_cert_stages.down.sql
SET lock_timeout = '5s';

-- 1. enum → text (값은 그대로). 이미 text 면 그대로다
ALTER TABLE "CompanyCertification" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
DROP TYPE IF EXISTS "CertStatus";

-- 2. 새 칸
ALTER TABLE "CompanyCertification" ADD COLUMN IF NOT EXISTS "stageReason" TEXT;
ALTER TABLE "CompanyCertification" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMP(3);
ALTER TABLE "CompanyCertification" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "CompanyCertification" ADD COLUMN IF NOT EXISTS "checklist" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyCertification" ADD COLUMN IF NOT EXISTS "evidence" JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS "CompanyCertification_deadline_idx" ON "CompanyCertification"("deadline");
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_ownerId_fkey";
ALTER TABLE "CompanyCertification" ADD CONSTRAINT "CompanyCertification_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. 옮기는 인증마다 활동 기록(옮길 행이 없으면 0줄)
INSERT INTO "ActivityLog" ("id", "userId", "action", "entity", "entityId", "title", "metadata", "createdAt")
SELECT
  gen_random_uuid()::text,
  NULL,
  'company.certification.stage_migrated',
  'COMPANY_CERTIFICATION',
  "id",
  '인증 단계 체계 변경으로 자동 이동: ' || "name",
  jsonb_build_object('from', "status", 'to', 'STOPPED', 'reason', '자격 안 됨 → 중단(인증 단계 체계 변경)'),
  CURRENT_TIMESTAMP
FROM "CompanyCertification"
WHERE "status" = 'NOT_ELIGIBLE';

-- 4. 값 옮기기 — 자격 안 됨 → 중단 + 사유(사람이 적은 사유가 있으면 두고, 판정 이유는 300자까지)
UPDATE "CompanyCertification"
SET
  "stageReason" = coalesce(
    "stageReason",
    '자격 안 됨' || coalesce(' — ' || left(nullif(trim("research" ->> 'our_status_reason'), ''), 300), '')
  ),
  "status" = 'STOPPED'
WHERE "status" = 'NOT_ELIGIBLE';

-- 5. 허용 값(있으면 갈아 끼운다)
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_status_check";
ALTER TABLE "CompanyCertification" ADD CONSTRAINT "CompanyCertification_status_check"
  CHECK ("status" IN ('CANDIDATE', 'PREPARING', 'APPLIED', 'REVIEWING', 'HELD', 'RENEWAL_DUE', 'EXPIRED', 'STOPPED'));
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_checklist_check";
ALTER TABLE "CompanyCertification" ADD CONSTRAINT "CompanyCertification_checklist_check" CHECK (jsonb_typeof("checklist") = 'array');
ALTER TABLE "CompanyCertification" DROP CONSTRAINT IF EXISTS "CompanyCertification_evidence_check";
ALTER TABLE "CompanyCertification" ADD CONSTRAINT "CompanyCertification_evidence_check" CHECK (jsonb_typeof("evidence") = 'array');
