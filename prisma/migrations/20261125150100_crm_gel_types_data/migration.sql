-- CRM 젤 타입 데이터 옮기기(2026-11-25). 앞 마이그레이션(…_crm_gel_types)이 칸을 만든 뒤에 돈다.
--
-- 1) 타입 제품 두 줄을 만든다 — 애드젤 (ADD GEL) · 라이브젤 (LiVEGEL). 이미 있으면 건너뛴다.
-- 2) 규격별 젤 행(이름이 애드젤 · 라이브젤로 시작하고 용량 · 농도가 다 있는 완제품)을 타입으로 옮긴다.
--    - 재고 장부 줄: 수량(개) → 총 ml(개 × 용량). 원래 제품 · 원래 수량은 legacyProductId · legacyQuantity 에 남긴다
--    - 출고 · 견적 품목 · 샘플요청 · 생산: 제품을 타입으로, 농도 · 한 개 용량을 채운다. 원래 제품은 legacyProductId
--    - 규격별 행은 지우지 않고 숨긴다(archived) — 세금계산서 품목 · 지난 기록이 그대로 가리킨다. mergedIntoId 로 어디로 갔는지 남긴다
-- 용량이 없는 젤 행(세트 · 동결건조)은 ml 로 셀 수 없어 그대로 둔다.
-- 다시 돌려도 같은 결과다(옮긴 행은 다시 걸리지 않는다). 전후 대조는 scripts/crm-gel-types-check.ts.

WITH mx AS (
  SELECT COALESCE(MAX((substring(code from '^PRD(\d+)$'))::int), 0) AS n
  FROM "CrmProduct" WHERE code ~ '^PRD\d+$'
), want(gel, name, ord) AS (
  VALUES ('ADDGEL'::"CrmGelType", '애드젤 (ADD GEL)', 1), ('LIVEGEL'::"CrmGelType", '라이브젤 (LiVEGEL)', 2)
), missing AS (
  SELECT w.gel, w.name, row_number() OVER (ORDER BY w.ord) AS rn
  FROM want w WHERE NOT EXISTS (SELECT 1 FROM "CrmProduct" p WHERE p."gelType" = w.gel)
)
INSERT INTO "CrmProduct" (id, code, name, "stockUnit", "isMaterial", archived, "gelType", note)
SELECT gen_random_uuid()::text, 'PRD' || lpad((mx.n + m.rn)::text, 3, '0'), m.name, 'ML', false, false, m.gel,
       '젤 타입 — 재고는 (농도 wt%, 총 ml) 로 센다'
FROM missing m CROSS JOIN mx;

CREATE TEMP TABLE "_gel_legacy" AS
SELECT p.id AS legacy_id, t.id AS type_id, p."concentrationPct" AS conc, p."volumeMl" AS vol
FROM "CrmProduct" p
JOIN "CrmProduct" t ON t."gelType" = CASE
  WHEN p.name LIKE '애드젤%' THEN 'ADDGEL'::"CrmGelType"
  WHEN p.name LIKE '라이브젤%' THEN 'LIVEGEL'::"CrmGelType"
END
WHERE p."gelType" IS NULL AND p."isMaterial" = false AND p."mergedIntoId" IS NULL
  AND p."volumeMl" > 0 AND p."concentrationPct" > 0;

UPDATE "CrmStockMove" m SET
  "legacyProductId" = m."productId",
  "legacyQuantity" = m.quantity,
  "productId" = l.type_id,
  "concentrationPct" = l.conc,
  "volumeMl" = l.vol,
  units = round(m.quantity)::int,
  quantity = round(m.quantity * l.vol, 3)
FROM "_gel_legacy" l WHERE m."productId" = l.legacy_id;

UPDATE "CrmShipment" s SET
  "legacyProductId" = s."productId", "productId" = l.type_id, "concentrationPct" = l.conc, "volumeMl" = l.vol
FROM "_gel_legacy" l WHERE s."productId" = l.legacy_id;

UPDATE "CrmQuoteItem" q SET
  "legacyProductId" = q."productId", "productId" = l.type_id, "concentrationPct" = l.conc, "volumeMl" = l.vol
FROM "_gel_legacy" l WHERE q."productId" = l.legacy_id;

UPDATE "CrmSampleRequest" r SET
  "legacyProductId" = r."productId", "productId" = l.type_id, "concentrationPct" = l.conc, "volumeMl" = l.vol
FROM "_gel_legacy" l WHERE r."productId" = l.legacy_id;

INSERT INTO "CrmProductionLine" (id, "productionId", "volumeMl", units, "sortOrder")
SELECT gen_random_uuid()::text, pr.id, l.vol, pr.quantity, 0
FROM "CrmProduction" pr JOIN "_gel_legacy" l ON pr."productId" = l.legacy_id;

UPDATE "CrmProduction" pr SET
  "legacyProductId" = pr."productId", "productId" = l.type_id, "concentrationPct" = l.conc,
  "totalMl" = round(pr.quantity * l.vol, 3)
FROM "_gel_legacy" l WHERE pr."productId" = l.legacy_id;

UPDATE "CrmProduct" p SET archived = true, "mergedIntoId" = l.type_id
FROM "_gel_legacy" l WHERE p.id = l.legacy_id;

DROP TABLE "_gel_legacy";
