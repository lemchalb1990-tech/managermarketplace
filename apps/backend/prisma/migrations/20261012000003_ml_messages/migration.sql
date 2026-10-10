-- Mensajería postventa de Mercado Libre: conversaciones y mensajes programados.
CREATE TABLE "ml_conversations" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "buyerId" TEXT,
    "buyerName" TEXT,
    "lastText" TEXT,
    "lastFrom" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "unread" INTEGER NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "messages" JSONB,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "saleId" TEXT,
    CONSTRAINT "ml_conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ml_conversations_connectionId_packId_key" ON "ml_conversations"("connectionId", "packId");
CREATE INDEX "ml_conversations_companyId_lastMessageAt_idx" ON "ml_conversations"("companyId", "lastMessageAt");
ALTER TABLE "ml_conversations" ADD CONSTRAINT "ml_conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ml_conversations" ADD CONSTRAINT "ml_conversations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ml_conversations" ADD CONSTRAINT "ml_conversations_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ml_message_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "connectionId" TEXT,
    "minTotal" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "ml_message_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ml_message_rules_companyId_active_idx" ON "ml_message_rules"("companyId", "active");
ALTER TABLE "ml_message_rules" ADD CONSTRAINT "ml_message_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ml_message_logs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    CONSTRAINT "ml_message_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ml_message_logs_ruleId_saleId_key" ON "ml_message_logs"("ruleId", "saleId");
ALTER TABLE "ml_message_logs" ADD CONSTRAINT "ml_message_logs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ml_message_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ml_message_logs" ADD CONSTRAINT "ml_message_logs_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
