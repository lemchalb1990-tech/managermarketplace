-- Módulo de Fabricación: procesos por rubro, áreas, órdenes de fabricación (etapas, bitácora,
-- adjuntos, horas y materiales), lista de materiales, abastecimiento del producto y saldo de ventas con abono.
-- CreateEnum
CREATE TYPE "ProductSupplyMode" AS ENUM ('STOCK', 'MADE_TO_ORDER', 'MADE_FOR_STOCK');

-- CreateEnum
CREATE TYPE "ProductionOrderKind" AS ENUM ('MADE_TO_ORDER', 'FOR_STOCK', 'REPAIR');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'WAITING_APPROVAL', 'ON_HOLD', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'WAITING_APPROVAL', 'DONE', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'PRODUCTION_IN';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'PRODUCTION_OUT';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "productionSettings" JSONB;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "advancePercent" INTEGER,
ADD COLUMN     "manufacturingDays" INTEGER,
ADD COLUMN     "productionProcessId" TEXT,
ADD COLUMN     "requiresProcess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specFields" JSONB,
ADD COLUMN     "supplyMode" "ProductSupplyMode" NOT NULL DEFAULT 'STOCK';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "balanceDue" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "specs" JSONB;

-- AlterTable
ALTER TABLE "sale_payments" ADD COLUMN     "collectedById" TEXT,
ADD COLUMN     "isBalance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "balanceSaleId" TEXT;

-- CreateTable
CREATE TABLE "production_areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourlyCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dailyCapacityHours" DECIMAL(8,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "production_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_processes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isRepair" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "production_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_process_stages" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "estimatedDays" DECIMAL(6,2),
    "estimatedHours" DECIMAL(8,2),
    "checklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT false,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "processId" TEXT NOT NULL,
    "areaId" TEXT,

    CONSTRAINT "production_process_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_materials" (
    "id" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "stageName" TEXT,
    "notes" TEXT,
    "productId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,

    CONSTRAINT "product_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "ProductionOrderKind" NOT NULL DEFAULT 'MADE_TO_ORDER',
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "specs" JSONB,
    "repairInfo" JSONB,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "trackingToken" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "materialsCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warrantyReason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT,
    "processId" TEXT,
    "saleId" TEXT,
    "saleItemId" TEXT,
    "clientId" TEXT,
    "warehouseId" TEXT,
    "assignedToId" TEXT,
    "reopenedFromId" TEXT,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_stages" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProductionStageStatus" NOT NULL DEFAULT 'PENDING',
    "estimatedDays" DECIMAL(6,2),
    "estimatedHours" DECIMAL(8,2),
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT false,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "checklist" JSONB,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "approvalStatus" TEXT,
    "approvalNote" TEXT,
    "approvalAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "orderId" TEXT NOT NULL,
    "areaId" TEXT,

    CONSTRAINT "production_order_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stageName" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "production_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_attachments" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "stageName" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "production_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_time_entries" (
    "id" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "hourlyCost" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "stageName" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "workDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "production_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_material_uses" (
    "id" TEXT NOT NULL,
    "plannedQty" DECIMAL(12,3) NOT NULL,
    "reservedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "consumedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stageName" TEXT,
    "warehouseId" TEXT,
    "orderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,

    CONSTRAINT "production_material_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_areas_companyId_name_key" ON "production_areas"("companyId", "name");

-- CreateIndex
CREATE INDEX "production_process_stages_processId_position_idx" ON "production_process_stages"("processId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_materials_productId_materialId_key" ON "product_materials"("productId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_trackingToken_key" ON "production_orders"("trackingToken");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_saleItemId_key" ON "production_orders"("saleItemId");

-- CreateIndex
CREATE INDEX "production_orders_companyId_status_idx" ON "production_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "production_orders_companyId_dueDate_idx" ON "production_orders"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "production_orders_saleId_idx" ON "production_orders"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_companyId_number_key" ON "production_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "production_order_stages_orderId_position_idx" ON "production_order_stages"("orderId", "position");

-- CreateIndex
CREATE INDEX "production_order_stages_assignedToId_status_idx" ON "production_order_stages"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "production_events_orderId_createdAt_idx" ON "production_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "production_events_notifyCustomer_notifiedAt_idx" ON "production_events"("notifyCustomer", "notifiedAt");

-- CreateIndex
CREATE INDEX "production_attachments_orderId_idx" ON "production_attachments"("orderId");

-- CreateIndex
CREATE INDEX "production_time_entries_orderId_idx" ON "production_time_entries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "production_material_uses_orderId_materialId_key" ON "production_material_uses"("orderId", "materialId");

-- CreateIndex
CREATE INDEX "sale_payments_collectedById_createdAt_idx" ON "sale_payments"("collectedById", "createdAt");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_productionProcessId_fkey" FOREIGN KEY ("productionProcessId") REFERENCES "production_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_areas" ADD CONSTRAINT "production_areas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_process_stages" ADD CONSTRAINT "production_process_stages_processId_fkey" FOREIGN KEY ("processId") REFERENCES "production_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_process_stages" ADD CONSTRAINT "production_process_stages_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "production_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_materials" ADD CONSTRAINT "product_materials_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_materials" ADD CONSTRAINT "product_materials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_processId_fkey" FOREIGN KEY ("processId") REFERENCES "production_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_reopenedFromId_fkey" FOREIGN KEY ("reopenedFromId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stages" ADD CONSTRAINT "production_order_stages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stages" ADD CONSTRAINT "production_order_stages_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "production_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_events" ADD CONSTRAINT "production_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_attachments" ADD CONSTRAINT "production_attachments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_time_entries" ADD CONSTRAINT "production_time_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_uses" ADD CONSTRAINT "production_material_uses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_uses" ADD CONSTRAINT "production_material_uses_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

