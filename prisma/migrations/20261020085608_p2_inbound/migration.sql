-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bizDate" DATETIME NOT NULL,
    "locationId" TEXT,
    "originDocumentId" TEXT,
    "remark" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "documents_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_originDocumentId_fkey" FOREIGN KEY ("originDocumentId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "productionDate" DATETIME,
    "batchNo" TEXT,
    "remark" TEXT,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "productionDate" DATETIME,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batches_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "item_instances" (
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
    CONSTRAINT "item_instances_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_instances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_instances_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "document_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_movements" (
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
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "document_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_docNo_key" ON "documents"("docNo");

-- CreateIndex
CREATE INDEX "documents_type_status_idx" ON "documents"("type", "status");

-- CreateIndex
CREATE INDEX "documents_bizDate_idx" ON "documents"("bizDate");

-- CreateIndex
CREATE INDEX "document_items_documentId_idx" ON "document_items"("documentId");

-- CreateIndex
CREATE INDEX "document_items_skuId_idx" ON "document_items"("skuId");

-- CreateIndex
CREATE INDEX "batches_skuId_productionDate_idx" ON "batches"("skuId", "productionDate");

-- CreateIndex
CREATE UNIQUE INDEX "batches_skuId_batchNo_key" ON "batches"("skuId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "item_instances_code_key" ON "item_instances"("code");

-- CreateIndex
CREATE INDEX "item_instances_skuId_status_idx" ON "item_instances"("skuId", "status");

-- CreateIndex
CREATE INDEX "item_instances_status_idx" ON "item_instances"("status");

-- CreateIndex
CREATE INDEX "item_instances_inboundDocumentId_idx" ON "item_instances"("inboundDocumentId");

-- CreateIndex
CREATE INDEX "stock_movements_skuId_locationId_idx" ON "stock_movements"("skuId", "locationId");

-- CreateIndex
CREATE INDEX "stock_movements_occurredAt_idx" ON "stock_movements"("occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_documentId_idx" ON "stock_movements"("documentId");

-- CreateIndex
CREATE INDEX "stock_movements_bizType_occurredAt_idx" ON "stock_movements"("bizType", "occurredAt");
