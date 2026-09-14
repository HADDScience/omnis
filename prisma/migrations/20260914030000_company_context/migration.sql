-- CreateEnum
CREATE TYPE "FigureBasis" AS ENUM ('CONFIRMED', 'PLANNED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED', 'FORMER');

-- CreateEnum
CREATE TYPE "StaffAssetKind" AS ENUM ('SIGNATURE', 'SEAL');

-- CreateEnum
CREATE TYPE "RecordKind" AS ENUM ('GRANT', 'AWARD', 'EXHIBITION', 'FORUM', 'EDUCATION', 'NETWORKING', 'INTERNAL', 'MILESTONE');

-- CreateEnum
CREATE TYPE "TaxInvoiceDirection" AS ENUM ('SALE', 'PURCHASE');

-- AlterTable
ALTER TABLE "CrmOrg" ADD COLUMN     "bizRegNo" TEXT;

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL DEFAULT 'hadd',
    "nameKo" TEXT NOT NULL,
    "nameEn" TEXT,
    "bizRegNo" TEXT NOT NULL,
    "bizType" TEXT,
    "corpRegNo" TEXT,
    "industry" TEXT,
    "industryCode" TEXT,
    "foundedOn" TIMESTAMP(3),
    "homepage" TEXT,
    "hqAddress" TEXT,
    "labAddress" TEXT,
    "partnerAddress" TEXT,
    "asOfDate" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyYear" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "basis" "FigureBasis" NOT NULL,
    "revenueKrw" BIGINT,
    "revenueProductKrw" BIGINT,
    "revenueServiceKrw" BIGINT,
    "costOfSalesKrw" BIGINT,
    "netIncomeKrw" BIGINT,
    "assetsKrw" BIGINT,
    "liabilitiesKrw" BIGINT,
    "equityKrw" BIGINT,
    "headcount" INTEGER,
    "accountLabel" TEXT,
    "note" TEXT,
    "sourceFileKey" TEXT,
    "asOfDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "affiliation" TEXT NOT NULL,
    "position" TEXT,
    "haddRole" TEXT,
    "employment" "EmploymentStatus" NOT NULL DEFAULT 'EMPLOYED',
    "insured" BOOLEAN NOT NULL DEFAULT false,
    "education" TEXT,
    "major" TEXT,
    "duties" TEXT,
    "ntisNo" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "birthDate" TIMESTAMP(3),
    "joinedOn" TIMESTAMP(3),
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAsset" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" "StaffAssetKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "segment" TEXT,
    "homepage" TEXT,
    "products" TEXT,
    "industry" TEXT,
    "ceo" TEXT,
    "foundedRaw" TEXT,
    "capitalRaw" TEXT,
    "revenueRaw" TEXT,
    "headcountRaw" TEXT,
    "animalAlternative" BOOLEAN,
    "address" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'notion',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRecord" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" "RecordKind" NOT NULL,
    "title" TEXT NOT NULL,
    "organizer" TEXT,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "periodRaw" TEXT,
    "status" TEXT,
    "note" TEXT,
    "subject" TEXT,
    "role" TEXT,
    "fundingKrw" BIGINT,
    "ownCashKrw" BIGINT,
    "ownInKindKrw" BIGINT,
    "grantNo" TEXT,
    "prize" TEXT,
    "venue" TEXT,
    "partner" TEXT,
    "category" TEXT,
    "source" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" TEXT NOT NULL,
    "approvalNo" TEXT NOT NULL,
    "direction" "TaxInvoiceDirection" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '일반',
    "originalApprovalNo" TEXT,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "supplierBizNo" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "buyerBizNo" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "supplyKrw" BIGINT NOT NULL,
    "taxKrw" BIGINT NOT NULL,
    "totalKrw" BIGINT NOT NULL,
    "orgId" TEXT,
    "quoteId" TEXT,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "readBy" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "quantity" INTEGER,
    "unitKrw" BIGINT,
    "supplyKrw" BIGINT NOT NULL,
    "taxKrw" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "productId" TEXT,

    CONSTRAINT "TaxInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyYear_year_basis_key" ON "CompanyYear"("year", "basis");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_name_key" ON "StaffProfile"("name");

-- CreateIndex
CREATE INDEX "StaffAsset_staffId_idx" ON "StaffAsset"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCompany_name_key" ON "MarketCompany"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRecord_dedupeKey_key" ON "CompanyRecord"("dedupeKey");

-- CreateIndex
CREATE INDEX "CompanyRecord_kind_startsOn_idx" ON "CompanyRecord"("kind", "startsOn");

-- CreateIndex
CREATE INDEX "CompanyRecord_startsOn_idx" ON "CompanyRecord"("startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_approvalNo_key" ON "TaxInvoice"("approvalNo");

-- CreateIndex
CREATE INDEX "TaxInvoice_issuedOn_idx" ON "TaxInvoice"("issuedOn");

-- CreateIndex
CREATE INDEX "TaxInvoice_orgId_idx" ON "TaxInvoice"("orgId");

-- CreateIndex
CREATE INDEX "TaxInvoice_direction_issuedOn_idx" ON "TaxInvoice"("direction", "issuedOn");

-- CreateIndex
CREATE INDEX "TaxInvoiceItem_invoiceId_idx" ON "TaxInvoiceItem"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOrg_bizRegNo_key" ON "CrmOrg"("bizRegNo");

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAsset" ADD CONSTRAINT "StaffAsset_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRecord" ADD CONSTRAINT "CompanyRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceItem" ADD CONSTRAINT "TaxInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "TaxInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceItem" ADD CONSTRAINT "TaxInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

