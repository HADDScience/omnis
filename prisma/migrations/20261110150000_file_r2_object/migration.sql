-- R2(S3 호환)에 올린 큰 첨부의 기록. 새 표 하나만 더한다 — 기존 표와 코드 경로는 그대로다
CREATE TABLE "FileR2Object" (
    "fileId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "etag" TEXT,
    "partBytes" INTEGER NOT NULL,
    "partCount" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileR2Object_pkey" PRIMARY KEY ("fileId")
);

CREATE INDEX "FileR2Object_uploadedAt_idx" ON "FileR2Object"("uploadedAt");

ALTER TABLE "FileR2Object" ADD CONSTRAINT "FileR2Object_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
