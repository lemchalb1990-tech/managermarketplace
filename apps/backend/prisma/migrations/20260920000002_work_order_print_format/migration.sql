-- Cada empresa elige si sus órdenes de trabajo se imprimen en hoja carta o en ticket
-- (impresora térmica).
CREATE TYPE "WorkOrderPrintFormat" AS ENUM ('CARTA', 'TICKET');

ALTER TABLE "companies"
  ADD COLUMN "workOrderPrintFormat" "WorkOrderPrintFormat" NOT NULL DEFAULT 'CARTA';
