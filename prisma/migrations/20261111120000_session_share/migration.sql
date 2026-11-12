-- 옴니스 세션 수동 공유 · 인계 (2026-11-11). 참여자 행이 어떤 길로 공유됐는지를 남긴다

-- CreateEnum
CREATE TYPE "SessionShareKind" AS ENUM ('PERSON', 'ROOM');

-- AlterTable
ALTER TABLE "ChatRoomMember" ADD COLUMN     "shareKind" "SessionShareKind";

-- 백필: #190 의 @옴니스 세션은 연 방의 참여자를 그대로 넣었다 — 주인(createdById)이 아닌 사람은 방 공유로 들어온 것이다
UPDATE "ChatRoomMember" m
SET "shareKind" = 'ROOM'
FROM "ChatRoom" r
WHERE m."roomId" = r."id"
  AND r."kind" = 'OMNIS_DM'
  AND r."originRoomId" IS NOT NULL
  AND (r."createdById" IS NULL OR m."userId" <> r."createdById");
