-- Cuenta de Mercado Libre autorizada en cada conexión.
ALTER TABLE "marketplace_connections" ADD COLUMN "mlUserId" TEXT;
ALTER TABLE "marketplace_connections" ADD COLUMN "mlNickname" TEXT;
