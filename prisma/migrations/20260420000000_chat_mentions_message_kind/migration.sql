-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('NORMAL', 'TASK_CREATED', 'TASK_REBUILT', 'TASK_DONE');

-- CreateEnum
CREATE TYPE "MentionType" AS ENUM ('TASK', 'USER');

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "ChatMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "MentionType" NOT NULL,
    "taskId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMention_type_taskId_idx" ON "ChatMention"("type", "taskId");

-- CreateIndex
CREATE INDEX "ChatMention_type_userId_idx" ON "ChatMention"("type", "userId");

-- CreateIndex
CREATE INDEX "ChatMention_messageId_idx" ON "ChatMention"("messageId");

-- AddForeignKey
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
