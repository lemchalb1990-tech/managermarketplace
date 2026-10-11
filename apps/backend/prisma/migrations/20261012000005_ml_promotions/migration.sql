-- Promociones de Mercado Libre: campañas, estado por publicación, aplicaciones masivas y reglas que sugieren.
-- CreateTable
CREATE TABLE "ml_promotions" (
    "id" TEXT NOT NULL,
    "mlId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subType" TEXT,
    "status" TEXT NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "deadlineDate" TIMESTAMP(3),
    "benefits" JSONB,
    "createdByUs" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "itemsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "ml_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_promotion_items" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "promoKey" TEXT NOT NULL,
    "promotionMlId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "offerId" TEXT,
    "price" DECIMAL(12,2),
    "originalPrice" DECIMAL(12,2),
    "topPrice" DECIMAL(12,2),
    "minPrice" DECIMAL(12,2),
    "maxPrice" DECIMAL(12,2),
    "suggestedPrice" DECIMAL(12,2),
    "meliPct" DECIMAL(7,3),
    "sellerPct" DECIMAL(7,3),
    "stockMin" INTEGER,
    "stockMax" INTEGER,
    "boosted" BOOLEAN NOT NULL DEFAULT false,
    "boostedPrice" DECIMAL(12,2),
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "ml_promotion_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_item_infos" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT,
    "thumbnail" TEXT,
    "permalink" TEXT,
    "categoryId" TEXT,
    "listingTypeId" TEXT,
    "status" TEXT,
    "price" DECIMAL(12,2),
    "stock" INTEGER,
    "feePct" DECIMAL(7,3),
    "feeFixed" DECIMAL(12,2),
    "infoSyncedAt" TIMESTAMP(3),
    "promosSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "ml_item_infos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_promotion_jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "title" TEXT NOT NULL,
    "type" TEXT,
    "promotionMlId" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "ml_promotion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_promotion_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL,
    "connectionId" TEXT,
    "config" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "ml_promotion_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_promotion_suggestions" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "itemId" TEXT NOT NULL,
    "promoKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "promotionMlId" TEXT,
    "offerId" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2) NOT NULL,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "profit" DECIMAL(12,2),
    "marginPct" DECIMAL(7,2),
    "reason" TEXT NOT NULL,
    "error" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ruleId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "ml_promotion_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ml_promotions_companyId_status_idx" ON "ml_promotions"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ml_promotions_connectionId_mlId_key" ON "ml_promotions"("connectionId", "mlId");

-- CreateIndex
CREATE INDEX "ml_promotion_items_companyId_status_idx" ON "ml_promotion_items"("companyId", "status");

-- CreateIndex
CREATE INDEX "ml_promotion_items_connectionId_promoKey_status_idx" ON "ml_promotion_items"("connectionId", "promoKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ml_promotion_items_connectionId_itemId_promoKey_key" ON "ml_promotion_items"("connectionId", "itemId", "promoKey");

-- CreateIndex
CREATE INDEX "ml_item_infos_connectionId_promosSyncedAt_idx" ON "ml_item_infos"("connectionId", "promosSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ml_item_infos_connectionId_itemId_key" ON "ml_item_infos"("connectionId", "itemId");

-- CreateIndex
CREATE INDEX "ml_promotion_jobs_companyId_createdAt_idx" ON "ml_promotion_jobs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ml_promotion_rules_companyId_active_idx" ON "ml_promotion_rules"("companyId", "active");

-- CreateIndex
CREATE INDEX "ml_promotion_suggestions_companyId_status_idx" ON "ml_promotion_suggestions"("companyId", "status");

-- CreateIndex
CREATE INDEX "ml_promotion_suggestions_ruleId_itemId_promoKey_status_idx" ON "ml_promotion_suggestions"("ruleId", "itemId", "promoKey", "status");

-- AddForeignKey
ALTER TABLE "ml_promotions" ADD CONSTRAINT "ml_promotions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotions" ADD CONSTRAINT "ml_promotions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_items" ADD CONSTRAINT "ml_promotion_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_items" ADD CONSTRAINT "ml_promotion_items_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_item_infos" ADD CONSTRAINT "ml_item_infos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_item_infos" ADD CONSTRAINT "ml_item_infos_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_jobs" ADD CONSTRAINT "ml_promotion_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_jobs" ADD CONSTRAINT "ml_promotion_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_rules" ADD CONSTRAINT "ml_promotion_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_suggestions" ADD CONSTRAINT "ml_promotion_suggestions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ml_promotion_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_suggestions" ADD CONSTRAINT "ml_promotion_suggestions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_promotion_suggestions" ADD CONSTRAINT "ml_promotion_suggestions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Función del plan comercial: incluida desde Crece (y en la Demo, que trae lo de Crece).
UPDATE "subscription_plans" SET "features" = array_append("features", 'ML_PROMOTIONS')
WHERE "id" IN ('plan_demo', 'plan_crece', 'plan_escala', 'plan_corporativo') AND NOT ('ML_PROMOTIONS' = ANY("features"));
