-- CRM 젤 재고 2차(2026-11-25) — 개수를 세지 않고 ml 만 쓴다. 세트 · 동결건조도 따로 두지 않는다.
-- 앞 두 마이그레이션(…_crm_gel_types · …_crm_gel_types_data) 뒤에 돈다.
--
-- 1) 젤 타입 출고: 「한 개 용량 × 개수」를 출고 ml(volumeMl) 하나로 합치고 개수(quantity)는 비운다.
--    재고 장부 줄은 이미 총 ml 라 그대로다. 옛 5ml(1ml × 5ea) 는 5ml 로 센다(앞 마이그레이션 그대로).
-- 2) 젤 타입 샘플요청: 딸린 출고가 있으면 그 출고 ml 의 합을 요청 ml 로 둔다. 없으면 적힌 ml 그대로.
-- 3) 젤 타입 생산: 개수(quantity)를 비운다. 만든 양은 totalMl.
-- 4) 농도 · ml 를 몰라 타입으로 옮기지 못한 젤 행(세트 · 동결건조)은 지우지 않고 숨긴다.
--    지난 출고 · 견적 품목은 그 행을 그대로 가리킨다. 목록은 보고서(omnis-reports/crm-inventory-restructure-261125.md)에 적었다.
-- 5) 개수 칸을 지운다: CrmStockMove.units · volumeMl, CrmProductionLine. 견적 품목의 개수 × 단가는 그대로 둔다.
-- 전후 대조는 scripts/crm-gel-types-check.ts.

ALTER TABLE "CrmShipment" ALTER COLUMN "quantity" DROP NOT NULL;
ALTER TABLE "CrmProduction" ALTER COLUMN "quantity" DROP NOT NULL;

UPDATE "CrmShipment" s SET "volumeMl" = round(s.quantity * s."volumeMl", 3), quantity = NULL
FROM "CrmProduct" p
WHERE p.id = s."productId" AND p."gelType" IS NOT NULL AND s.quantity IS NOT NULL AND s."volumeMl" IS NOT NULL;

UPDATE "CrmSampleRequest" r SET "volumeMl" = x.ml
FROM (
  SELECT s."sampleRequestId" AS id, sum(s."volumeMl") AS ml
  FROM "CrmShipment" s JOIN "CrmProduct" p ON p.id = s."productId"
  WHERE p."gelType" IS NOT NULL AND s."sampleRequestId" IS NOT NULL AND s."volumeMl" IS NOT NULL
  GROUP BY 1
) x
WHERE r.id = x.id;

UPDATE "CrmProduction" pr SET quantity = NULL
FROM "CrmProduct" p WHERE p.id = pr."productId" AND p."gelType" IS NOT NULL;

UPDATE "CrmProduct" p SET archived = true,
  note = concat_ws(' / ', NULLIF(p.note, ''), '숨김(2026-11-25): 농도 · ml 정보가 없어 젤 타입 단품 재고로 옮기지 못함')
WHERE p."gelType" IS NULL AND p."isMaterial" = false AND p."mergedIntoId" IS NULL AND p.archived = false
  AND (p.name LIKE '애드젤%' OR p.name LIKE '라이브젤%');

UPDATE "CrmProduct" SET note = '젤 타입 — 재고는 (농도 %, 총 ml) 로 센다'
WHERE "gelType" IS NOT NULL AND note = '젤 타입 — 재고는 (농도 wt%, 총 ml) 로 센다';

ALTER TABLE "CrmProductionLine" DROP CONSTRAINT "CrmProductionLine_productionId_fkey";
DROP TABLE "CrmProductionLine";
ALTER TABLE "CrmStockMove" DROP COLUMN "units", DROP COLUMN "volumeMl";
