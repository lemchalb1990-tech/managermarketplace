-- Registro de correos enviados (90 días) y textos editables de los correos de la plataforma.
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "companyId" TEXT,
    "toEmail" TEXT NOT NULL,
    "fromEmail" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "html" TEXT,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggeredById" TEXT,
    "triggeredByName" TEXT,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_logs_createdAt_idx" ON "email_logs"("createdAt");
CREATE INDEX "email_logs_companyId_createdAt_idx" ON "email_logs"("companyId", "createdAt");
CREATE INDEX "email_logs_status_createdAt_idx" ON "email_logs"("status", "createdAt");

CREATE TABLE "platform_email_templates" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,
    CONSTRAINT "platform_email_templates_pkey" PRIMARY KEY ("key")
);
