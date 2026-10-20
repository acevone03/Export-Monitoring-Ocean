-- Pick-up by NNR or delivered by consignee, extra positioning dates, Certificate of Origin.
ALTER TABLE "Shipment" ADD COLUMN "cargoArrangement" TEXT NOT NULL DEFAULT 'NNR_PICKUP';
ALTER TABLE "Shipment" ADD COLUMN "morePositioningAt" JSONB;
ALTER TABLE "Shipment" ADD COLUMN "hasCoo" BOOLEAN NOT NULL DEFAULT false;
