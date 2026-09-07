-- DropForeignKey
ALTER TABLE "WebsiteMedia" DROP CONSTRAINT "WebsiteMedia_postId_fkey";

-- CreateIndex
CREATE INDEX "WebsiteMedia_postId_idx" ON "WebsiteMedia"("postId");
