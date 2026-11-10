-- 메신저 목록의 즐겨찾기 · 읽음 · 폴더 (mydocs/working/2026-10-28-omnis-messenger.md 「2-b」)
-- 추가만 한다 — 기존 칸을 지우거나 이름을 바꾸지 않는다. 방은 id 가 아니라 방 키(room:<id> · task:<taskId>)로 가리킨다.
-- CreateEnum
CREATE TYPE "ChatFolderRule" AS ENUM ('COMPANY', 'TASK', 'GROUP');

-- CreateTable
CREATE TABLE "ChatRoomPref" (
    "userId" TEXT NOT NULL,
    "roomKey" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRoomPref_pkey" PRIMARY KEY ("userId","roomKey")
);

-- CreateTable
CREATE TABLE "ChatFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule" "ChatFolderRule",
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatFolderRoom" (
    "folderId" TEXT NOT NULL,
    "roomKey" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatFolderRoom_pkey" PRIMARY KEY ("folderId","roomKey")
);

-- CreateIndex
CREATE INDEX "ChatFolder_userId_order_idx" ON "ChatFolder"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ChatFolder_userId_rule_key" ON "ChatFolder"("userId", "rule");

-- AddForeignKey
ALTER TABLE "ChatRoomPref" ADD CONSTRAINT "ChatRoomPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatFolder" ADD CONSTRAINT "ChatFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatFolderRoom" ADD CONSTRAINT "ChatFolderRoom_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ChatFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

