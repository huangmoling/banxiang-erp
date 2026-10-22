-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_document_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "productionDate" DATETIME,
    "batchNo" TEXT,
    "remark" TEXT,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "originItemId" TEXT,
    "destination" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_items_originItemId_fkey" FOREIGN KEY ("originItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_document_items" ("batchNo", "createdAt", "documentId", "id", "lineNo", "productionDate", "qty", "remark", "returnedQty", "skuId") SELECT "batchNo", "createdAt", "documentId", "id", "lineNo", "productionDate", "qty", "remark", "returnedQty", "skuId" FROM "document_items";
DROP TABLE "document_items";
ALTER TABLE "new_document_items" RENAME TO "document_items";
CREATE INDEX "document_items_documentId_idx" ON "document_items"("documentId");
CREATE INDEX "document_items_skuId_idx" ON "document_items"("skuId");
CREATE INDEX "document_items_originItemId_idx" ON "document_items"("originItemId");
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
    CONSTRAINT "item_instances_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_instances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_outboundItemId_fkey" FOREIGN KEY ("outboundItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_item_instances" ("batchId", "code", "createdAt", "documentItemId", "id", "inboundDocumentId", "locationId", "note", "outboundDocumentId", "outboundItemId", "productionDate", "returnDocumentId", "skuId", "status", "updatedAt") SELECT "batchId", "code", "createdAt", "documentItemId", "id", "inboundDocumentId", "locationId", "note", "outboundDocumentId", "outboundItemId", "productionDate", "returnDocumentId", "skuId", "status", "updatedAt" FROM "item_instances";
DROP TABLE "item_instances";
ALTER TABLE "new_item_instances" RENAME TO "item_instances";
CREATE UNIQUE INDEX "item_instances_code_key" ON "item_instances"("code");
CREATE INDEX "item_instances_skuId_status_idx" ON "item_instances"("skuId", "status");
CREATE INDEX "item_instances_status_idx" ON "item_instances"("status");
CREATE INDEX "item_instances_inboundDocumentId_idx" ON "item_instances"("inboundDocumentId");
CREATE INDEX "item_instances_outboundDocumentId_idx" ON "item_instances"("outboundDocumentId");
CREATE INDEX "item_instances_returnItemId_idx" ON "item_instances"("returnItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "documents_originDocumentId_idx" ON "documents"("originDocumentId");
