-- Toda orden nueva nace directamente "en preparación" en vez de "pendiente" — no hay un
-- paso previo real de espera antes de empezar a prepararla. Solo cambia el default para
-- filas nuevas; no toca el status de las órdenes que ya existen.
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PREPARING';
