-- Cierre de caja formal del punto de venta.
CREATE TABLE "cash_closures" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "cashierId" TEXT,
    "closedById" TEXT,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "salesCount" INTEGER NOT NULL,
    "itemsCount" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "openingCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "countedCash" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_closures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cash_closures_companyId_number_key" ON "cash_closures"("companyId", "number");
CREATE INDEX "cash_closures_companyId_cashierId_periodTo_idx" ON "cash_closures"("companyId", "cashierId", "periodTo");
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
