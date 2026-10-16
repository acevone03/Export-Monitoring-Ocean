-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "viberId" TEXT,
    "telegramId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shipperId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shipper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "defaultPickupAddress" TEXT,
    "defaultArrastre" TEXT NOT NULL DEFAULT 'NNR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "hblHawbNo" TEXT,
    "carrierBookingRef" TEXT,
    "mawbNo" TEXT,
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

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "MilestoneEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "source" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MilestoneEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MilestoneEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeadlineRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deadlineType" TEXT NOT NULL,
    "baseField" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "reminderOffsets" JSONB NOT NULL,
    "overdueRepeatMinutes" INTEGER NOT NULL DEFAULT 120,
    "overdueMaxPerDay" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "deadlineType" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "channels" TEXT NOT NULL DEFAULT '',
    "ackById" TEXT,
    "ackAt" DATETIME,
    "snoozedUntil" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Alert_ackById_fkey" FOREIGN KEY ("ackById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "alertId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailIntake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawText" TEXT NOT NULL,
    "attachmentText" TEXT,
    "extractedJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "shipmentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailIntake_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailIntake_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FieldLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FieldLink_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FieldLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipper_name_key" ON "Shipper"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_jobNo_key" ON "Shipment"("jobNo");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_hblHawbNo_key" ON "Shipment"("hblHawbNo");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_arrastreProofId_key" ON "Shipment"("arrastreProofId");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_assignedCsId_idx" ON "Shipment"("assignedCsId");

-- CreateIndex
CREATE INDEX "Shipment_shipperId_idx" ON "Shipment"("shipperId");

-- CreateIndex
CREATE INDEX "Shipment_etdMnl_idx" ON "Shipment"("etdMnl");

-- CreateIndex
CREATE INDEX "MilestoneEvent_shipmentId_occurredAt_idx" ON "MilestoneEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "MilestoneEvent_type_occurredAt_idx" ON "MilestoneEvent"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineRule_deadlineType_key" ON "DeadlineRule"("deadlineType");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_idx" ON "Alert"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_shipmentId_deadlineType_level_offsetMinutes_dueAt_key" ON "Alert"("shipmentId", "deadlineType", "level", "offsetMinutes", "dueAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIntake_shipmentId_key" ON "EmailIntake"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldLink_tokenHash_key" ON "FieldLink"("tokenHash");
