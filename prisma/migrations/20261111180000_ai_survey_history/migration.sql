-- AI 활용 설문 — 한 사람이 다시 할 수 있게(2026-11-11). 앞 응답을 지우지 않고 기록으로 남긴다.
-- 「한 사람에 한 건」 제약(unique)을 걷고, 그 사람의 최근 응답을 찾는 색인으로 바꾼다. 행은 건드리지 않는다.
-- mydocs/plans/2026-11-11-ai-usage-survey.md

DROP INDEX "AiSurvey_userId_key";
CREATE INDEX "AiSurvey_userId_createdAt_idx" ON "AiSurvey"("userId", "createdAt");
