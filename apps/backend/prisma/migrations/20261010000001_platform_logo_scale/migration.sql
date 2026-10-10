-- Tamaño del logo de cada plataforma, en porcentaje (100 = normal).
ALTER TABLE "platform_settings" ADD COLUMN "logoScale" INTEGER NOT NULL DEFAULT 100;
