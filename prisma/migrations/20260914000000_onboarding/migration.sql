-- Existing and new accounts both start unseen. Never backfill a fabricated completion.
ALTER TABLE "User"
  ADD COLUMN "onboardingVideoSeenAt" TIMESTAMP(3),
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
