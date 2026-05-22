-- Weekly reports are private per owner and there must be one report per ISO week.
ALTER TABLE "WeeklyReport" ADD COLUMN "submittedAt" TIMESTAMP(3);

DELETE FROM "WeeklyReport"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "ownerId", "isoWeek"
        ORDER BY "updatedAt" DESC, "createdAt" DESC
      ) AS rn
    FROM "WeeklyReport"
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX "WeeklyReport_ownerId_isoWeek_key" ON "WeeklyReport"("ownerId", "isoWeek");
