-- 채팅 글 고치기 이력 — 고치기 전 본문을 한 줄씩 남긴다(관리자 감사용). 기존 글은 이력 없이 둔다
CREATE TABLE "ChatMessageRevision" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessageRevision_messageId_createdAt_idx" ON "ChatMessageRevision"("messageId", "createdAt");

ALTER TABLE "ChatMessageRevision" ADD CONSTRAINT "ChatMessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
