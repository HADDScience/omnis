-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE INDEX "Task_productId_idx" ON "Task"("productId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
