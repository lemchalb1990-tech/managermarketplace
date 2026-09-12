-- Módulo Mercado Libre: preguntas, reclamos/devoluciones y calificación de venta.

CREATE TYPE "SaleFeedbackRating" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "mlFeedbackRating" "SaleFeedbackRating";
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "mlFeedbackComment" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "mlFeedbackAt" TIMESTAMP(3);

CREATE TYPE "MlQuestionStatus" AS ENUM ('UNANSWERED', 'ANSWERED', 'CLOSED_UNANSWERED', 'UNDER_REVIEW', 'BANNED', 'DELETED');

CREATE TABLE "ml_questions" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemTitle" TEXT,
    "itemThumbnail" TEXT,
    "text" TEXT NOT NULL,
    "status" "MlQuestionStatus" NOT NULL DEFAULT 'UNANSWERED',
    "answerText" TEXT,
    "answeredAt" TIMESTAMP(3),
    "fromNickname" TEXT,
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "productId" TEXT,

    CONSTRAINT "ml_questions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ml_questions_externalId_key" ON "ml_questions"("externalId");
CREATE INDEX "ml_questions_companyId_status_idx" ON "ml_questions"("companyId", "status");

ALTER TABLE "ml_questions" ADD CONSTRAINT "ml_questions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ml_questions" ADD CONSTRAINT "ml_questions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ml_questions" ADD CONSTRAINT "ml_questions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "MlClaimStatus" AS ENUM ('OPENED', 'CLOSED');

CREATE TABLE "ml_claims" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "MlClaimStatus" NOT NULL DEFAULT 'OPENED',
    "stage" TEXT,
    "reason" TEXT,
    "orderExternalId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "saleId" TEXT,

    CONSTRAINT "ml_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ml_claims_externalId_key" ON "ml_claims"("externalId");
CREATE INDEX "ml_claims_companyId_status_idx" ON "ml_claims"("companyId", "status");

ALTER TABLE "ml_claims" ADD CONSTRAINT "ml_claims_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ml_claims" ADD CONSTRAINT "ml_claims_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ml_claims" ADD CONSTRAINT "ml_claims_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
