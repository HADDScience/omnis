-- 공통 층 변경 이벤트 (2026-11-27, P4) — mydocs/plans/2026-11-27-ontology-phase1.md §6
-- 등록 유형이 기대는 표 셋(CompanyRecord · GrantDecision · CrmOrg)에 트리거를 건다. **기존 표에 손을 대는 첫 마이그레이션이다.**
-- 트리거는 ObjectChange 에 한 줄을 넣는 일만 한다. 예외를 삼키지 않는다 — 삼키면 이벤트가 빠진다.
-- 대신 함수는 짧게 두고, 문제가 생기면 prisma/rollbacks/20261127235000_object_change.down.sql 하나로 트리거를 걷는다.
-- ChatMessage 에는 이번에 걸지 않는다(작업지시자 결정 2026-11-27, 계획서 다음 단계).
--
-- 다시 돌려도 같은 결과가 되게 쓴다(IF NOT EXISTS · OR REPLACE · 지우고 다시 건다). 데모 미리보기가 PR 브랜치에서
-- 공용 데모 DB 에 migrate deploy 를 건다(migration-traps.md). 이름은 처음부터 최종 이름이다 — 바꾸지 않는다.
--
-- 표에 트리거를 거는 동안 짧은 잠금을 잡는다. 오래 기다리면 실패하게 한다(맞춤 화면 쓰기를 붙잡지 않게).
SET lock_timeout = '5s';

-- 1. outbox 표
CREATE TABLE IF NOT EXISTS "ObjectChange" (
    "id" BIGSERIAL NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "changedCols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "oldValues" JSONB,
    "newValues" JSONB,
    "actorKind" TEXT NOT NULL DEFAULT 'screen',
    "txid" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "ObjectChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ObjectChange_processedAt_id_idx" ON "ObjectChange"("processedAt", "id");
CREATE INDEX IF NOT EXISTS "ObjectChange_tableName_rowId_idx" ON "ObjectChange"("tableName", "rowId");

ALTER TABLE "ObjectChange" DROP CONSTRAINT IF EXISTS "ObjectChange_op_check";
ALTER TABLE "ObjectChange" ADD CONSTRAINT "ObjectChange_op_check" CHECK ("op" IN ('I', 'U', 'D'));
ALTER TABLE "ObjectChange" DROP CONSTRAINT IF EXISTS "ObjectChange_actorKind_check";
ALTER TABLE "ObjectChange" ADD CONSTRAINT "ObjectChange_actorKind_check" CHECK ("actorKind" IN ('screen', 'source', 'human', 'ai'));

-- 2. 트리거 함수 — 바뀐 칼럼과 그 앞뒤 값만 남긴다. updatedAt 만 바뀐 UPDATE 는 남기지 않는다
--    쓴 쪽은 연결 설정 omnis.actor_kind(이식 스크립트는 lib/import-actor.ts 가 source 를 단다). 모르는 값 · 없음은 screen
CREATE OR REPLACE FUNCTION omnis_capture_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n jsonb;
  o jsonb;
  cols text[];
  actor text := coalesce(nullif(current_setting('omnis.actor_kind', true), ''), 'screen');
BEGIN
  IF actor NOT IN ('screen', 'source', 'human', 'ai') THEN
    actor := 'screen';
  END IF;

  IF TG_OP = 'INSERT' THEN
    n := to_jsonb(NEW);
    INSERT INTO "ObjectChange" ("tableName", "rowId", "op", "newValues", "actorKind", "txid")
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, n ->> 'id', 'I', n, actor, txid_current());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    n := to_jsonb(NEW);
    o := to_jsonb(OLD);
    SELECT coalesce(array_agg(e.key ORDER BY e.key), ARRAY[]::text[]) INTO cols
      FROM jsonb_each(n) AS e
     WHERE e.key <> 'updatedAt' AND (o -> e.key) IS DISTINCT FROM e.value;
    IF cardinality(cols) = 0 THEN
      RETURN NEW;
    END IF;
    INSERT INTO "ObjectChange" ("tableName", "rowId", "op", "changedCols", "oldValues", "newValues", "actorKind", "txid")
    VALUES (
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, n ->> 'id', 'U', cols,
      (SELECT jsonb_object_agg(c, o -> c) FROM unnest(cols) AS c),
      (SELECT jsonb_object_agg(c, n -> c) FROM unnest(cols) AS c),
      actor, txid_current()
    );
    RETURN NEW;
  ELSE
    o := to_jsonb(OLD);
    INSERT INTO "ObjectChange" ("tableName", "rowId", "op", "oldValues", "actorKind", "txid")
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, o ->> 'id', 'D', o, actor, txid_current());
    RETURN OLD;
  END IF;
END
$$;

-- 3. 트리거 — 등록 유형이 기대는 표 셋(lib/objects 의 OBJECT_TYPES backing 과 같아야 한다. 시험이 대조한다)
DROP TRIGGER IF EXISTS "omnis_capture_change" ON "CompanyRecord";
CREATE TRIGGER "omnis_capture_change" AFTER INSERT OR UPDATE OR DELETE ON "CompanyRecord"
  FOR EACH ROW EXECUTE FUNCTION omnis_capture_change();
DROP TRIGGER IF EXISTS "omnis_capture_change" ON "GrantDecision";
CREATE TRIGGER "omnis_capture_change" AFTER INSERT OR UPDATE OR DELETE ON "GrantDecision"
  FOR EACH ROW EXECUTE FUNCTION omnis_capture_change();
DROP TRIGGER IF EXISTS "omnis_capture_change" ON "CrmOrg";
CREATE TRIGGER "omnis_capture_change" AFTER INSERT OR UPDATE OR DELETE ON "CrmOrg"
  FOR EACH ROW EXECUTE FUNCTION omnis_capture_change();
