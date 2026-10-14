-- Permisos de nombre y tipo del producto: todos reciben "ver"; los perfiles con Catálogo, también "modificar".
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.name.view','product.type.view']::text[]))
WHERE NOT ('*' = ANY("permissions"));

UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.name.edit','product.type.edit']::text[]))
WHERE 'catalog' = ANY("permissions") AND NOT ('*' = ANY("permissions"));
