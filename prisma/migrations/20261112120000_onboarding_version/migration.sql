-- 안내 판 번호 칸만 더한다. 기존 행은 비워 둔다(NULL) — 마친 시각이 있으면 1판을 본 것으로 읽는다(lib/onboarding-version.ts)
ALTER TABLE "User" ADD COLUMN "onboardingVersion" INTEGER;
