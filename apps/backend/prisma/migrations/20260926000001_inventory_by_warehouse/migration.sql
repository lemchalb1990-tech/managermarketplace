-- Motor de inventario por bodega: kardex en stock_movements y documentos de traspaso.
ALTER TABLE "stock_movements" ADD COLUMN "balanceAfter" INTEGER;
ALTER TABLE "stock_movements" ADD COLUMN "referenceType" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "referenceId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "documentNumber" TEXT;
CREATE INDEX "stock_movements_productId_warehouseId_createdAt_idx" ON "stock_movements"("productId", "warehouseId", "createdAt");
CREATE INDEX "stock_movements_warehouseId_createdAt_idx" ON "stock_movements"("warehouseId", "createdAt");

CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'RECEIVED_WITH_DIFF', 'CANCELLED');

CREATE TABLE "transfer_documents" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "legacyTransferId" TEXT,
    "companyId" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "createdById" TEXT,
    "dispatchedById" TEXT,
    "receivedById" TEXT,
    "cancelledById" TEXT,
    CONSTRAINT "transfer_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transfer_documents_legacyTransferId_key" ON "transfer_documents"("legacyTransferId");
CREATE UNIQUE INDEX "transfer_documents_companyId_number_key" ON "transfer_documents"("companyId", "number");
CREATE INDEX "transfer_documents_companyId_status_idx" ON "transfer_documents"("companyId", "status");
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "transfer_document_lines" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER,
    "unitCost" DECIMAL(10,2),
    "documentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "transfer_document_lines_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "transfer_document_lines" ADD CONSTRAINT "transfer_document_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "transfer_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_document_lines" ADD CONSTRAINT "transfer_document_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
