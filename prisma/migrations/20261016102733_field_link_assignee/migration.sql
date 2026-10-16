-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FieldLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FieldLink_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FieldLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FieldLink_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FieldLink" ("createdAt", "createdById", "expiresAt", "id", "revokedAt", "shipmentId", "tokenHash") SELECT "createdAt", "createdById", "expiresAt", "id", "revokedAt", "shipmentId", "tokenHash" FROM "FieldLink";
DROP TABLE "FieldLink";
ALTER TABLE "new_FieldLink" RENAME TO "FieldLink";
CREATE UNIQUE INDEX "FieldLink_tokenHash_key" ON "FieldLink"("tokenHash");
CREATE INDEX "FieldLink_shipmentId_idx" ON "FieldLink"("shipmentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
