-- Ticket angosto de 58 mm (impresoras térmicas chicas). El valor 'TICKET' existente
-- sigue siendo el de 80 mm. El formato aplica a órdenes de trabajo y a la venta directa.
ALTER TYPE "WorkOrderPrintFormat" ADD VALUE IF NOT EXISTS 'TICKET_58';
