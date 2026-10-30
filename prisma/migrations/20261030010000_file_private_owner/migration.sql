-- 참여자만 보는 방의 첨부(2026-10-30). 추가만 — 지금 운영 코드는 이 칸을 읽지 않는다.
-- 기존 파일은 모두 null(전사방 · 업무 첨부)로 남는다 — 옴니스 방 · 사람끼리 방은 지금까지 첨부를 받지 않았다
-- AlterTable
ALTER TABLE "File" ADD COLUMN     "privateToUserId" TEXT;

-- CreateIndex
CREATE INDEX "File_privateToUserId_idx" ON "File"("privateToUserId");
