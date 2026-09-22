-- AlterTable
ALTER TABLE "WebsiteInquiry" ADD COLUMN     "sampleId" TEXT;

-- AddForeignKey
ALTER TABLE "WebsiteInquiry" ADD CONSTRAINT "WebsiteInquiry_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "CrmSampleRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
