-- pgvector 확장 (벡터 검색)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "EmbeddingSource" AS ENUM ('OMNIS_CARD', 'TASK', 'WEEKLY_REPORT', 'CHAT_MESSAGE');

-- CreateTable
CREATE TABLE "EmbeddingChunk" (
    "id" TEXT NOT NULL,
    "source" "EmbeddingSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbeddingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmbeddingChunk_source_sourceId_chunkIndex_key" ON "EmbeddingChunk"("source", "sourceId", "chunkIndex");

-- CreateIndex
CREATE INDEX "EmbeddingChunk_source_sourceId_idx" ON "EmbeddingChunk"("source", "sourceId");

-- 벡터 유사도 인덱스 (HNSW, 코사인 거리)
CREATE INDEX "EmbeddingChunk_embedding_idx" ON "EmbeddingChunk" USING hnsw ("embedding" vector_cosine_ops);
