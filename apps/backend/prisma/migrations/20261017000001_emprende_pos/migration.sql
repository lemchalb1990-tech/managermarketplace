-- El plan Emprende incluye Punto de venta.
UPDATE "subscription_plans" SET "features" = array_append("features", 'POS')
WHERE "id" = 'plan_emprende' AND NOT ('POS' = ANY("features"));
