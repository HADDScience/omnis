-- CreateTable
CREATE TABLE "OmnisQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmnisQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OmnisQuery_userId_createdAt_idx" ON "OmnisQuery"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OmnisQuery" ADD CONSTRAINT "OmnisQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
