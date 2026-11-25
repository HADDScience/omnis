-- 인증 · 국가과제 결정(2026-11-25). 새 표 셋과 enum 둘만 만든다 — 기존 표는 바꾸지 않는다
-- CreateEnum
CREATE TYPE "CertStatus" AS ENUM ('HELD', 'RENEWAL_DUE', 'CANDIDATE', 'NOT_ELIGIBLE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GrantStage" AS ENUM ('REVIEW', 'PREPARING', 'SUBMITTED', 'SELECTED', 'REJECTED', 'DROPPED');

-- CreateTable
CREATE TABLE "CompanyCertification" (
    "id" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "issuer" TEXT,
    "status" "CertStatus" NOT NULL,
    "acquiredOn" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "certNo" TEXT,
    "priority" TEXT,
    "difficulty" TEXT,
    "bonus" JSONB,
    "research" JSONB,
    "researchedAt" TIMESTAMP(3),
    "note" TEXT,
    "recordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantDecision" (
    "id" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "GrantStage" NOT NULL,
    "stageReason" TEXT,
    "statusRaw" TEXT,
    "submittedTitle" TEXT,
    "note" TEXT,
    "deadline" TIMESTAMP(3),
    "amount" TEXT,
    "research" JSONB,
    "noticeLinks" JSONB,
    "taskId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrantDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantDecisionOwner" (
    "decisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "GrantDecisionOwner_pkey" PRIMARY KEY ("decisionId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCertification_externalKey_key" ON "CompanyCertification"("externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCertification_recordId_key" ON "CompanyCertification"("recordId");

-- CreateIndex
CREATE INDEX "CompanyCertification_status_idx" ON "CompanyCertification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GrantDecision_externalKey_key" ON "GrantDecision"("externalKey");

-- CreateIndex
CREATE INDEX "GrantDecision_stage_idx" ON "GrantDecision"("stage");

-- CreateIndex
CREATE INDEX "GrantDecision_deadline_idx" ON "GrantDecision"("deadline");

-- AddForeignKey
ALTER TABLE "CompanyCertification" ADD CONSTRAINT "CompanyCertification_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantDecision" ADD CONSTRAINT "GrantDecision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantDecision" ADD CONSTRAINT "GrantDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantDecisionOwner" ADD CONSTRAINT "GrantDecisionOwner_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "GrantDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantDecisionOwner" ADD CONSTRAINT "GrantDecisionOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

