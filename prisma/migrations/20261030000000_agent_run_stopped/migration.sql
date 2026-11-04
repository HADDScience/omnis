-- 「답변 중지」 — 답하는 중에 사용자가 멈춘 실행. 추가만 한다(기존 값 · 칸을 바꾸지 않는다)

-- AlterEnum
ALTER TYPE "AgentRunStatus" ADD VALUE 'STOPPED';

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "stoppedMessageId" TEXT;
