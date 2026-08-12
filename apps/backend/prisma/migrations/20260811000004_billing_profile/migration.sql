-- CreateTable
CREATE TABLE "billing_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "razonSocial" TEXT,
    "rut" TEXT,
    "giro" TEXT,
    "address" TEXT,
    "commune" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "resolutionNumber" TEXT,
    "resolutionDate" TIMESTAMP(3),
    "footerText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_companyId_key" ON "billing_profiles"("companyId");

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
