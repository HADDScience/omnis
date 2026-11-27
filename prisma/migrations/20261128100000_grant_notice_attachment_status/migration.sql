-- 공고 첨부 상태(2026-11-27) — 다시 돌려도 되게(데모 미리보기가 데모 DB 에 거는 migrate deploy). 이 폴더 이름은 바꾸지 않는다
ALTER TABLE "GrantNotice"
  ADD COLUMN IF NOT EXISTS "attStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "attCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "attNote" TEXT,
  ADD COLUMN IF NOT EXISTS "attFiles" JSONB;
