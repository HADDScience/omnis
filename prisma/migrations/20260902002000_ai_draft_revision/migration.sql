-- 업무 초안을 자연어 지시로 고친 기록. 지금은 보관만 하고 읽는 화면은 없다.
CREATE TABLE "AiDraftRevision" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "source"      TEXT,
  "instruction" TEXT NOT NULL,
  "before"      JSONB NOT NULL,
  "after"       JSONB NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiDraftRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiDraftRevision_userId_createdAt_idx" ON "AiDraftRevision"("userId", "createdAt");

ALTER TABLE "AiDraftRevision"
  ADD CONSTRAINT "AiDraftRevision_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
