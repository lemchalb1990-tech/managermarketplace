-- "Sincronización con marketplaces" pasa a ser un solo interruptor por empresa (autoSyncSales):
-- activo = sincroniza stock y trae ventas, preguntas, reclamos y estados de TODOS sus
-- marketplaces conectados. Se conserva el comportamiento actual: queda activo en las empresas
-- que ya tenían alguna plataforma marcada. Las empresas nuevas lo traen activo.
UPDATE "companies"
SET "autoSyncSales" = (jsonb_typeof("autoSyncSalesPlatforms") = 'array' AND jsonb_array_length("autoSyncSalesPlatforms") > 0)
WHERE "autoSyncSalesPlatforms" IS NOT NULL;

ALTER TABLE "companies" ALTER COLUMN "autoSyncSales" SET DEFAULT true;
