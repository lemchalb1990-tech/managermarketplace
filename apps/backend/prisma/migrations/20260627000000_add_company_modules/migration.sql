-- AlterTable
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "modules" JSONB;
