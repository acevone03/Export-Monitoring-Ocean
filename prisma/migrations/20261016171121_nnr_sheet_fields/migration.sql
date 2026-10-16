-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" TEXT NOT NULL,
    "hblNo" TEXT,
    "podCode" TEXT,
    "partOfHblNo" TEXT,
    "carrierBookingRef" TEXT,
    "shipperId" TEXT NOT NULL,
    "consigneeName" TEXT,
    "destinationPort" TEXT NOT NULL,
    "pod" TEXT NOT NULL,
    "containerPlan" JSONB,
    "cargoType" TEXT NOT NULL,
    "lclQty" INTEGER,
    "lclUnit" TEXT,
    "requestedPickupAt" DATETIME,
    "actualPickupAt" DATETIME,
    "fsiCutoffAt" DATETIME,
    "fsiSubmittedAt" DATETIME,
    "preadviseCutoffAt" DATETIME,
    "preadviseSentAt" DATETIME,
    "arrastreResponsibility" TEXT NOT NULL,
    "exportDeclarationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "exportDeclarationUpdatedAt" DATETIME,
    "bocUploadAt" DATETIME,
    "arrastrePaidAt" DATETIME,
    "arrastreProofId" TEXT,
    "exportDocsSentAt" DATETIME,
    "exportDocsRecipient" TEXT,
    "exportDocsSubject" TEXT,
    "exportDocsToCarrierAt" DATETIME,
    "arrastreCutoffAt" DATETIME,
    "declarationBy" TEXT NOT NULL DEFAULT 'NNR',
    "declarationBroker" TEXT,
    "bocDeadlineAt" DATETIME,
    "arrastreDeadlineAt" DATETIME,
    "carrierName" TEXT,
    "carrierRemarks" TEXT,
    "etdMnl" DATETIME,
    "atdMnl" DATETIME,
    "eta" DATETIME,
    "ata" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "closedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "importedAsHistory" BOOLEAN NOT NULL DEFAULT false,
    "atRisk" BOOLEAN NOT NULL DEFAULT false,
    "overdue" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'CS',
    "assignedCsId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_arrastreProofId_fkey" FOREIGN KEY ("arrastreProofId") REFERENCES "Attachment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Shipment_assignedCsId_fkey" FOREIGN KEY ("assignedCsId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Shipment" ("actualPickupAt", "arrastreDeadlineAt", "arrastrePaidAt", "arrastreProofId", "arrastreResponsibility", "assignedCsId", "atRisk", "ata", "atdMnl", "bocDeadlineAt", "bocUploadAt", "cancelReason", "cancelledAt", "cargoType", "carrierBookingRef", "carrierName", "carrierRemarks", "closedAt", "consigneeName", "containerPlan", "createdAt", "createdById", "destinationPort", "eta", "etdMnl", "exportDeclarationStatus", "exportDeclarationUpdatedAt", "exportDocsRecipient", "exportDocsSentAt", "exportDocsSubject", "fsiCutoffAt", "fsiSubmittedAt", "hblNo", "id", "jobNo", "lclQty", "lclUnit", "overdue", "pod", "preadviseCutoffAt", "preadviseSentAt", "requestedPickupAt", "shipperId", "source", "status", "updatedAt") SELECT "actualPickupAt", "arrastreDeadlineAt", "arrastrePaidAt", "arrastreProofId", "arrastreResponsibility", "assignedCsId", "atRisk", "ata", "atdMnl", "bocDeadlineAt", "bocUploadAt", "cancelReason", "cancelledAt", "cargoType", "carrierBookingRef", "carrierName", "carrierRemarks", "closedAt", "consigneeName", "containerPlan", "createdAt", "createdById", "destinationPort", "eta", "etdMnl", "exportDeclarationStatus", "exportDeclarationUpdatedAt", "exportDocsRecipient", "exportDocsSentAt", "exportDocsSubject", "fsiCutoffAt", "fsiSubmittedAt", "hblNo", "id", "jobNo", "lclQty", "lclUnit", "overdue", "pod", "preadviseCutoffAt", "preadviseSentAt", "requestedPickupAt", "shipperId", "source", "status", "updatedAt" FROM "Shipment";
DROP TABLE "Shipment";
ALTER TABLE "new_Shipment" RENAME TO "Shipment";
CREATE UNIQUE INDEX "Shipment_jobNo_key" ON "Shipment"("jobNo");
CREATE UNIQUE INDEX "Shipment_hblNo_key" ON "Shipment"("hblNo");
CREATE UNIQUE INDEX "Shipment_arrastreProofId_key" ON "Shipment"("arrastreProofId");
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");
CREATE INDEX "Shipment_assignedCsId_idx" ON "Shipment"("assignedCsId");
CREATE INDEX "Shipment_shipperId_idx" ON "Shipment"("shipperId");
CREATE INDEX "Shipment_etdMnl_idx" ON "Shipment"("etdMnl");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
