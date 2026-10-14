-- Permisos por campo del producto. Para que ningún perfil existente pierda acceso:
-- todos reciben "ver"; los que tienen Catálogo reciben también "modificar"; los que
-- hacen ajustes de inventario reciben ver/modificar stock.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.cost.view','product.stock.view','product.sku.view','product.criticalStock.view','product.warehouse.view','product.description.view','product.price.view','product.category.view','product.images.view']::text[]))
WHERE NOT ('*' = ANY("permissions"));

UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.cost.edit','product.stock.edit','product.sku.edit','product.criticalStock.edit','product.warehouse.edit','product.description.edit','product.price.edit','product.category.edit','product.images.edit']::text[]))
WHERE 'catalog' = ANY("permissions") AND NOT ('*' = ANY("permissions"));

UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.stock.view','product.stock.edit']::text[]))
WHERE 'inventory.adjust' = ANY("permissions") AND NOT ('*' = ANY("permissions"));
