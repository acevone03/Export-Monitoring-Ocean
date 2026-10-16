-- Column V of NNR's sheet is docs sent to the overseas office; "(AAI)" is the forwarder.
ALTER TABLE "Shipment" RENAME COLUMN "exportDocsToCarrierAt" TO "exportDocsToOverseasAt";
ALTER TABLE "Shipment" RENAME COLUMN "declarationBroker" TO "declarationForwarder";
