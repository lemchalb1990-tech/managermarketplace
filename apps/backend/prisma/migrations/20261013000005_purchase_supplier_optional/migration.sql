-- El proveedor de una compra pasa a ser opcional.
ALTER TABLE "purchases" ALTER COLUMN "supplierId" DROP NOT NULL;
