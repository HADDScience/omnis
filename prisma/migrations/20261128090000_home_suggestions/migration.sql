-- 첫 화면 「지금 할 일」 제안 (2026-11-27) — lib/home-suggestions. 새 표 둘만 만든다.
-- 다시 돌려도 같은 결과가 되게 쓴다(데모 미리보기가 먼저 적용할 수 있다 — migration-traps.md).
CREATE TABLE IF NOT EXISTS "HomeSuggestionRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "model" TEXT,
    "costKrw" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomeSuggestionRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HomeSuggestionRun_userId_createdAt_idx" ON "HomeSuggestionRun"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "HomeSuggestionRun_day_source_idx" ON "HomeSuggestionRun"("day", "source");

CREATE TABLE IF NOT EXISTS "HomeSuggestionEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomeSuggestionEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HomeSuggestionEvent_runId_itemKey_kind_key" ON "HomeSuggestionEvent"("runId", "itemKey", "kind");
CREATE INDEX IF NOT EXISTS "HomeSuggestionEvent_createdAt_trigger_idx" ON "HomeSuggestionEvent"("createdAt", "trigger");
ALTER TABLE "HomeSuggestionEvent" DROP CONSTRAINT IF EXISTS "HomeSuggestionEvent_runId_fkey";
ALTER TABLE "HomeSuggestionEvent" ADD CONSTRAINT "HomeSuggestionEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HomeSuggestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
