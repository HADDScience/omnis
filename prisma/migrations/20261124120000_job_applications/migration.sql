-- 채용 지원서(HR 1단계) — 새 표 셋 · 새 enum 둘만 만든다. 기존 표의 칸은 바꾸지 않는다(FK 하나가 StaffProfile 을 가리킬 뿐).
-- 되돌리기: DROP TABLE "JobApplicationEvent", "JobApplicationFile", "JobApplication"; DROP TYPE "JobApplicationFileSlot", "JobApplicationStage";
-- 계획: mydocs/plans/2026-11-24-hr-intake.md
-- CreateEnum
CREATE TYPE "JobApplicationStage" AS ENUM ('RECEIVING', 'RECEIVED', 'SCREENING', 'INTERVIEW', 'OFFERED', 'REJECTED', 'WITHDRAWN', 'HIRED');

-- CreateEnum
CREATE TYPE "JobApplicationFileSlot" AS ENUM ('RESUME', 'PORTFOLIO');

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "jobSlug" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'ko',
    "stage" "JobApplicationStage" NOT NULL DEFAULT 'RECEIVING',
    "name" TEXT,
    "department" TEXT,
    "studentId" TEXT,
    "grade" TEXT,
    "graduation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "portfolioUrl" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "motivation" TEXT,
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "receivedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "selectionEndedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "staffProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplicationFile" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "slot" "JobApplicationFileSlot" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT,
    "size" INTEGER NOT NULL,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "uploadedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JobApplicationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStage" "JobApplicationStage",
    "toStage" "JobApplicationStage",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_code_key" ON "JobApplication"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_staffProfileId_key" ON "JobApplication"("staffProfileId");

-- CreateIndex
CREATE INDEX "JobApplication_jobSlug_stage_idx" ON "JobApplication"("jobSlug", "stage");

-- CreateIndex
CREATE INDEX "JobApplication_purgeAfter_idx" ON "JobApplication"("purgeAfter");

-- CreateIndex
CREATE INDEX "JobApplication_email_createdAt_idx" ON "JobApplication"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplicationFile_applicationId_slot_key" ON "JobApplicationFile"("applicationId", "slot");

-- CreateIndex
CREATE INDEX "JobApplicationEvent_applicationId_createdAt_idx" ON "JobApplicationEvent"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationFile" ADD CONSTRAINT "JobApplicationFile_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationEvent" ADD CONSTRAINT "JobApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

