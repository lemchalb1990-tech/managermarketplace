-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ORDER_MANAGER';
ALTER TYPE "SaleChannel" ADD VALUE IF NOT EXISTS 'ORDER_REQUEST';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OrderRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable invoices: cuentas por cobrar
ALTER TABLE "invoices" ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "clientId" TEXT;

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rut" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "commune" TEXT,
    "city" TEXT,
    "creditLimit" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_requests" (
    "id" TEXT NOT NULL,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledDispatchDate" TIMESTAMP(3),
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "saleId" TEXT,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderRequestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "order_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_saleId_key" ON "order_requests"("saleId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_orderRequestId_fkey"
    FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
