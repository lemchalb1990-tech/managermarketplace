-- Formato de impresión predeterminado por usuario (configuración de ticket). Si es NULL se
-- usa el formato de la empresa.
ALTER TABLE "users" ADD COLUMN "ticketFormat" "WorkOrderPrintFormat";
