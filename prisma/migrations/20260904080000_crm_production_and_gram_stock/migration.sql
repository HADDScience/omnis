-- CreateEnum
CREATE TYPE "CrmStockUnit" AS ENUM ('PIECE', 'GRAM');

-- AlterTable
ALTER TABLE "CrmProduct" ADD COLUMN     "concentrationPct" DECIMAL(6,3),
ADD COLUMN     "stockUnit" "CrmStockUnit" NOT NULL DEFAULT 'PIECE',
ADD COLUMN     "volumeMl" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "CrmStockMove" ADD COLUMN     "productionId" TEXT,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- CreateTable
CREATE TABLE "CrmProduction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "materialId" TEXT NOT NULL,
    "materialGrams" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmProduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmProduction_code_key" ON "CrmProduction"("code");

-- CreateIndex
CREATE INDEX "CrmProduction_producedAt_idx" ON "CrmProduction"("producedAt");

-- AddForeignKey
ALTER TABLE "CrmStockMove" ADD CONSTRAINT "CrmStockMove_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "CrmProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmProduction" ADD CONSTRAINT "CrmProduction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CrmProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmProduction" ADD CONSTRAINT "CrmProduction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "CrmProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

