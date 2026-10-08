-- Número de venta correlativo por empresa (1, 2, 3...). Lo asigna un trigger al insertar,
-- así vale para todas las ventas (POS y marketplaces) sin tocar cada punto de creación.
ALTER TABLE "sales" ADD COLUMN "saleNumber" INTEGER;

-- Ventas existentes: numeradas por empresa en orden de creación.
UPDATE "sales" s SET "saleNumber" = n.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", id) AS rn
  FROM "sales"
) n
WHERE s.id = n.id;

CREATE OR REPLACE FUNCTION assign_sale_number() RETURNS trigger AS $$
BEGIN
  IF NEW."saleNumber" IS NULL THEN
    -- Bloqueo por empresa para que dos ventas simultáneas no obtengan el mismo número.
    PERFORM pg_advisory_xact_lock(hashtext('sale_number:' || NEW."companyId"));
    SELECT COALESCE(MAX("saleNumber"), 0) + 1 INTO NEW."saleNumber"
    FROM "sales" WHERE "companyId" = NEW."companyId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_assign_number
  BEFORE INSERT ON "sales"
  FOR EACH ROW EXECUTE FUNCTION assign_sale_number();

CREATE UNIQUE INDEX "sales_companyId_saleNumber_key" ON "sales"("companyId", "saleNumber");
