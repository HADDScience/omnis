-- 수집기 govgrants 실행 → GrantNotice 옮긴 기록 (2026-11-27) — lib/govgrants-sync.ts. 새 표 하나만 만든다.
-- 다시 돌려도 같은 결과가 되게 쓴다(데모 미리보기가 먼저 적용할 수 있다 — migration-traps.md).
CREATE TABLE IF NOT EXISTS "GovgrantsImport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runStartedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "fieldCounts" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "GovgrantsImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GovgrantsImport_runId_key" ON "GovgrantsImport"("runId");
ALTER TABLE "GovgrantsImport" DROP CONSTRAINT IF EXISTS "GovgrantsImport_status_check";
ALTER TABLE "GovgrantsImport" ADD CONSTRAINT "GovgrantsImport_status_check" CHECK ("status" IN ('ok', 'failed'));
