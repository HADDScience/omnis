-- 운영 설정(2026-11-10) — AI 비용 상한 · 기능 요청 받는 사람. 표 추가만, 빈 표로 시작한다(값이 없으면 env 기본값).
-- mydocs/plans/2026-11-10-ai-budget.md

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
