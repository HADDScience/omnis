-- CreateEnum
CREATE TYPE "CardAuthorKind" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "CardProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'AUTO_APPLIED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "OmnisCard" ADD COLUMN     "aiUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "sourceRefs" JSONB;

-- AlterTable
ALTER TABLE "OmnisCardVersion" ADD COLUMN     "authorKind" "CardAuthorKind" NOT NULL DEFAULT 'HUMAN';

-- CreateTable
CREATE TABLE "CardProposal" (
    "id" TEXT NOT NULL,
    "status" "CardProposalStatus" NOT NULL DEFAULT 'PENDING',
    "cardId" TEXT,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerTaskId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardProposal_status_createdAt_idx" ON "CardProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CardProposal_cardId_idx" ON "CardProposal"("cardId");

-- CreateIndex
CREATE INDEX "CardProposal_triggerTaskId_idx" ON "CardProposal"("triggerTaskId");

-- AddForeignKey
ALTER TABLE "CardProposal" ADD CONSTRAINT "CardProposal_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "OmnisCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProposal" ADD CONSTRAINT "CardProposal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "OmnisCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProposal" ADD CONSTRAINT "CardProposal_triggerTaskId_fkey" FOREIGN KEY ("triggerTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProposal" ADD CONSTRAINT "CardProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
