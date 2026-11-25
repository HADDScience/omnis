-- 국가과제 첨부 · NAS 폴더(2026-11-25). 빈 칸(nullable) 셋을 더할 뿐 기존 행 값은 바꾸지 않는다
-- AlterTable
ALTER TABLE "GrantDecision" ADD COLUMN     "nasFolder" TEXT,
ADD COLUMN     "nasFolderBy" TEXT;

-- AlterTable
ALTER TABLE "GrantNotice" ADD COLUMN     "attachments" JSONB;

