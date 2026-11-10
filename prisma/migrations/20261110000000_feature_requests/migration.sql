-- 앱 AI 기능 요청(2026-11-10). 표 추가만 — 기존 표 · 열은 건드리지 않는다. 빈 표로 시작한다.
-- mydocs/plans/2026-11-10-app-ai-mcp-parity.md

CREATE TABLE "FeatureRequest" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureRequestEntry" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "roomId" TEXT,
    "runId" TEXT,
    "detail" TEXT NOT NULL,
    "attempted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureRequestEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeatureRequest_key_status_idx" ON "FeatureRequest"("key", "status");
CREATE INDEX "FeatureRequest_status_updatedAt_idx" ON "FeatureRequest"("status", "updatedAt");
CREATE INDEX "FeatureRequestEntry_requestId_createdAt_idx" ON "FeatureRequestEntry"("requestId", "createdAt");

ALTER TABLE "FeatureRequestEntry" ADD CONSTRAINT "FeatureRequestEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureRequestEntry" ADD CONSTRAINT "FeatureRequestEntry_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
