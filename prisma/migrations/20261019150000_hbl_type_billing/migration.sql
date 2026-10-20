-- HBL type (NNR consolidation or direct carrier bill) and payment/billing milestones.
ALTER TABLE "Shipment" ADD COLUMN "hblType" TEXT NOT NULL DEFAULT 'NNR';
ALTER TABLE "Shipment" ADD COLUMN "etrackPaidAt" DATETIME;
ALTER TABLE "Shipment" ADD COLUMN "shippingLinePaidAt" DATETIME;
ALTER TABLE "Shipment" ADD COLUMN "invoicedAt" DATETIME;
ALTER TABLE "Shipment" ADD COLUMN "invoiceNo" TEXT;

-- Spreadsheet rows imported as "DIRECT BL" have no NNR HBL.
UPDATE "Shipment" SET "hblType" = 'DIRECT' WHERE "hblNo" IS NULL AND "carrierRemarks" LIKE '%DIRECT BL%';

CREATE INDEX "Shipment_invoicedAt_idx" ON "Shipment"("invoicedAt");
