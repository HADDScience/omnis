-- CreateTable
CREATE TABLE "OmnisCardVersion" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "restoredFromHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmnisCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OmnisCardVersion_cardId_version_idx" ON "OmnisCardVersion"("cardId", "version");

-- CreateIndex
CREATE INDEX "OmnisCardVersion_createdById_idx" ON "OmnisCardVersion"("createdById");

-- AddForeignKey
ALTER TABLE "OmnisCardVersion" ADD CONSTRAINT "OmnisCardVersion_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "OmnisCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmnisCardVersion" ADD CONSTRAINT "OmnisCardVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
