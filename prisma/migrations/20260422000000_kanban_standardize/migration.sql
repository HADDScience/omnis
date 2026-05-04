-- Kanban 4-state standardization
-- Reduce TaskStatus enum from 6 to 4 values.
-- Mapping: PAUSED -> TODO, DELAYED -> IN_PROGRESS, CANCELLED -> DONE
-- New REVIEW value added for the 3rd Kanban column.

-- 1. Create new enum type
CREATE TYPE "TaskStatus_new" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- 2. Map existing data (still on old enum values)
BEGIN;
UPDATE "Task" SET status = 'TODO' WHERE status = 'PAUSED';
UPDATE "Task" SET status = 'IN_PROGRESS' WHERE status = 'DELAYED';
UPDATE "Task" SET status = 'DONE' WHERE status = 'CANCELLED';
COMMIT;

-- 3. Swap the column to the new enum type
ALTER TABLE "Task"
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE "TaskStatus_new" USING status::text::"TaskStatus_new",
  ALTER COLUMN status SET DEFAULT 'TODO';

-- 4. Replace the old enum with the new one under the original name
DROP TYPE "TaskStatus";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
