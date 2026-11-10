-- 5단계: 사람끼리 대화. 추가만 한다 — 칸 삭제 · 이름 변경 없음.
-- AlterEnum
ALTER TYPE "ChatRoomKind" ADD VALUE 'DM';

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN "dmKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_dmKey_key" ON "ChatRoom"("dmKey");
