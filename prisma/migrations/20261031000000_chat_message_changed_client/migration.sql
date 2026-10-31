-- 채팅 품질(2026-10-30). 추가만 — 지금 운영 코드는 두 칸을 읽지 않는다.
-- changedAt: 고치기 · 지우기 시각. 폴링이 남이 바꾼 글을 다시 받는 기준. 기존 행은 null(백필 없음)
-- clientId: 화면이 보낼 때 만든 id. 다시 보내기의 중복 저장을 막는다. 기존 행은 null
-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "changedAt" TIMESTAMP(3),
ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_clientId_key" ON "ChatMessage"("clientId");

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_changedAt_idx" ON "ChatMessage"("roomId", "changedAt");
