-- Dimensiones y peso del paquete de envío del producto (opcional). Mercado Libre las exige
-- como atributos SELLER_PACKAGE_* en categorías sin dato de paquete propio del catálogo.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "packageHeight" DECIMAL(8,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "packageWidth" DECIMAL(8,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "packageLength" DECIMAL(8,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "packageWeight" DECIMAL(8,2);
