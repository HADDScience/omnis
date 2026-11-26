-- 공고별 면접 정보(지원서함 공고 보드 머리) — 새 표 하나만 만든다. 기존 표 · 칸은 건드리지 않는다. 채울 값이 없어 백필도 없다.
-- 되돌리기: DROP TABLE "JobPostingMeta";
-- 계획: mydocs/plans/2026-11-26-hr-job-interview-meta.md
-- CreateTable
CREATE TABLE "JobPostingMeta" (
    "jobSlug" TEXT NOT NULL,
    "interviewSlots" JSONB NOT NULL DEFAULT '[]',
    "interviewPlace" TEXT,
    "interviewMode" TEXT,
    "videoUrl" TEXT,
    "memo" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPostingMeta_pkey" PRIMARY KEY ("jobSlug")
);
