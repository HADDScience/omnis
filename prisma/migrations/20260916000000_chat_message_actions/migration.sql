-- 채팅 메시지 수정 · 삭제 · 답장 (2026-09-16)
-- 지울 때 행을 지우지 않는다: 답장이 가리키는 글 · 업무 연결 · 색인이 함께 사라진다.
ALTER TABLE "ChatMessage" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "replyToId" TEXT;

CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
