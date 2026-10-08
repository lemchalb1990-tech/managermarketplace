-- Planes comerciales (editables por el Super Admin) y plan de cada empresa.
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" INTEGER,
    "annualPrice" INTEGER,
    "priceFrom" BOOLEAN NOT NULL DEFAULT false,
    "implementationPrice" INTEGER,
    "implementationFreeAnnual" BOOLEAN NOT NULL DEFAULT false,
    "maxChannels" INTEGER,
    "maxProducts" INTEGER,
    "maxUsers" INTEGER,
    "maxWarehouses" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addons" TEXT,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "trialDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "companies" ADD COLUMN "subscriptionPlanId" TEXT;
ALTER TABLE "companies" ADD COLUMN "subscriptionBilling" TEXT;
ALTER TABLE "companies" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD CONSTRAINT "companies_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Planes de la propuesta comercial (valores mensuales en CLP + IVA). El Demo es igual a Crece
-- por 15 días.
INSERT INTO "subscription_plans" ("id", "name", "description", "monthlyPrice", "annualPrice", "priceFrom", "implementationPrice", "implementationFreeAnnual", "maxChannels", "maxProducts", "maxUsers", "maxWarehouses", "features", "addons", "isTrial", "trialDays", "sortOrder", "updatedAt") VALUES
  ('plan_demo', 'Demo', 'Prueba gratis 15 días con todo lo de Crece.', 0, NULL, false, NULL, false, 5, 5000, 5, 3, ARRAY['POS', 'PURCHASES']::TEXT[], NULL, true, 15, 0, CURRENT_TIMESTAMP),
  ('plan_emprende', 'Emprende', 'Para partir vendiendo en pocos canales.', 79000, 790000, false, 120000, true, 2, 1000, 2, 1, ARRAY[]::TEXT[], NULL, false, NULL, 1, CURRENT_TIMESTAMP),
  ('plan_crece', 'Crece', 'Tiendas multicanal en crecimiento.', 179000, 1790000, false, 290000, false, 5, 5000, 5, 3, ARRAY['POS', 'PURCHASES']::TEXT[], NULL, false, NULL, 2, CURRENT_TIMESTAMP),
  ('plan_escala', 'Escala', 'Operación grande con bodega y despacho.', 349000, 3490000, false, 490000, false, 10, 20000, 15, NULL, ARRAY['POS', 'PURCHASES', 'PICKING']::TEXT[], '1 a elección', false, NULL, 3, CURRENT_TIMESTAMP),
  ('plan_corporativo', 'Corporativo', 'A medida, sin límites y multiempresa.', 590000, NULL, true, NULL, false, NULL, NULL, NULL, NULL, ARRAY['POS', 'PURCHASES', 'PICKING', 'MULTICOMPANY']::TEXT[], 'Todos', false, NULL, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
