-- DropForeignKey
ALTER TABLE "CardProposal" DROP CONSTRAINT "CardProposal_cardId_fkey";

-- AddForeignKey
ALTER TABLE "CardProposal" ADD CONSTRAINT "CardProposal_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "OmnisCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
