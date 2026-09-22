-- CreateEnum
CREATE TYPE "WebsiteInquiryStatus" AS ENUM ('NEW', 'ACCEPTED', 'REJECTED', 'SPAM');

-- CreateTable
CREATE TABLE "WebsiteInquiry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'ko',
    "ip" TEXT,
    "userAgent" TEXT,
    "status" "WebsiteInquiryStatus" NOT NULL DEFAULT 'NEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "orgId" TEXT,
    "contactId" TEXT,
    "quoteId" TEXT,

    CONSTRAINT "WebsiteInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteInquiry_status_createdAt_idx" ON "WebsiteInquiry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteInquiry_ip_createdAt_idx" ON "WebsiteInquiry"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteInquiry_email_createdAt_idx" ON "WebsiteInquiry"("email", "createdAt");

-- AddForeignKey
ALTER TABLE "WebsiteInquiry" ADD CONSTRAINT "WebsiteInquiry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteInquiry" ADD CONSTRAINT "WebsiteInquiry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteInquiry" ADD CONSTRAINT "WebsiteInquiry_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
