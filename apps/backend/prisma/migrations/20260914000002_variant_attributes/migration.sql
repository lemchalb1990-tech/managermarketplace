-- Fase 2 de la reorganización de catálogo: atributos de variación (ej. Color=Negro)
-- sobre un Product que actúa como variante vendible de un Producto Maestro.

CREATE TABLE "variant_attributes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "variant_attributes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_attributes_productId_name_key" ON "variant_attributes"("productId", "name");

ALTER TABLE "variant_attributes" ADD CONSTRAINT "variant_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
