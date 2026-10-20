-- Every shipper gets a permanent, unique code (SHP-0001, SHP-0002, ...).
-- Existing shippers are numbered in the order they were created; the "SHIPPER" counter
-- continues from there. Shipments get their own pick-up address, filled from the shipper.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shipper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "defaultPickupAddress" TEXT,
    "defaultArrastre" TEXT NOT NULL DEFAULT 'NNR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shipper" ("id", "code", "name", "contactPerson", "email", "phone", "defaultPickupAddress", "defaultArrastre", "createdAt", "updatedAt")
SELECT s."id",
       'SHP-' || printf('%04d', (SELECT COUNT(*) FROM "Shipper" o
                                 WHERE o."createdAt" < s."createdAt"
                                    OR (o."createdAt" = s."createdAt" AND o."id" <= s."id"))),
       s."name", s."contactPerson", s."email", s."phone", s."defaultPickupAddress", s."defaultArrastre", s."createdAt", s."updatedAt"
FROM "Shipper" s;
DROP TABLE "Shipper";
ALTER TABLE "new_Shipper" RENAME TO "Shipper";
CREATE UNIQUE INDEX "Shipper_code_key" ON "Shipper"("code");
CREATE UNIQUE INDEX "Shipper_name_key" ON "Shipper"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

INSERT INTO "NumberSequence" ("key", "value") SELECT 'SHIPPER', COUNT(*) FROM "Shipper" WHERE true
ON CONFLICT ("key") DO UPDATE SET "value" = MAX("value", excluded."value");

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "pickupAddress" TEXT;
UPDATE "Shipment" SET "pickupAddress" = (SELECT "defaultPickupAddress" FROM "Shipper" WHERE "Shipper"."id" = "Shipment"."shipperId")
WHERE "pickupAddress" IS NULL;
