-- 국가과제 「우리 결정」 상태 체계 v2 (2026-11-26, 정우창 확정)
-- 준비 → 제출 완료 → 선정됨 / 미선정, 선정됨 → 수행 중 → 완료, 어디서든 → 중단. 「검토」 는 없앤다.
-- 상태는 Postgres enum 대신 text + CHECK 로 둔다 — 선택지를 바꿀 때 enum 을 다시 만들지 않는다
-- (설계 omnis-ontology-phase1-design-261126 §2-1, 조사 §2: Twenty 의 enum 재작성 502).
--
-- 다시 돌려도 같은 결과가 되게 쓴다(2026-11-26). 처음 이름(20261126120000_grant_stages_v2)으로 데모 DB 에 한 번 적용된 뒤
-- 이름을 바꿔 다시 돌자 「DROP TYPE "GrantStage"」 가 42704(type does not exist)로 실패했다. 운영처럼 enum 인 DB 에서는 하는 일이 같다.

-- 1. enum → text (값은 그대로)
--    이미 text 면 그대로다
ALTER TABLE "GrantDecision" ALTER COLUMN "stage" TYPE TEXT USING "stage"::text;
DROP TYPE IF EXISTS "GrantStage";

-- 2. 옮기는 결정마다 활동 기록(옮길 행이 없으면 0줄) — 사람이 고친 것(grant.decision.updated)과 action 을 달리해
--    이식 스크립트의 「사람 손질 보호」 가 이것을 사람 수정으로 읽지 않는다
INSERT INTO "ActivityLog" ("id", "userId", "action", "entity", "entityId", "title", "metadata", "createdAt")
SELECT
  gen_random_uuid()::text,
  NULL,
  'grant.decision.stage_migrated',
  'GRANT_DECISION',
  "id",
  '국가과제 결정 상태 체계 변경으로 자동 이동: ' || "title",
  jsonb_build_object(
    'from', "stage",
    'to', CASE "stage" WHEN 'REVIEW' THEN 'PREPARING' WHEN 'DROPPED' THEN 'STOPPED' END,
    'reason', '상태 체계 변경으로 자동 이동'
  ),
  CURRENT_TIMESTAMP
FROM "GrantDecision"
WHERE "stage" IN ('REVIEW', 'DROPPED');

-- 3. 값 옮기기 — 검토 → 준비, 불참 → 중단. 제출 · 선정 · 미선정 · 준비는 키가 같다(표시 이름만 바뀐다)
UPDATE "GrantDecision" SET "stage" = 'PREPARING' WHERE "stage" = 'REVIEW';
UPDATE "GrantDecision" SET "stage" = 'STOPPED' WHERE "stage" = 'DROPPED';

-- 4. 허용 값(있으면 갈아 끼운다)
ALTER TABLE "GrantDecision" DROP CONSTRAINT IF EXISTS "GrantDecision_stage_check";
ALTER TABLE "GrantDecision" ADD CONSTRAINT "GrantDecision_stage_check"
  CHECK ("stage" IN ('PREPARING', 'SUBMITTED', 'SELECTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'STOPPED'));

-- 5. 상태별 칸 — 모두 비워 둔다
ALTER TABLE "GrantDecision"
  ADD COLUMN IF NOT EXISTS "selectedOn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "awardedAmount" BIGINT,
  ADD COLUMN IF NOT EXISTS "agreementOn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "startsOn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endsOn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedOn" TIMESTAMP(3);
