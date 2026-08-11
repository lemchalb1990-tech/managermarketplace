-- AlterTable invoices: registro de pago (método y N° de referencia, ej. N° transferencia/cheque)
ALTER TABLE "invoices" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "invoices" ADD COLUMN "paymentReference" TEXT;
