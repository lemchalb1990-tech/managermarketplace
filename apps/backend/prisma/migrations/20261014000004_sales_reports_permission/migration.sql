-- Permiso «Reportes de ventas»: lo reciben los perfiles asignados a administradores de empresa.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['sales.reports']::text[]))
WHERE NOT ('*' = ANY("permissions"))
  AND "id" IN (SELECT "accessProfileId" FROM "users" WHERE "role" = 'COMPANY_ADMIN' AND "accessProfileId" IS NOT NULL);
