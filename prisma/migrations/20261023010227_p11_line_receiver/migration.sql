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
    "receiverInfo" TEXT,
    "externalNo" TEXT,
    "trackingNo" TEXT,
    "shippedAt" DATETIME,
    "shippedById" TEXT,
    "originItemId" TEXT,
    "destination" TEXT,
    "disposition" TEXT,
    "bookQty" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_items_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "document_items_originItemId_fkey" FOREIGN KEY ("originItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_document_items" ("batchNo", "bookQty", "createdAt", "destination", "disposition", "documentId", "id", "lineNo", "originItemId", "productionDate", "qty", "remark", "returnedQty", "skuId") SELECT "batchNo", "bookQty", "createdAt", "destination", "disposition", "documentId", "id", "lineNo", "originItemId", "productionDate", "qty", "remark", "returnedQty", "skuId" FROM "document_items";
DROP TABLE "document_items";
ALTER TABLE "new_document_items" RENAME TO "document_items";
CREATE INDEX "document_items_documentId_idx" ON "document_items"("documentId");
CREATE INDEX "document_items_skuId_idx" ON "document_items"("skuId");
CREATE INDEX "document_items_originItemId_idx" ON "document_items"("originItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
