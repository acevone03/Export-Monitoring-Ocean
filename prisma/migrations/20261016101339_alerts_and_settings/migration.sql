-- AlterTable
ALTER TABLE "Alert" ADD COLUMN "deliveryError" TEXT;
ALTER TABLE "Alert" ADD COLUMN "resolution" TEXT;

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
