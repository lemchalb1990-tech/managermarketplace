-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "closureMeta" JSONB,
ADD COLUMN     "closureReason" TEXT,
ADD COLUMN     "closureRequestedAt" TIMESTAMP(3),
ADD COLUMN     "closureRequestedById" TEXT,
ADD COLUMN     "closureScheduledFor" TIMESTAMP(3);

