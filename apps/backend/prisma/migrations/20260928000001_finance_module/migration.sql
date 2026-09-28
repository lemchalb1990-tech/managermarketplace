-- CreateEnum
CREATE TYPE "FinanceAccountType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "finance_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" "FinanceAccountType" NOT NULL,
    "systemKey" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_movements" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "paymentMethod" "PaymentMethod",
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "finance_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budgets" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "finance_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_accounts_companyId_systemKey_key" ON "finance_accounts"("companyId", "systemKey");
CREATE INDEX "finance_accounts_companyId_parentId_idx" ON "finance_accounts"("companyId", "parentId");
CREATE INDEX "finance_movements_companyId_date_idx" ON "finance_movements"("companyId", "date");
CREATE INDEX "finance_movements_accountId_date_idx" ON "finance_movements"("accountId", "date");
CREATE UNIQUE INDEX "finance_budgets_accountId_year_month_key" ON "finance_budgets"("accountId", "year", "month");
CREATE INDEX "finance_budgets_companyId_year_idx" ON "finance_budgets"("companyId", "year");

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_movements" ADD CONSTRAINT "finance_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_movements" ADD CONSTRAINT "finance_movements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_movements" ADD CONSTRAINT "finance_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
