-- 작업용 컴퓨터 0단계 (2026-11-26) — lib/workbench
-- 1) AiUsage: 캐시 쓰기 토큰 · 실행 시간 칸. 기존 행은 0
ALTER TABLE "AiUsage" ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsage" ADD COLUMN "activeSeconds" INTEGER NOT NULL DEFAULT 0;

-- 2) 작업 1건
CREATE TABLE "WorkbenchJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "runId" TEXT,
    "request" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "budgetKrw" INTEGER NOT NULL,
    "sessionId" TEXT,
    "vaultId" TEXT,
    "tokenId" TEXT,
    "cursor" TEXT,
    "lastMessage" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "costKrw" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "outputFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "workflowRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "WorkbenchJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkbenchJob_status_check" CHECK ("status" IN ('QUEUED','RUNNING','NEEDS_BUDGET','DONE','FAILED','CANCELLED'))
);
CREATE INDEX "WorkbenchJob_userId_createdAt_idx" ON "WorkbenchJob"("userId", "createdAt");
CREATE INDEX "WorkbenchJob_status_idx" ON "WorkbenchJob"("status");

-- 3) 단기 MCP 토큰의 발급처 — 이 client 로 발급된 토큰은 옴니스 MCP 에서 읽기 도구만 연다(lib/omnis-mcp.ts resolveCaller)
INSERT INTO ip.oauth_clients (client_id, client_name, redirect_uris)
VALUES ('omnis-workbench', '옴니스 작업용 컴퓨터(서버 내부 발급)', ARRAY[]::text[])
ON CONFLICT (client_id) DO NOTHING;
