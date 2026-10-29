-- 채팅방 종류 · 참여자 · 옴니스 답 연결 (mydocs/plans/2026-10-28-omnis-messenger-agent.md 1단계)
-- 추가만 한다 — 기존 칸을 지우거나 이름을 바꾸지 않는다. 옛 코드가 같은 DB 를 읽고 써도 그대로 돈다.

-- CreateEnum
CREATE TYPE "ChatRoomKind" AS ENUM ('COMPANY', 'TASK', 'OMNIS_DM', 'GROUP');

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "kind" "ChatRoomKind" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "lastMessageAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "omnisQueryId" TEXT;

-- CreateTable
CREATE TABLE "ChatRoomMember" (
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateIndex
CREATE INDEX "ChatRoomMember_userId_idx" ON "ChatRoomMember"("userId");

-- CreateIndex
CREATE INDEX "ChatRoom_kind_lastMessageAt_idx" ON "ChatRoom"("kind", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_omnisQueryId_key" ON "ChatMessage"("omnisQueryId");

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_omnisQueryId_fkey" FOREIGN KEY ("omnisQueryId") REFERENCES "OmnisQuery"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 데이터: 기존 방(「전체」 default-room · 카톡 이식 방)은 전사방이다 — 위 DEFAULT 'COMPANY' 가 칸을 더하면서 채운다.
-- 업무방은 표를 만들지 않는다(taskId 로 묶인 글을 목록이 방처럼 보여 준다).

-- 목록 정렬용 시각을 지금 있는 글로 채운다
UPDATE "ChatRoom" r SET "lastMessageAt" = m.last
  FROM (SELECT "roomId", max("createdAt") AS last FROM "ChatMessage" GROUP BY "roomId") m
 WHERE m."roomId" = r.id;
