-- Varias publicaciones del mismo producto en una misma cuenta: slot (0 = principal) y precio propio por publicación.
ALTER TABLE "listings" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "listings" ADD COLUMN "price" DECIMAL(10,2);

-- La tabla es anterior a las migraciones: se elimina la unicidad (productId, connectionId) sin
-- depender del nombre (restricción o índice único sobre exactamente esas dos columnas).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname AS name
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    WHERE t.relname = 'listings' AND con.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
           WHERE a.attrelid = t.oid AND a.attnum = ANY(con.conkey)) = ARRAY['connectionId','productId']
  LOOP
    EXECUTE format('ALTER TABLE "listings" DROP CONSTRAINT %I', r.name);
  END LOOP;
  FOR r IN
    SELECT i.relname AS name
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'listings' AND x.indisunique AND NOT x.indisprimary
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
           WHERE a.attrelid = t.oid AND a.attnum = ANY(x.indkey)) = ARRAY['connectionId','productId']
  LOOP
    EXECUTE format('DROP INDEX %I', r.name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX "listings_productId_connectionId_slot_key" ON "listings"("productId", "connectionId", "slot");
CREATE INDEX "listings_productId_connectionId_idx" ON "listings"("productId", "connectionId");
