-- 사람 방의 @옴니스 언급으로 시작한 옴니스 세션 · 공유 (2026-11-10). 새 칸만 더한다 — 백필 없음(기존 세션은 개인 세션)

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "notifyOrigin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "sessionRoomId" TEXT;

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN     "originRoomId" TEXT;

-- CreateIndex
CREATE INDEX "ChatRoom_originRoomId_idx" ON "ChatRoom"("originRoomId");

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_originRoomId_fkey" FOREIGN KEY ("originRoomId") REFERENCES "ChatRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
