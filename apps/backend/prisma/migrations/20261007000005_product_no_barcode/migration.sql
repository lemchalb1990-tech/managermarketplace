-- "No tiene código de barras": desactiva el campo GTIN/EAN del producto y al publicar en
-- Mercado Libre se declara EMPTY_GTIN_REASON. Se marca en los productos que ya lo declaraban.
ALTER TABLE "products" ADD COLUMN "noBarcode" BOOLEAN NOT NULL DEFAULT false;

UPDATE "products" p SET "noBarcode" = true
WHERE coalesce(p."barcode", '') = ''
  AND jsonb_typeof(p."mlAttributes"::jsonb) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(p."mlAttributes"::jsonb) a WHERE a->>'id' = 'EMPTY_GTIN_REASON');
