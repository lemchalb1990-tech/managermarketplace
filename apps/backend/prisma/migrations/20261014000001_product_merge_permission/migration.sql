-- Permiso «Unificar productos duplicados»: antes unificar era solo del administrador de empresa,
-- así que lo reciben los perfiles asignados a algún administrador de empresa.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['product.merge']::text[]))
WHERE NOT ('*' = ANY("permissions"))
  AND "id" IN (SELECT "accessProfileId" FROM "users" WHERE "role" = 'COMPANY_ADMIN' AND "accessProfileId" IS NOT NULL);
