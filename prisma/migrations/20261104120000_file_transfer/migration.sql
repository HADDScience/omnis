-- 큰 첨부의 임시본 → NAS 복사 상태. 새 표 하나만 더한다 — 기존 표와 코드 경로는 그대로다
CREATE TYPE "FileTransferState" AS ENUM ('UPLOADED', 'COPYING', 'WAITING_NAS', 'VERIFIED', 'TEMP_DELETED', 'FAILED');

CREATE TABLE "FileTransfer" (
    "fileId" TEXT NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "state" "FileTransferState" NOT NULL DEFAULT 'UPLOADED',
    "segmentSize" INTEGER NOT NULL,
    "segmentsDone" INTEGER NOT NULL DEFAULT 0,
    "manifestSha256" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "blobDeletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "runId" TEXT,

    CONSTRAINT "FileTransfer_pkey" PRIMARY KEY ("fileId")
);

CREATE INDEX "FileTransfer_state_updatedAt_idx" ON "FileTransfer"("state", "updatedAt");
CREATE INDEX "FileTransfer_uploadedAt_idx" ON "FileTransfer"("uploadedAt");

ALTER TABLE "FileTransfer" ADD CONSTRAINT "FileTransfer_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
