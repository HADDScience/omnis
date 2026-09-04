-- CreateEnum
CREATE TYPE "CrmOrgType" AS ENUM ('UNIVERSITY', 'RESEARCH', 'COMPANY', 'HOSPITAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CrmQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'DONE', 'CANCELLED');

-- DropIndex
DROP INDEX "EmbeddingChunk_embedding_idx";

-- CreateTable
CREATE TABLE "CrmOrg" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CrmOrgType" NOT NULL DEFAULT 'OTHER',
    "address" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "note" TEXT,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMembership" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT,
    "status" "CrmMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "discountAmount" INTEGER NOT NULL DEFAULT 400000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmProduct" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "kind" TEXT,
    "unitPrice" INTEGER,
    "isMaterial" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrmProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmQuote" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT,
    "membershipId" TEXT,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "vatRate" INTEGER NOT NULL DEFAULT 10,
    "status" "CrmQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "taxInvoicedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmQuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrmQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmOrg_code_key" ON "CrmOrg"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOrg_name_key" ON "CrmOrg"("name");

-- CreateIndex
CREATE INDEX "CrmOrg_name_idx" ON "CrmOrg"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_code_key" ON "CrmContact"("code");

-- CreateIndex
CREATE INDEX "CrmContact_orgId_idx" ON "CrmContact"("orgId");

-- CreateIndex
CREATE INDEX "CrmContact_name_idx" ON "CrmContact"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMembership_code_key" ON "CrmMembership"("code");

-- CreateIndex
CREATE INDEX "CrmMembership_orgId_idx" ON "CrmMembership"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmProduct_code_key" ON "CrmProduct"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CrmProduct_name_spec_key" ON "CrmProduct"("name", "spec");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuote_code_key" ON "CrmQuote"("code");

-- CreateIndex
CREATE INDEX "CrmQuote_orgId_idx" ON "CrmQuote"("orgId");

-- CreateIndex
CREATE INDEX "CrmQuote_quotedAt_idx" ON "CrmQuote"("quotedAt");

-- CreateIndex
CREATE INDEX "CrmQuoteItem_quoteId_idx" ON "CrmQuoteItem"("quoteId");

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMembership" ADD CONSTRAINT "CrmMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMembership" ADD CONSTRAINT "CrmMembership_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CrmMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuoteItem" ADD CONSTRAINT "CrmQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuoteItem" ADD CONSTRAINT "CrmQuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
