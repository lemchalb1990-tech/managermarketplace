-- Planes de IA por empresa y registro de consumo (revisión y corrección de fotos).
CREATE TABLE "ai_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dailyCredits" INTEGER,
    "monthlyCredits" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_plans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "companies" ADD COLUMN "aiPlanId" TEXT;
ALTER TABLE "companies" ADD CONSTRAINT "companies_aiPlanId_fkey" FOREIGN KEY ("aiPlanId") REFERENCES "ai_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_usages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_usages_companyId_createdAt_idx" ON "ai_usages"("companyId", "createdAt");
ALTER TABLE "ai_usages" ADD CONSTRAINT "ai_usages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
