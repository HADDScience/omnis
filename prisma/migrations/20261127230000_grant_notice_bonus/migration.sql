-- 공고 가점 항목(2026-11-27) — 다시 돌려도 되게(데모 미리보기가 데모 DB 에 거는 migrate deploy). 이 폴더 이름은 바꾸지 않는다
ALTER TABLE "GrantNotice"
  ADD COLUMN IF NOT EXISTS "bonusItems" JSONB,
  ADD COLUMN IF NOT EXISTS "bonusCap" JSONB,
  ADD COLUMN IF NOT EXISTS "bonusStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "bonusExtractedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bonusModel" TEXT,
  ADD COLUMN IF NOT EXISTS "bonusTextHash" TEXT;
