-- 사진 설명(2026-10-29). 추가만 — 지금 운영 코드는 이 칸과 PHOTO 값을 읽지 않는다
-- AlterEnum
ALTER TYPE "EmbeddingSource" ADD VALUE 'PHOTO';

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "description" TEXT,
ADD COLUMN     "describedAt" TIMESTAMP(3),
ADD COLUMN     "describedBy" TEXT;
