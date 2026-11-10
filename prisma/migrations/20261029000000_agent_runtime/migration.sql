-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'AWAITING_APPROVAL', 'DONE', 'FAILED', 'LIMIT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED', 'EXECUTED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionMessageId" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "costKrw" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "workflowRunId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'PENDING',
    "blockedReason" TEXT,
    "result" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "costKrw" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "userId" TEXT,
    "roomId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_roomId_createdAt_idx" ON "AgentRun"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentStep_runId_idx" ON "AgentStep"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_toolCallId_key" ON "AgentStep"("runId", "toolCallId");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_feature_createdAt_idx" ON "AiUsage"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

