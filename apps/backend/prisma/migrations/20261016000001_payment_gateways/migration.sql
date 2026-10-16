-- Pasarelas de pago (Flow, Mercado Pago) para cobrar con link o QR desde el punto de venta.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'FLOW';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MERCADO_PAGO';

CREATE TYPE "PaymentProvider" AS ENUM ('FLOW', 'MERCADO_PAGO');
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED');

CREATE TABLE "payment_connections" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "credentials" JSONB,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "payment_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_connections_companyId_provider_key" ON "payment_connections"("companyId", "provider");
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "subject" TEXT NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "saleData" JSONB NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "paymentUrl" TEXT,
    "providerRef" TEXT,
    "providerPaymentId" TEXT,
    "paymentMethodName" TEXT,
    "fee" DECIMAL(12,2),
    "statusDetail" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "saleId" TEXT,
    "workOrderId" TEXT,
    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_requests_saleId_key" ON "payment_requests"("saleId");
CREATE INDEX "payment_requests_companyId_status_createdAt_idx" ON "payment_requests"("companyId", "status", "createdAt");
CREATE INDEX "payment_requests_status_expiresAt_idx" ON "payment_requests"("status", "expiresAt");
CREATE INDEX "payment_requests_workOrderId_idx" ON "payment_requests"("workOrderId");
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "payment_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
