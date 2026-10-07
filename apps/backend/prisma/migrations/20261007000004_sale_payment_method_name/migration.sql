-- Método de pago informado por el marketplace (p. ej. "Mercado Pago", "Tarjeta de crédito (visa)").
ALTER TABLE "sales" ADD COLUMN "paymentMethodName" TEXT;
