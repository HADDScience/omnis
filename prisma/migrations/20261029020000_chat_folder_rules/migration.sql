-- 채팅방 폴더 개념을 다시 맞춘다 (mydocs/working/2026-10-28-omnis-messenger.md 「2-b」)
-- 폴더 = 내가 고른 방들을 묶는 상자. 하나뿐인 방(전사방)은 폴더가 될 수 없다 — 추천 폴더를 「내 업무」 · 「프로젝트별」 로 바꾼다.
-- 추가만 한다: 옛 규칙 값(COMPANY · TASK · GROUP)과 그 행은 남기고 화면 · API 가 숨긴다.
-- 유일 제약 (userId, rule) 은 프로젝트 폴더를 둘 이상 만들지 못해 (userId, rule, projectId) 로 바꾼다 — 칸이 아니라 색인이다.

-- AlterEnum (PostgreSQL 12 이상은 한 트랜잭션에서 값 둘을 더할 수 있다. 같은 트랜잭션에서 새 값을 쓰지는 않는다)
ALTER TYPE "ChatFolderRule" ADD VALUE 'MY_TASKS';
ALTER TYPE "ChatFolderRule" ADD VALUE 'PROJECT';

-- DropIndex
DROP INDEX "ChatFolder_userId_rule_key";

-- AlterTable
ALTER TABLE "ChatFolder" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatFolder_userId_rule_projectId_key" ON "ChatFolder"("userId", "rule", "projectId");

-- AddForeignKey
ALTER TABLE "ChatFolder" ADD CONSTRAINT "ChatFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
