-- AI 활용 설문(2026-11-11) — 표 추가만, 빈 표로 시작한다. 한 사람에 한 건(userId unique).
-- mydocs/plans/2026-11-11-ai-usage-survey.md

CREATE TABLE "AiSurvey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "facts" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "metrics" JSONB,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSurvey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiSurvey_userId_key" ON "AiSurvey"("userId");
CREATE INDEX "AiSurvey_status_idx" ON "AiSurvey"("status");
