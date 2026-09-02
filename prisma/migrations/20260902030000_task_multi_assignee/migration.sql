-- 업무 담당자를 단일(Task.ownerId)에서 다대다(TaskAssignee)로 바꾼다.
--
-- 한 번의 지시가 여러 명에게 향하는 경우("인턴들 각자 ~해주세요")를 담기 위해서다.
-- 기존 담당자는 한 명이므로 그대로 TaskAssignee 한 행으로 옮긴다 — 유실 없음.

CREATE TABLE "TaskAssignee" (
    "taskId"     TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId", "userId")
);

CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 기존 담당자 이관. 컬럼을 지우기 전에 옮긴다.
INSERT INTO "TaskAssignee" ("taskId", "userId", "assignedAt")
SELECT "id", "ownerId", "createdAt" FROM "Task"
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS "Task_ownerId_status_idx";
CREATE INDEX "Task_status_idx" ON "Task"("status");

ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_ownerId_fkey";
ALTER TABLE "Task" DROP COLUMN "ownerId";

-- 체크리스트는 업무당 하나의 공유 목록이다. 항목별 담당자를 두면 지시한 사람과
-- 받은 사람이 서로 다른 목록을 보게 되므로 컬럼을 없앤다. (화면에서 쓰인 적 없음)
ALTER TABLE "Checklist" DROP CONSTRAINT IF EXISTS "Checklist_ownerId_fkey";
ALTER TABLE "Checklist" DROP COLUMN "ownerId";
