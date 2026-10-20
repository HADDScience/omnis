-- 기관의 청구처(세금계산서 받는 기관). NULL = 자기 자신 — 기존 줄은 그대로 둔다(기본값 없음).
ALTER TABLE "CrmOrg" ADD COLUMN "billingOrgId" TEXT;

ALTER TABLE "CrmOrg" ADD CONSTRAINT "CrmOrg_billingOrgId_fkey" FOREIGN KEY ("billingOrgId") REFERENCES "CrmOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;
