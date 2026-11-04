-- 옴니스 계정이 없는 사람의 글 — 추가만 한다. 기존 글은 externalSpeakerId 가 NULL 로 그대로다.
CREATE TABLE "ExternalSpeaker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "org" TEXT,
    "title" TEXT,

    CONSTRAINT "ExternalSpeaker_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChatMessage" ADD COLUMN "externalSpeakerId" TEXT;

CREATE INDEX "ChatMessage_externalSpeakerId_idx" ON "ChatMessage"("externalSpeakerId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_externalSpeakerId_fkey" FOREIGN KEY ("externalSpeakerId") REFERENCES "ExternalSpeaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
