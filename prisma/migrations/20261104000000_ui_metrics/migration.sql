-- UI 변경 적응 부담 측정(2026-11-04). 표 추가만 — 지금 운영 코드는 이 표를 읽지 않는다.
-- 빈 표로 시작하므로 백필이 없다. mydocs/plans/2026-11-04-ui-metrics.md

CREATE TABLE "UiEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER,
    "path" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,

    CONSTRAINT "UiEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UiSurveyResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UiSurveyResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UiEvent_at_idx" ON "UiEvent"("at");
CREATE INDEX "UiEvent_commitSha_at_idx" ON "UiEvent"("commitSha", "at");
CREATE INDEX "UiEvent_userId_commitSha_idx" ON "UiEvent"("userId", "commitSha");
CREATE INDEX "UiSurveyResponse_commitSha_idx" ON "UiSurveyResponse"("commitSha");
CREATE UNIQUE INDEX "UiSurveyResponse_userId_commitSha_key" ON "UiSurveyResponse"("userId", "commitSha");

ALTER TABLE "UiEvent" ADD CONSTRAINT "UiEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UiSurveyResponse" ADD CONSTRAINT "UiSurveyResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
