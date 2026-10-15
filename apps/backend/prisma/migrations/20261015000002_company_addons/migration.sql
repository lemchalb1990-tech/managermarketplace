-- Adicionales sobre el plan comercial por empresa: cantidades extra de cada recurso,
-- funciones extra, precio mensual acordado y nota.
ALTER TABLE "companies" ADD COLUMN "extraChannels" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "extraProducts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "extraUsers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "extraWarehouses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "extraFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "companies" ADD COLUMN "addonsMonthlyPrice" INTEGER;
ALTER TABLE "companies" ADD COLUMN "addonsNote" TEXT;
