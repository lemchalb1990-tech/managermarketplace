-- CreateEnum
CREATE TYPE "OrderEventSource" AS ENUM ('MANUAL', 'SYSTEM', 'MERCADO_LIBRE');

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus",
    "source" "OrderEventSource" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "externalStatus" TEXT,
    "externalSubstatus" TEXT,
    "externalKey" TEXT,
    "actorName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_status_events_orderId_externalKey_key" ON "order_status_events"("orderId", "externalKey");

-- CreateIndex
CREATE INDEX "order_status_events_orderId_occurredAt_idx" ON "order_status_events"("orderId", "occurredAt");

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
