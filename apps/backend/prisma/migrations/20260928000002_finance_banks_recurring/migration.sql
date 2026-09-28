-- CreateEnum
CREATE TYPE "FinanceBankAccountType" AS ENUM ('BANK', 'CASH', 'CREDIT_CARD', 'WALLET');

-- CreateEnum
CREATE TYPE "FinanceBankTxStatus" AS ENUM ('PENDING', 'MATCHED', 'IGNORED');

-- AlterTable
ALTER TABLE "finance_movements" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "period" TEXT,
ADD COLUMN     "recurringId" TEXT,
ADD COLUMN     "tax" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "finance_bank_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinanceBankAccountType" NOT NULL DEFAULT 'BANK',
    "bankName" TEXT,
    "accountNumber" TEXT,
    "initialBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "initialDate" TIMESTAMP(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "finance_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_bank_transactions" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "balance" DECIMAL(14,2),
    "fingerprint" TEXT NOT NULL,
    "status" "FinanceBankTxStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "movementId" TEXT,
    "transferId" TEXT,

    CONSTRAINT "finance_bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transfers" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "finance_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_recurrings" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "counterparty" TEXT,
    "paymentMethod" "PaymentMethod",
    "dayOfMonth" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankAccountId" TEXT,

    CONSTRAINT "finance_recurrings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_bank_accounts_companyId_idx" ON "finance_bank_accounts"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_bank_transactions_movementId_key" ON "finance_bank_transactions"("movementId");

-- CreateIndex
CREATE INDEX "finance_bank_transactions_bankAccountId_status_date_idx" ON "finance_bank_transactions"("bankAccountId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_bank_transactions_bankAccountId_fingerprint_key" ON "finance_bank_transactions"("bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "finance_transfers_companyId_date_idx" ON "finance_transfers"("companyId", "date");

-- CreateIndex
CREATE INDEX "finance_recurrings_companyId_active_idx" ON "finance_recurrings"("companyId", "active");

-- CreateIndex
CREATE INDEX "finance_movements_bankAccountId_date_idx" ON "finance_movements"("bankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_movements_recurringId_period_key" ON "finance_movements"("recurringId", "period");

-- AddForeignKey
ALTER TABLE "finance_movements" ADD CONSTRAINT "finance_movements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "finance_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_movements" ADD CONSTRAINT "finance_movements_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "finance_recurrings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bank_accounts" ADD CONSTRAINT "finance_bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bank_transactions" ADD CONSTRAINT "finance_bank_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bank_transactions" ADD CONSTRAINT "finance_bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "finance_bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bank_transactions" ADD CONSTRAINT "finance_bank_transactions_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "finance_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bank_transactions" ADD CONSTRAINT "finance_bank_transactions_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "finance_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "finance_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "finance_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_recurrings" ADD CONSTRAINT "finance_recurrings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_recurrings" ADD CONSTRAINT "finance_recurrings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_recurrings" ADD CONSTRAINT "finance_recurrings_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "finance_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

