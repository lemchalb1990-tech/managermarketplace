-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "extraStorageMb" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "maxStorageMb" INTEGER;

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");

-- CreateIndex
CREATE INDEX "stored_files_companyId_idx" ON "stored_files"("companyId");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Límite inicial de almacenamiento por plan: Emprende 2 GB, Crece y Demo 10 GB, Escala 50 GB (Corporativo sin límite).
UPDATE "subscription_plans" SET "maxStorageMb" = 2048 WHERE "id" = 'plan_emprende';
UPDATE "subscription_plans" SET "maxStorageMb" = 10240 WHERE "id" IN ('plan_crece', 'plan_demo');
UPDATE "subscription_plans" SET "maxStorageMb" = 51200 WHERE "id" = 'plan_escala';
