-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "autoSyncSales" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "marketplace_connections" ADD COLUMN     "lastSalesImportAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "sales_channel_externalId_key" ON "sales"("channel", "externalId");
