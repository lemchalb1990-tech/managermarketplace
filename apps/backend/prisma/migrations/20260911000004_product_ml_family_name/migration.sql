-- family_name de Mercado Libre (modelo "Precio por Variación"), completado al importar
-- publicaciones que ya lo tengan.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "mlFamilyName" TEXT;
