-- Permisos de crear productos y activarlos/desactivarlos: los perfiles con Catálogo los reciben.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.create','product.activate']::text[]))
WHERE 'catalog' = ANY("permissions") AND NOT ('*' = ANY("permissions"));
