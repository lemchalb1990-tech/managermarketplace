-- Verificador de órdenes: corridas e incidencias (incluye las ventas captadas).
-- CreateTable
CREATE TABLE "order_audit_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "windowFrom" TIMESTAMP(3) NOT NULL,
    "connections" INTEGER NOT NULL DEFAULT 0,
    "ordersChecked" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "statusFixed" INTEGER NOT NULL DEFAULT 0,
    "newIssues" INTEGER NOT NULL DEFAULT 0,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "createdByName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "order_audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_audit_issues" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "channel" TEXT,
    "externalId" TEXT,
    "saleId" TEXT,
    "orderId" TEXT,
    "amount" DECIMAL(12,2),
    "autoFixed" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "runId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT,

    CONSTRAINT "order_audit_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_audit_runs_startedAt_idx" ON "order_audit_runs"("startedAt");

-- CreateIndex
CREATE INDEX "order_audit_issues_status_severity_idx" ON "order_audit_issues"("status", "severity");

-- CreateIndex
CREATE INDEX "order_audit_issues_type_firstSeenAt_idx" ON "order_audit_issues"("type", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_audit_issues_companyId_key_key" ON "order_audit_issues"("companyId", "key");

-- AddForeignKey
ALTER TABLE "order_audit_issues" ADD CONSTRAINT "order_audit_issues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_audit_issues" ADD CONSTRAINT "order_audit_issues_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

