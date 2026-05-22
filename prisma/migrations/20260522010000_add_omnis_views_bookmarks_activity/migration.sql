-- CreateTable
CREATE TABLE "OmnisViewLog" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmnisViewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "title" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OmnisViewLog_cardId_viewedAt_idx" ON "OmnisViewLog"("cardId", "viewedAt");

-- CreateIndex
CREATE INDEX "OmnisViewLog_userId_viewedAt_idx" ON "OmnisViewLog"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_cardId_key" ON "Bookmark"("userId", "cardId");

-- CreateIndex
CREATE INDEX "Bookmark_userId_createdAt_idx" ON "Bookmark"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_entity_entityId_createdAt_idx" ON "ActivityLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OmnisViewLog" ADD CONSTRAINT "OmnisViewLog_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "OmnisCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmnisViewLog" ADD CONSTRAINT "OmnisViewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "OmnisCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Full-text search support for expanded Omnis card search.
-- The document-building expression is wrapped in an IMMUTABLE function because
-- Postgres rejects non-IMMUTABLE expressions directly inside an index definition.
CREATE OR REPLACE FUNCTION omnis_card_search_vector(p_title text, p_content jsonb, p_tags text[])
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $func$
  SELECT to_tsvector(
    'simple',
    coalesce(p_title, '') || ' ' ||
    coalesce(p_content::text, '') || ' ' ||
    coalesce(array_to_string(p_tags, ' '), '')
  )
$func$;

CREATE INDEX "OmnisCard_search_idx" ON "OmnisCard"
  USING GIN (omnis_card_search_vector("title", "content", "tags"));
