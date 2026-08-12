-- CreateEnum
CREATE TYPE "ProfitabilityStatus" AS ENUM ('CONFIRMADO', 'DUDOSO', 'RECHAZADO', 'NO_VERIFICADO');

-- CreateTable
CREATE TABLE "profitability_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,
    "competitorName" TEXT,
    "competitorPrice" DECIMAL(10,2),
    "competitorUrl" TEXT,
    "myDimensions" TEXT,
    "competitorDimensions" TEXT,
    "status" "ProfitabilityStatus" NOT NULL DEFAULT 'NO_VERIFICADO',
    "note" TEXT,
    "myPrice" DECIMAL(10,2),
    "manualPrice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "profitability_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profitability_items_name_companyId_key" ON "profitability_items"("name", "companyId");

-- AddForeignKey
ALTER TABLE "profitability_items" ADD CONSTRAINT "profitability_items_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
