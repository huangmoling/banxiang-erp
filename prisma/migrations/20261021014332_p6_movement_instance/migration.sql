-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "item_instances" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_stock_movements" ("batchId", "bizType", "createdAt", "createdById", "documentId", "documentItemId", "id", "itemInstanceId", "locationId", "note", "occurredAt", "qtyDelta", "reversal", "skuId") SELECT "batchId", "bizType", "createdAt", "createdById", "documentId", "documentItemId", "id", "itemInstanceId", "locationId", "note", "occurredAt", "qtyDelta", "reversal", "skuId" FROM "stock_movements";
DROP TABLE "stock_movements";
ALTER TABLE "new_stock_movements" RENAME TO "stock_movements";
CREATE INDEX "stock_movements_skuId_locationId_idx" ON "stock_movements"("skuId", "locationId");
CREATE INDEX "stock_movements_occurredAt_idx" ON "stock_movements"("occurredAt");
CREATE INDEX "stock_movements_documentId_idx" ON "stock_movements"("documentId");
CREATE INDEX "stock_movements_bizType_occurredAt_idx" ON "stock_movements"("bizType", "occurredAt");
CREATE INDEX "stock_movements_itemInstanceId_idx" ON "stock_movements"("itemInstanceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
