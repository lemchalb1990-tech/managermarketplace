-- Integraciones con couriers (Chilexpress, Starken, Blue Express).
ALTER TYPE "OrderEventSource" ADD VALUE IF NOT EXISTS 'COURIER';

CREATE TYPE "CourierProvider" AS ENUM ('CHILEXPRESS', 'STARKEN', 'BLUEXPRESS');
CREATE TYPE "CourierShipmentStatus" AS ENUM ('CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED');

CREATE TABLE "courier_connections" (
    "id" TEXT NOT NULL,
    "provider" "CourierProvider" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "credentials" JSONB,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "courier_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "courier_connections_companyId_provider_key" ON "courier_connections"("companyId", "provider");
ALTER TABLE "courier_connections" ADD CONSTRAINT "courier_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "courier_shipments" (
    "id" TEXT NOT NULL,
    "provider" "CourierProvider" NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "serviceName" TEXT,
    "price" DECIMAL(10,2),
    "labelUrl" TEXT,
    "status" "CourierShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "statusText" TEXT,
    "events" JSONB,
    "weight" DECIMAL(8,2),
    "lastSyncAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "courier_shipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "courier_shipments_provider_trackingNumber_key" ON "courier_shipments"("provider", "trackingNumber");
CREATE INDEX "courier_shipments_companyId_status_idx" ON "courier_shipments"("companyId", "status");
CREATE INDEX "courier_shipments_orderId_idx" ON "courier_shipments"("orderId");
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "courier_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
