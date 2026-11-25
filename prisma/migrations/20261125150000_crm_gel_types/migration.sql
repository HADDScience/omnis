-- CRM 젤 타입(애드젤 · 라이브젤) 재고 구조 — 칸만 더한다. 기존 행은 다음 마이그레이션(…_crm_gel_types_data)이 옮긴다.
-- enum 값 ML 은 같은 트랜잭션 안에서 쓸 수 없어 데이터 옮기기를 따로 둔다.
-- CreateEnum
CREATE TYPE "CrmGelType" AS ENUM ('ADDGEL', 'LIVEGEL');

-- AlterEnum
ALTER TYPE "CrmStockUnit" ADD VALUE 'ML';

-- DropForeignKey
ALTER TABLE "CrmProduction" DROP CONSTRAINT "CrmProduction_materialId_fkey";

-- AlterTable
ALTER TABLE "CrmProduct" ADD COLUMN     "gelType" "CrmGelType",
ADD COLUMN     "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "CrmQuoteItem" ADD COLUMN     "concentrationPct" DECIMAL(6,3),
ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "volumeMl" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "CrmSampleRequest" ADD COLUMN     "concentrationPct" DECIMAL(6,3),
ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "volumeMl" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "CrmShipment" ADD COLUMN     "concentrationPct" DECIMAL(6,3),
ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "volumeMl" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "CrmStockMove" ADD COLUMN     "concentrationPct" DECIMAL(6,3),
ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "legacyQuantity" DECIMAL(12,3),
ADD COLUMN     "units" INTEGER,
ADD COLUMN     "volumeMl" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "CrmProduction" ADD COLUMN     "concentrationPct" DECIMAL(6,3),
ADD COLUMN     "legacyProductId" TEXT,
ADD COLUMN     "photoFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totalMl" DECIMAL(12,3),
ALTER COLUMN "materialId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CrmProductionLine" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "volumeMl" DECIMAL(10,3) NOT NULL,
    "units" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrmProductionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmProductionLine_productionId_idx" ON "CrmProductionLine"("productionId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmProduct_gelType_key" ON "CrmProduct"("gelType");

-- CreateIndex
CREATE INDEX "CrmStockMove_productId_concentrationPct_idx" ON "CrmStockMove"("productId", "concentrationPct");

-- AddForeignKey
ALTER TABLE "CrmProduction" ADD CONSTRAINT "CrmProduction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "CrmProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmProductionLine" ADD CONSTRAINT "CrmProductionLine_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "CrmProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

