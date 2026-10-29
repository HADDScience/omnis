-- 채팅 목록에서 방을 지우거나 숨긴 시각(2026-10-29). 추가만 — 지금 운영 코드는 이 칸을 읽지 않는다
-- AlterTable
ALTER TABLE "ChatRoomPref" ADD COLUMN     "hiddenAt" TIMESTAMP(3);
