-- Productos incluidos en cada plan (diagnóstico de ML, revisión con IA, corrección con IA).
-- Los planes existentes conservan todo lo que ya tenían.
ALTER TABLE "ai_plans" ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY['ML_DIAGNOSTIC', 'AI_CHECK', 'AI_FIX']::TEXT[];

-- Planes sugeridos (se pueden editar o eliminar). Sin límite de créditos hasta que el Super
-- Admin los defina.
INSERT INTO "ai_plans" ("id", "name", "dailyCredits", "monthlyCredits", "features", "updatedAt") VALUES
  ('plan_solo_diagnostico_ml', 'Solo diagnóstico ML', NULL, NULL, ARRAY['ML_DIAGNOSTIC']::TEXT[], CURRENT_TIMESTAMP),
  ('plan_correccion', 'Corrección', NULL, NULL, ARRAY['AI_FIX']::TEXT[], CURRENT_TIMESTAMP),
  ('plan_imagenes_referencia', 'Imágenes de referencia', NULL, NULL, ARRAY['AI_GENERATE']::TEXT[], CURRENT_TIMESTAMP),
  ('plan_diagnostico_correccion', 'Diagnóstico ML + corrección', NULL, NULL, ARRAY['ML_DIAGNOSTIC', 'AI_FIX']::TEXT[], CURRENT_TIMESTAMP),
  ('plan_todas_las_opciones', 'Todas las opciones', NULL, NULL, ARRAY['ML_DIAGNOSTIC', 'AI_CHECK', 'AI_FIX', 'AI_GENERATE']::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
