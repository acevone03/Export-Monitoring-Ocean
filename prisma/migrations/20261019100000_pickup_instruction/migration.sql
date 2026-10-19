-- Pick-up instruction fields sent to the transport company (FCL and LCL).
ALTER TABLE "Shipment" ADD COLUMN "positioningAt" DATETIME;
ALTER TABLE "Shipment" ADD COLUMN "containerYard" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "portOfLoading" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "cyCutoffAt" DATETIME;
ALTER TABLE "Shipment" ADD COLUMN "consolidator" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "grossWeightKg" REAL;
ALTER TABLE "Shipment" ADD COLUMN "cbm" REAL;
ALTER TABLE "Shipment" ADD COLUMN "cargoDescription" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "cargoDimensions" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "deliveryWarehouse" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "pickupRemarks" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "pickupInstructionSentAt" DATETIME;
