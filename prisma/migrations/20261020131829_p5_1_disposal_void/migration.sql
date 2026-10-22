-- AlterTable
ALTER TABLE "document_items" ADD COLUMN "disposition" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bizDate" DATETIME NOT NULL,
    "locationId" TEXT,
    "originDocumentId" TEXT,
    "snapshotAt" DATETIME,
    "externalNo" TEXT,
    "receiverName" TEXT,
    "trackingNo" TEXT,
    "remark" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "documents_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_originDocumentId_fkey" FOREIGN KEY ("originDocumentId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("approvedAt", "approvedById", "bizDate", "createdAt", "createdById", "docNo", "externalNo", "id", "itemCount", "locationId", "originDocumentId", "receiverName", "remark", "snapshotAt", "status", "totalQty", "trackingNo", "type", "updatedAt", "voidReason", "voidedAt") SELECT "approvedAt", "approvedById", "bizDate", "createdAt", "createdById", "docNo", "externalNo", "id", "itemCount", "locationId", "originDocumentId", "receiverName", "remark", "snapshotAt", "status", "totalQty", "trackingNo", "type", "updatedAt", "voidReason", "voidedAt" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE UNIQUE INDEX "documents_docNo_key" ON "documents"("docNo");
CREATE INDEX "documents_type_status_idx" ON "documents"("type", "status");
CREATE INDEX "documents_bizDate_idx" ON "documents"("bizDate");
CREATE INDEX "documents_externalNo_idx" ON "documents"("externalNo");
CREATE INDEX "documents_originDocumentId_idx" ON "documents"("originDocumentId");
CREATE TABLE "new_item_instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "locationId" TEXT,
    "batchId" TEXT,
    "productionDate" DATETIME,
    "inboundDocumentId" TEXT,
    "outboundDocumentId" TEXT,
    "returnDocumentId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "documentItemId" TEXT,
    "outboundItemId" TEXT,
    "returnItemId" TEXT,
    "stocktakeItemId" TEXT,
    "disposalItemId" TEXT,
    CONSTRAINT "item_instances_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_instances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_outboundItemId_fkey" FOREIGN KEY ("outboundItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_stocktakeItemId_fkey" FOREIGN KEY ("stocktakeItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_disposalItemId_fkey" FOREIGN KEY ("disposalItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_item_instances" ("batchId", "code", "createdAt", "documentItemId", "id", "inboundDocumentId", "locationId", "note", "outboundDocumentId", "outboundItemId", "productionDate", "returnDocumentId", "returnItemId", "skuId", "status", "stocktakeItemId", "updatedAt") SELECT "batchId", "code", "createdAt", "documentItemId", "id", "inboundDocumentId", "locationId", "note", "outboundDocumentId", "outboundItemId", "productionDate", "returnDocumentId", "returnItemId", "skuId", "status", "stocktakeItemId", "updatedAt" FROM "item_instances";
DROP TABLE "item_instances";
ALTER TABLE "new_item_instances" RENAME TO "item_instances";
CREATE UNIQUE INDEX "item_instances_code_key" ON "item_instances"("code");
CREATE INDEX "item_instances_skuId_status_idx" ON "item_instances"("skuId", "status");
CREATE INDEX "item_instances_status_idx" ON "item_instances"("status");
CREATE INDEX "item_instances_inboundDocumentId_idx" ON "item_instances"("inboundDocumentId");
CREATE INDEX "item_instances_outboundDocumentId_idx" ON "item_instances"("outboundDocumentId");
CREATE INDEX "item_instances_returnItemId_idx" ON "item_instances"("returnItemId");
CREATE INDEX "item_instances_stocktakeItemId_idx" ON "item_instances"("stocktakeItemId");
CREATE INDEX "item_instances_disposalItemId_idx" ON "item_instances"("disposalItemId");
CREATE TABLE "new_stock_movements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "bizType" TEXT NOT NULL,
    "documentId" TEXT,
    "documentItemId" TEXT,
    "batchId" TEXT,
    "itemInstanceId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "reversal" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "document_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_stock_movements" ("batchId", "bizType", "createdAt", "createdById", "documentId", "documentItemId", "id", "itemInstanceId", "locationId", "note", "occurredAt", "qtyDelta", "skuId") SELECT "batchId", "bizType", "createdAt", "createdById", "documentId", "documentItemId", "id", "itemInstanceId", "locationId", "note", "occurredAt", "qtyDelta", "skuId" FROM "stock_movements";
DROP TABLE "stock_movements";
ALTER TABLE "new_stock_movements" RENAME TO "stock_movements";
CREATE INDEX "stock_movements_skuId_locationId_idx" ON "stock_movements"("skuId", "locationId");
CREATE INDEX "stock_movements_occurredAt_idx" ON "stock_movements"("occurredAt");
CREATE INDEX "stock_movements_documentId_idx" ON "stock_movements"("documentId");
CREATE INDEX "stock_movements_bizType_occurredAt_idx" ON "stock_movements"("bizType", "occurredAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
