-- FK 추가 전, User에 존재하지 않는 userId(과거 데이터 잔재)는 NULL로 정리한다.
-- FK 정책 ON DELETE SET NULL과 같은 의미이므로 영속화된 사용량 집계는 그대로 보존된다.
UPDATE "GeminiUsage" g
   SET "userId" = NULL
 WHERE g."userId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = g."userId");

CREATE INDEX "GeminiUsage_userId_createdAt_idx" ON "GeminiUsage"("userId", "createdAt");

ALTER TABLE "GeminiUsage"
  ADD CONSTRAINT "GeminiUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
