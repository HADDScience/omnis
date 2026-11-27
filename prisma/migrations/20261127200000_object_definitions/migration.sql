-- 공통 층 유형 정의 표 5개 (2026-11-27, P2) — mydocs/plans/2026-11-27-ontology-phase1.md §3-1
-- 새 표만 만든다. 기존 표는 건드리지 않는다. 정본은 코드(lib/objects/types)이고 `pnpm run objects:sync` 가 채운다.
--
-- 다시 돌려도 같은 결과가 되게 쓴다(IF NOT EXISTS · 제약은 지우고 다시 건다). 데모 미리보기 빌드가 PR 브랜치에서
-- 공용 데모 DB 에 migrate deploy 를 걸기 때문이다 — PR #274 에서 이름을 바꿔 다시 돌자 실패한 일
-- (mydocs/troubleshootings/migration-traps.md 「push 한 마이그레이션 이름을 바꾸지 않는다」).
-- 되돌리기: prisma/rollbacks/20261127200000_object_definitions.down.sql

-- 1. 표
CREATE TABLE IF NOT EXISTS "ObjectType" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelPlural" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'product',
    "storage" TEXT NOT NULL,
    "backing" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "defHash" TEXT NOT NULL,
    "llmDescription" TEXT NOT NULL,
    "examples" JSONB NOT NULL,
    "visibilityPolicy" TEXT NOT NULL,
    "visibilityFixed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiPropose" BOOLEAN NOT NULL DEFAULT false,
    "autoApply" JSONB,
    "links" JSONB NOT NULL DEFAULT '[]',
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectType_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "ObjectField" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "optionSetKey" TEXT,
    "refTypeKey" TEXT,
    "fileRule" JSONB,
    "frame" TEXT,
    "column" TEXT,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "sortable" BOOLEAN NOT NULL DEFAULT false,
    "aiExtract" BOOLEAN NOT NULL DEFAULT false,
    "llmDescription" TEXT,
    "maxLength" INTEGER,
    "sinceVersion" INTEGER NOT NULL DEFAULT 1,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "ObjectField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OptionValue" (
    "id" TEXT NOT NULL,
    "setKey" TEXT NOT NULL,
    "setLabel" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "legacyValue" TEXT,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "OptionValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ActionType" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tool" TEXT,
    "argMap" JSONB NOT NULL DEFAULT '{}',
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "risk" TEXT NOT NULL,
    "confirm" TEXT,
    "expose" JSONB NOT NULL DEFAULT '{}',
    "maxRows" INTEGER NOT NULL DEFAULT 1,
    "transactional" BOOLEAN NOT NULL DEFAULT true,
    "aiAutoApply" BOOLEAN NOT NULL DEFAULT false,
    "sinceVersion" INTEGER NOT NULL DEFAULT 1,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "ActionType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ObjectTypeVersion" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "defHash" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "breaking" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectTypeVersion_pkey" PRIMARY KEY ("id")
);

-- 2. 유일 색인
CREATE UNIQUE INDEX IF NOT EXISTS "ObjectField_typeKey_key_key" ON "ObjectField"("typeKey", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "OptionValue_setKey_key_key" ON "OptionValue"("setKey", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "OptionValue_setKey_legacyValue_key" ON "OptionValue"("setKey", "legacyValue");
CREATE UNIQUE INDEX IF NOT EXISTS "ActionType_typeKey_key_key" ON "ActionType"("typeKey", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "ObjectTypeVersion_typeKey_version_key" ON "ObjectTypeVersion"("typeKey", "version");

-- 3. 외래키 (있으면 지우고 다시 건다)
ALTER TABLE "ObjectField" DROP CONSTRAINT IF EXISTS "ObjectField_typeKey_fkey";
ALTER TABLE "ObjectField" ADD CONSTRAINT "ObjectField_typeKey_fkey" FOREIGN KEY ("typeKey") REFERENCES "ObjectType"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionType" DROP CONSTRAINT IF EXISTS "ActionType_typeKey_fkey";
ALTER TABLE "ActionType" ADD CONSTRAINT "ActionType_typeKey_fkey" FOREIGN KEY ("typeKey") REFERENCES "ObjectType"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObjectTypeVersion" DROP CONSTRAINT IF EXISTS "ObjectTypeVersion_typeKey_fkey";
ALTER TABLE "ObjectTypeVersion" ADD CONSTRAINT "ObjectTypeVersion_typeKey_fkey" FOREIGN KEY ("typeKey") REFERENCES "ObjectType"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. 허용 값(CHECK) — Prisma 는 CHECK 를 표현하지 못해 여기에만 있다. 값 목록은 lib/objects/define.ts 와 같다
--    (lib/objects/sync.test.ts 가 이 파일과 define.ts 를 대조한다)
ALTER TABLE "ObjectType" DROP CONSTRAINT IF EXISTS "ObjectType_key_check";
ALTER TABLE "ObjectType" ADD CONSTRAINT "ObjectType_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE "ObjectType" DROP CONSTRAINT IF EXISTS "ObjectType_origin_check";
ALTER TABLE "ObjectType" ADD CONSTRAINT "ObjectType_origin_check" CHECK (
  ("origin" = 'product' AND "key" NOT LIKE 'c\_%') OR ("origin" = 'company' AND "key" LIKE 'c\_%')
);
ALTER TABLE "ObjectType" DROP CONSTRAINT IF EXISTS "ObjectType_storage_check";
ALTER TABLE "ObjectType" ADD CONSTRAINT "ObjectType_storage_check" CHECK ("storage" IN ('table', 'ledger', 'generic'));
ALTER TABLE "ObjectType" DROP CONSTRAINT IF EXISTS "ObjectType_visibilityPolicy_check";
ALTER TABLE "ObjectType" ADD CONSTRAINT "ObjectType_visibilityPolicy_check" CHECK ("visibilityPolicy" IN ('fixed', 'inherit', 'column'));
ALTER TABLE "ObjectType" DROP CONSTRAINT IF EXISTS "ObjectType_version_check";
ALTER TABLE "ObjectType" ADD CONSTRAINT "ObjectType_version_check" CHECK ("version" >= 1);

ALTER TABLE "ObjectField" DROP CONSTRAINT IF EXISTS "ObjectField_key_check";
ALTER TABLE "ObjectField" ADD CONSTRAINT "ObjectField_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE "ObjectField" DROP CONSTRAINT IF EXISTS "ObjectField_dataType_check";
ALTER TABLE "ObjectField" ADD CONSTRAINT "ObjectField_dataType_check" CHECK ("dataType" IN (
  'text', 'longtext', 'number', 'money_krw', 'date', 'datetime', 'bool', 'option', 'multi_option', 'ref', 'person', 'file', 'url'
));
ALTER TABLE "ObjectField" DROP CONSTRAINT IF EXISTS "ObjectField_frame_check";
ALTER TABLE "ObjectField" ADD CONSTRAINT "ObjectField_frame_check" CHECK (
  "frame" IS NULL OR "frame" IN ('title', 'startsOn', 'endsOn', 'owner', 'org', 'visibility')
);

ALTER TABLE "OptionValue" DROP CONSTRAINT IF EXISTS "OptionValue_key_check";
ALTER TABLE "OptionValue" ADD CONSTRAINT "OptionValue_key_check" CHECK (
  "setKey" ~ '^[a-z][a-z0-9_]{1,39}$' AND "key" ~ '^[a-z][a-z0-9_]{1,39}$'
);

ALTER TABLE "ActionType" DROP CONSTRAINT IF EXISTS "ActionType_key_check";
ALTER TABLE "ActionType" ADD CONSTRAINT "ActionType_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE "ActionType" DROP CONSTRAINT IF EXISTS "ActionType_kind_check";
ALTER TABLE "ActionType" ADD CONSTRAINT "ActionType_kind_check" CHECK ("kind" IN ('create', 'update', 'upsert', 'delete', 'transition', 'custom'));
ALTER TABLE "ActionType" DROP CONSTRAINT IF EXISTS "ActionType_risk_check";
ALTER TABLE "ActionType" ADD CONSTRAINT "ActionType_risk_check" CHECK ("risk" IN ('read', 'write', 'ledger', 'destructive'));
ALTER TABLE "ActionType" DROP CONSTRAINT IF EXISTS "ActionType_confirm_check";
ALTER TABLE "ActionType" ADD CONSTRAINT "ActionType_confirm_check" CHECK ("confirm" IS NULL OR "confirm" IN ('card', 'param'));
