DO $$ BEGIN
  CREATE TYPE "BillingProvider" AS ENUM ('OPENFACTURA','FACTO','BSALE','DEFONTANA','NUBOX','SIIGO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DteType" AS ENUM ('FACTURA','BOLETA','NOTA_CREDITO','NOTA_DEBITO','FACTURA_EXENTA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT','ISSUED','ACCEPTED','REJECTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "billing_connections" (
  "id"          TEXT              NOT NULL DEFAULT gen_random_uuid(),
  "name"        TEXT              NOT NULL,
  "provider"    "BillingProvider" NOT NULL,
  "credentials" JSONB,
  "active"      BOOLEAN           NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3)      NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3)      NOT NULL DEFAULT NOW(),
  "companyId"   TEXT              NOT NULL,
  CONSTRAINT "billing_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_connections_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id"          TEXT            NOT NULL DEFAULT gen_random_uuid(),
  "folio"       INTEGER,
  "dteType"     "DteType"       NOT NULL,
  "rut"         TEXT            NOT NULL,
  "razonSocial" TEXT            NOT NULL,
  "giro"        TEXT,
  "address"     TEXT,
  "commune"     TEXT,
  "email"       TEXT,
  "netAmount"   DECIMAL(12,2)   NOT NULL,
  "tax"         DECIMAL(12,2)   NOT NULL,
  "totalAmount" DECIMAL(12,2)   NOT NULL,
  "items"       JSONB           NOT NULL,
  "notes"       TEXT,
  "status"      "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "pdfUrl"      TEXT,
  "xmlUrl"      TEXT,
  "externalId"  TEXT,
  "issuedAt"    TIMESTAMP(3),
  "errorMsg"    TEXT,
  "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "connectionId" TEXT           NOT NULL,
  "companyId"    TEXT           NOT NULL,
  "saleId"       TEXT,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "billing_connections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoices_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
