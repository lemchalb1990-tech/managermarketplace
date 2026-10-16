-- AlterTable
ALTER TABLE "email_templates" ADD COLUMN     "blocks" JSONB;

-- CreateTable
CREATE TABLE "email_brands" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1d4ed8',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "footerText" TEXT,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_brands_companyId_key" ON "email_brands"("companyId");

-- AddForeignKey
ALTER TABLE "email_brands" ADD CONSTRAINT "email_brands_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

