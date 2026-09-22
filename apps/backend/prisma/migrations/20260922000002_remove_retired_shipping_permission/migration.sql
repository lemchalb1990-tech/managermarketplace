-- El módulo de Envíos se eliminó: su permiso 'shipping' ya no existe en el catálogo
-- y hacía fallar el guardado de los perfiles que lo seguían teniendo.
UPDATE "access_profiles" SET "permissions" = array_remove("permissions", 'shipping') WHERE 'shipping' = ANY("permissions");
