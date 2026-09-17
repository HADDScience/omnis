-- 회계 흐름 (2026-09-17)
-- 홈택스 목록 엑셀로 들어온 세금계산서는 PDF 가 없다 — 파일 칸을 선택으로
ALTER TABLE "TaxInvoice" ALTER COLUMN "objectKey" DROP NOT NULL;
ALTER TABLE "TaxInvoice" ALTER COLUMN "fileName" DROP NOT NULL;

-- 입금 · 지급 기록. 나눠 들어올 수 있어 여러 줄
CREATE TABLE "CrmPayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "amountKrw" BIGINT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmPayment_invoiceId_idx" ON "CrmPayment"("invoiceId");
CREATE INDEX "CrmPayment_paidOn_idx" ON "CrmPayment"("paidOn");

ALTER TABLE "CrmPayment" ADD CONSTRAINT "CrmPayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "TaxInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
