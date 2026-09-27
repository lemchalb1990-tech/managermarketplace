-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "marketplaceSentAt" TIMESTAMP(3),
ADD COLUMN "marketplaceError" TEXT;
