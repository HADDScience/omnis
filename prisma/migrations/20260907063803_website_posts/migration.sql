-- CreateTable
CREATE TABLE "WebsitePost" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "sourceLang" TEXT NOT NULL,
    "thumbnail" TEXT,
    "externalHref" TEXT,
    "content" JSONB NOT NULL,
    "deck" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "WebsitePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsitePost_position_idx" ON "WebsitePost"("position");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteMedia_key_key" ON "WebsiteMedia"("key");

-- AddForeignKey
ALTER TABLE "WebsiteMedia" ADD CONSTRAINT "WebsiteMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "WebsitePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
