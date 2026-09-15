-- Conector autenticado (login + token) además del feed URL simple ya soportado.
-- Los proveedores existentes quedan como FEED (mismo comportamiento de hoy).
CREATE TYPE "DropshipConnectorType" AS ENUM ('FEED', 'NORIEGA_API');

ALTER TABLE "dropship_suppliers"
  ADD COLUMN "connectorType" "DropshipConnectorType" NOT NULL DEFAULT 'FEED',
  ADD COLUMN "credentials" JSONB,
  ADD COLUMN "apiToken" TEXT,
  ADD COLUMN "apiTokenExpiresAt" TIMESTAMP(3);
