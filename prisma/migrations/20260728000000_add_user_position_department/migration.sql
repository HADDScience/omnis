-- 사용자 직급(position)·부서(department) 추가 (nullable, 추가형)
ALTER TABLE "User" ADD COLUMN "position" TEXT;
ALTER TABLE "User" ADD COLUMN "department" TEXT;
