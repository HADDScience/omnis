-- 수집기 공고(과제 후보, 2026-11-25). 새 표 하나만 만든다 — 기존 표는 바꾸지 않는다
-- CreateTable
CREATE TABLE "GrantNotice" (
    "id" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ministry" TEXT,
    "agency" TEXT,
    "url" TEXT,
    "rcptStartAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "deadlineRaw" TEXT,
    "regionClass" TEXT,
    "regionDetail" TEXT[],
    "fields" TEXT[],
    "isRnd" BOOLEAN,
    "verdictSole" TEXT,
    "verdictCorp" TEXT,
    "reasonsSole" JSONB,
    "reasonsCorp" JSONB,
    "judgedBy" TEXT,
    "firstSeen" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrantNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrantNotice_externalKey_key" ON "GrantNotice"("externalKey");

-- CreateIndex
CREATE INDEX "GrantNotice_deadlineAt_idx" ON "GrantNotice"("deadlineAt");

-- CreateIndex
CREATE INDEX "GrantNotice_verdictSole_idx" ON "GrantNotice"("verdictSole");

-- CreateIndex
CREATE INDEX "GrantNotice_regionClass_idx" ON "GrantNotice"("regionClass");

