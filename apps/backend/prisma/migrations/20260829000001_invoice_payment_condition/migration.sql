-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PaymentCondition" AS ENUM ('CONTADO', 'CREDITO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable invoices: condición de pago del DTE (contado/crédito) y vencimiento para crédito
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paymentCondition" "PaymentCondition";
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
