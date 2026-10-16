-- Visibilidad de cada sincronizador: PUBLIC (landing y clientes), INTERNAL (solo clientes) o
-- RESERVED (solo las empresas elegidas por el Super Admin). Null = PUBLIC.
ALTER TABLE "platform_settings" ADD COLUMN "visibility" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "allowedCompanyIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
