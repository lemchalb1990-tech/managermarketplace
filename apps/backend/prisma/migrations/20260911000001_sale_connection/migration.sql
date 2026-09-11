-- Registra de qué cuenta/conexión de marketplace vino cada venta (queda null en POS o
-- ventas manuales), para poder mostrar el canal + la cuenta exacta en el reporte de ventas
-- cuando una empresa tiene varias conexiones del mismo canal (p.ej. dos cuentas de ML).
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "connectionId" TEXT;

ALTER TABLE "sales" ADD CONSTRAINT "sales_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
