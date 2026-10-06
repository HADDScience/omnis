-- 연혁 제안 (2026-10-06). AI 가 채팅 · 업무에서 연혁 후보를 찾고 사람이 채택 · 수정 · 제외로 확정한다.
-- 같이 CompanyRecord 에 공개범위 칸을 둔다 — 그동안 대외비는 제목 앞 [내부용·대외비] 와 비고로만 갈랐다.
-- 배경: mydocs/plans/2026-09-30-record-proposals-and-card-categories.md

-- CreateEnum
CREATE TYPE "RecordVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "RecordGrade" AS ENUM ('MAJOR', 'GENERAL');

-- AlterTable
ALTER TABLE "CompanyRecord" ADD COLUMN     "visibility" "RecordVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "RecordProposal" (
    "id" TEXT NOT NULL,
    "status" "CardProposalStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "RecordKind" NOT NULL,
    "grade" "RecordGrade" NOT NULL,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "organizer" TEXT,
    "occurredOn" TIMESTAMP(3),
    "periodRaw" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "original" JSONB NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "triggerTaskId" TEXT,
    "recordId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordProposal_status_createdAt_idx" ON "RecordProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RecordProposal_kind_grade_status_idx" ON "RecordProposal"("kind", "grade", "status");

-- CreateIndex
CREATE INDEX "RecordProposal_triggerTaskId_idx" ON "RecordProposal"("triggerTaskId");

-- AddForeignKey
ALTER TABLE "RecordProposal" ADD CONSTRAINT "RecordProposal_triggerTaskId_fkey" FOREIGN KEY ("triggerTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordProposal" ADD CONSTRAINT "RecordProposal_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordProposal" ADD CONSTRAINT "RecordProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 백필: 이미 대외비로 적힌 연혁을 INTERNAL 로. 제목 접두어 · 비고 표기는 그대로 둔다(외부로 나간 사본과 맞추려고)
UPDATE "CompanyRecord"
   SET "visibility" = 'INTERNAL'
 WHERE "title" LIKE '[내부용%'
    OR "title" LIKE '%대외비%'
    OR "note" LIKE '%외부 자료 사용 금지%'
    OR "note" LIKE '%외부 자료에 쓰지 않음%';
