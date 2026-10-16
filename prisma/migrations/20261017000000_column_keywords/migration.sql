-- CreateTable
CREATE TABLE "ColumnKeywordRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "sources" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "durationMs" INTEGER,
    "cpuMs" INTEGER,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ColumnKeywordRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnKeyword" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "term" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "timelyAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "reservedById" TEXT,
    "reservedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "embedding" DOUBLE PRECISION[],
    "nearestPostId" TEXT,
    "nearestScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColumnKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnDraft" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "durationMs" INTEGER,
    "cpuMs" INTEGER,
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColumnDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnPostEmbedding" (
    "postId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColumnPostEmbedding_pkey" PRIMARY KEY ("postId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ColumnKeyword_normalized_key" ON "ColumnKeyword"("normalized");

-- CreateIndex
CREATE INDEX "ColumnKeyword_status_idx" ON "ColumnKeyword"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnDraft_postId_key" ON "ColumnDraft"("postId");

-- CreateIndex
CREATE INDEX "ColumnDraft_keywordId_idx" ON "ColumnDraft"("keywordId");

-- CreateIndex
CREATE INDEX "ColumnDraft_status_idx" ON "ColumnDraft"("status");

-- AddForeignKey
ALTER TABLE "ColumnKeyword" ADD CONSTRAINT "ColumnKeyword_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ColumnKeywordRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColumnDraft" ADD CONSTRAINT "ColumnDraft_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "ColumnKeyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

