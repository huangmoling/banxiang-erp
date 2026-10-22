-- AlterTable
ALTER TABLE "document_items" ADD COLUMN "bookQty" INTEGER;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "snapshotAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "item_instances_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_instances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_outboundItemId_fkey" FOREIGN KEY ("outboundItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_stocktakeItemId_fkey" FOREIGN KEY ("stocktakeItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_item_instances" ("batchId", "code", "createdAt", "documentItemId", "id", "inboundDocumentId", "locationId", "note", "outboundDocumentId", "outboundItemId", "productionDate", "returnDocumentId", "returnItemId", "skuId", "status", "updatedAt") SELECT "batchId", "code", "createdAt", "documentItemId", "id", "inboundDocumentId", "locationId", "note", "outboundDocumentId", "outboundItemId", "productionDate", "returnDocumentId", "returnItemId", "skuId", "status", "updatedAt" FROM "item_instances";
DROP TABLE "item_instances";
ALTER TABLE "new_item_instances" RENAME TO "item_instances";
CREATE UNIQUE INDEX "item_instances_code_key" ON "item_instances"("code");
CREATE INDEX "item_instances_skuId_status_idx" ON "item_instances"("skuId", "status");
CREATE INDEX "item_instances_status_idx" ON "item_instances"("status");
CREATE INDEX "item_instances_inboundDocumentId_idx" ON "item_instances"("inboundDocumentId");
CREATE INDEX "item_instances_outboundDocumentId_idx" ON "item_instances"("outboundDocumentId");
CREATE INDEX "item_instances_returnItemId_idx" ON "item_instances"("returnItemId");
CREATE INDEX "item_instances_stocktakeItemId_idx" ON "item_instances"("stocktakeItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
