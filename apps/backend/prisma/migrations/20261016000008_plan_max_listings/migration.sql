-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "extraListings" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "maxListings" INTEGER;


-- Límite inicial de publicaciones: el doble de los productos del plan (sin límite si el plan no limita productos).
UPDATE "subscription_plans" SET "maxListings" = "maxProducts" * 2 WHERE "maxProducts" IS NOT NULL;
