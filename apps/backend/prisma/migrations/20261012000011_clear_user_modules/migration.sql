-- Los módulos ya no se asignan por usuario: los define la empresa (y el perfil de acceso lo que ve cada uno).
-- Se limpian las restricciones antiguas por usuario para que no queden ocultas sin forma de editarlas.
UPDATE "users" SET "modules" = NULL WHERE "modules" IS NOT NULL;
