-- Permiso "Agregar fotos nuevas": lo reciben los perfiles que ya podían modificar imágenes.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.images.add']::text[]))
WHERE 'product.images.edit' = ANY("permissions") AND NOT ('*' = ANY("permissions"));
