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
    "submittedAt" DATETIME,
    "submittedById" TEXT,
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
    CONSTRAINT "documents_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_originDocumentId_fkey" FOREIGN KEY ("originDocumentId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("approvedAt", "approvedById", "bizDate", "createdAt", "createdById", "docNo", "externalNo", "id", "itemCount", "locationId", "originDocumentId", "receiverName", "remark", "snapshotAt", "status", "totalQty", "trackingNo", "type", "updatedAt", "voidReason", "voidedAt", "voidedById") SELECT "approvedAt", "approvedById", "bizDate", "createdAt", "createdById", "docNo", "externalNo", "id", "itemCount", "locationId", "originDocumentId", "receiverName", "remark", "snapshotAt", "status", "totalQty", "trackingNo", "type", "updatedAt", "voidReason", "voidedAt", "voidedById" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE UNIQUE INDEX "documents_docNo_key" ON "documents"("docNo");
CREATE INDEX "documents_type_status_idx" ON "documents"("type", "status");
CREATE INDEX "documents_bizDate_idx" ON "documents"("bizDate");
CREATE INDEX "documents_externalNo_idx" ON "documents"("externalNo");
CREATE INDEX "documents_originDocumentId_idx" ON "documents"("originDocumentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
