-- CreateEnum
CREATE TYPE "CrmSampleStatus" AS ENUM ('PENDING', 'SENT');

-- CreateEnum
CREATE TYPE "CrmShipmentKind" AS ENUM ('SALE', 'SAMPLE', 'GIFT');

-- CreateEnum
CREATE TYPE "CrmShipmentStatus" AS ENUM ('PREPARING', 'SHIPPING', 'DELIVERED');

-- CreateEnum
CREATE TYPE "CrmStockDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "CrmSampleRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT,
    "productId" TEXT,
    "request" TEXT,
    "referral" TEXT,
    "status" "CrmSampleStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSampleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmShipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "kind" "CrmShipmentKind" NOT NULL DEFAULT 'SALE',
    "orgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "CrmShipmentStatus" NOT NULL DEFAULT 'PREPARING',
    "quoteId" TEXT,
    "sampleRequestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStockMove" (
    "id" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "direction" "CrmStockDirection" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "shipmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmStockMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSampleRequest_code_key" ON "CrmSampleRequest"("code");

-- CreateIndex
CREATE INDEX "CrmSampleRequest_orgId_idx" ON "CrmSampleRequest"("orgId");

-- CreateIndex
CREATE INDEX "CrmSampleRequest_requestedAt_idx" ON "CrmSampleRequest"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmShipment_code_key" ON "CrmShipment"("code");

-- CreateIndex
CREATE INDEX "CrmShipment_orgId_idx" ON "CrmShipment"("orgId");

-- CreateIndex
CREATE INDEX "CrmShipment_shippedAt_idx" ON "CrmShipment"("shippedAt");

-- CreateIndex
CREATE INDEX "CrmStockMove_productId_idx" ON "CrmStockMove"("productId");

-- CreateIndex
CREATE INDEX "CrmStockMove_movedAt_idx" ON "CrmStockMove"("movedAt");

-- AddForeignKey
ALTER TABLE "CrmSampleRequest" ADD CONSTRAINT "CrmSampleRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSampleRequest" ADD CONSTRAINT "CrmSampleRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSampleRequest" ADD CONSTRAINT "CrmSampleRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmShipment" ADD CONSTRAINT "CrmShipment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "CrmOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmShipment" ADD CONSTRAINT "CrmShipment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmShipment" ADD CONSTRAINT "CrmShipment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmShipment" ADD CONSTRAINT "CrmShipment_sampleRequestId_fkey" FOREIGN KEY ("sampleRequestId") REFERENCES "CrmSampleRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStockMove" ADD CONSTRAINT "CrmStockMove_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStockMove" ADD CONSTRAINT "CrmStockMove_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "CrmShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
