-- Vessel / voyage, freight terms (prepaid or collect) and Incoterms, for the booking sheet.
ALTER TABLE "Shipment" ADD COLUMN "vesselName" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "voyageNo" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "freightTerms" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "incoterm" TEXT;
