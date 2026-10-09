-- Orden manual de los planes de IA. Se parte del orden alfabético que tenían.
ALTER TABLE "ai_plans" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
UPDATE "ai_plans" p SET "sortOrder" = o.rn
FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn FROM "ai_plans") o
WHERE o.id = p.id;
