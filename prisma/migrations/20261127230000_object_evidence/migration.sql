-- 공통 층 근거 · 이력 · 제안 표 3개 (2026-11-27, P3) — mydocs/plans/2026-11-27-ontology-phase1.md §2-3 · §5
-- 새 표만 만든다. 기존 표는 건드리지 않는다 — 외래키도 새 표끼리 · P2 정의 표(ObjectType)로만 건다.
-- 아직 쓰는 코드가 없다(P7 제안 통합 · P10 run_action 이 처음 쓴다).
--
-- 다시 돌려도 같은 결과가 되게 쓴다(IF NOT EXISTS · 제약은 지우고 다시 건다). 데모 미리보기 빌드가 PR 브랜치에서
-- 공용 데모 DB 에 migrate deploy 를 건다(mydocs/troubleshootings/migration-traps.md 「push 한 마이그레이션 이름을 바꾸지 않는다」).
-- 이름은 처음부터 최종 이름이다 — 바꾸지 않는다.
-- 되돌리기: prisma/rollbacks/20261127230000_object_evidence.down.sql

-- 1. 표
CREATE TABLE IF NOT EXISTS "Proposal" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "objectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "original" JSONB NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "schemaVersion" INTEGER NOT NULL,
    "visibility" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needsWiden" BOOLEAN NOT NULL DEFAULT false,
    "autoGroup" TEXT,
    "trigger" TEXT NOT NULL,
    "triggerRef" TEXT,
    "supersededById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "legacyRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Evidence" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "typeKey" TEXT NOT NULL,
    "objectId" TEXT,
    "fieldKey" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "spanStart" INTEGER,
    "spanEnd" INTEGER,
    "quote" TEXT,
    "quoteHash" TEXT NOT NULL,
    "visibility" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "goneAt" TIMESTAMP(3),

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ObjectRevision" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "fieldKey" TEXT,
    "op" TEXT NOT NULL,
    "value" JSONB,
    "prevValue" JSONB,
    "schemaVersion" INTEGER NOT NULL,
    "authorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "proposalId" TEXT,
    "changeId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,

    CONSTRAINT "ObjectRevision_pkey" PRIMARY KEY ("id")
);

-- 2. 색인
CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_legacyRef_key" ON "Proposal"("legacyRef");
CREATE INDEX IF NOT EXISTS "Proposal_status_createdAt_idx" ON "Proposal"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Proposal_typeKey_status_idx" ON "Proposal"("typeKey", "status");
CREATE INDEX IF NOT EXISTS "Proposal_typeKey_objectId_idx" ON "Proposal"("typeKey", "objectId");
CREATE INDEX IF NOT EXISTS "Proposal_autoGroup_status_idx" ON "Proposal"("autoGroup", "status");
CREATE INDEX IF NOT EXISTS "Evidence_sourceKind_sourceId_idx" ON "Evidence"("sourceKind", "sourceId");
CREATE INDEX IF NOT EXISTS "Evidence_typeKey_objectId_idx" ON "Evidence"("typeKey", "objectId");
CREATE INDEX IF NOT EXISTS "Evidence_proposalId_idx" ON "Evidence"("proposalId");
CREATE INDEX IF NOT EXISTS "ObjectRevision_typeKey_objectId_fieldKey_createdAt_idx" ON "ObjectRevision"("typeKey", "objectId", "fieldKey", "createdAt");
CREATE INDEX IF NOT EXISTS "ObjectRevision_proposalId_idx" ON "ObjectRevision"("proposalId");
CREATE INDEX IF NOT EXISTS "ObjectRevision_changeId_idx" ON "ObjectRevision"("changeId");

-- 3. 외래키 (있으면 지우고 다시 건다)
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_typeKey_fkey";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_typeKey_fkey" FOREIGN KEY ("typeKey") REFERENCES "ObjectType"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_supersededById_fkey";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Evidence" DROP CONSTRAINT IF EXISTS "Evidence_proposalId_fkey";
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ObjectRevision" DROP CONSTRAINT IF EXISTS "ObjectRevision_typeKey_fkey";
ALTER TABLE "ObjectRevision" ADD CONSTRAINT "ObjectRevision_typeKey_fkey" FOREIGN KEY ("typeKey") REFERENCES "ObjectType"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ObjectRevision" DROP CONSTRAINT IF EXISTS "ObjectRevision_proposalId_fkey";
ALTER TABLE "ObjectRevision" ADD CONSTRAINT "ObjectRevision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. 허용 값(CHECK) — 값 목록은 lib/objects/records.ts 와 같다(lib/objects/records.test.ts 가 대조한다)
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_op_check";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_op_check" CHECK ("op" IN ('create', 'update'));
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_status_check";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_status_check" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'auto_applied', 'superseded', 'stale'));
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_confidence_check";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_schemaVersion_check";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_schemaVersion_check" CHECK ("schemaVersion" >= 1);
-- 고치기 제안은 대상이 있어야 한다
ALTER TABLE "Proposal" DROP CONSTRAINT IF EXISTS "Proposal_update_target_check";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_update_target_check" CHECK ("op" <> 'update' OR "objectId" IS NOT NULL);

ALTER TABLE "Evidence" DROP CONSTRAINT IF EXISTS "Evidence_sourceKind_check";
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sourceKind_check" CHECK ("sourceKind" IN ('chat_message', 'task', 'weekly_report', 'file', 'ip_communication', 'email', 'import_row'));
ALTER TABLE "Evidence" DROP CONSTRAINT IF EXISTS "Evidence_quote_check";
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_quote_check" CHECK ("quote" IS NULL OR char_length("quote") <= 300);
ALTER TABLE "Evidence" DROP CONSTRAINT IF EXISTS "Evidence_span_check";
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_span_check" CHECK (
  ("spanStart" IS NULL AND "spanEnd" IS NULL) OR ("spanStart" >= 0 AND "spanEnd" >= "spanStart")
);

ALTER TABLE "ObjectRevision" DROP CONSTRAINT IF EXISTS "ObjectRevision_op_check";
ALTER TABLE "ObjectRevision" ADD CONSTRAINT "ObjectRevision_op_check" CHECK ("op" IN ('create', 'update', 'delete', 'widen', 'revert'));
ALTER TABLE "ObjectRevision" DROP CONSTRAINT IF EXISTS "ObjectRevision_authorKind_check";
ALTER TABLE "ObjectRevision" ADD CONSTRAINT "ObjectRevision_authorKind_check" CHECK ("authorKind" IN ('ai', 'human', 'screen', 'source'));
ALTER TABLE "ObjectRevision" DROP CONSTRAINT IF EXISTS "ObjectRevision_schemaVersion_check";
ALTER TABLE "ObjectRevision" ADD CONSTRAINT "ObjectRevision_schemaVersion_check" CHECK ("schemaVersion" >= 1);
-- 사람이 쓴 이력만 쓴 사람이 있다
ALTER TABLE "ObjectRevision" DROP CONSTRAINT IF EXISTS "ObjectRevision_actor_check";
ALTER TABLE "ObjectRevision" ADD CONSTRAINT "ObjectRevision_actor_check" CHECK ("actorId" IS NULL OR "authorKind" = 'human');
