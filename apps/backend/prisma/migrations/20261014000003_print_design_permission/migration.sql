-- Permiso «Diseño de documentos»: lo reciben los perfiles asignados a administradores de empresa
-- (antes el diseño era solo de administradores), para que nadie pierda el acceso.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['print.design']::text[]))
WHERE NOT ('*' = ANY("permissions"))
  AND "id" IN (SELECT "accessProfileId" FROM "users" WHERE "role" = 'COMPANY_ADMIN' AND "accessProfileId" IS NOT NULL);
