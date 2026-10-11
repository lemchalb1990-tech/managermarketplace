-- Marca de los perfiles base de cada empresa (Administrador, Vendedor, Gestor de catálogo…).
-- AlterTable
ALTER TABLE "access_profiles" ADD COLUMN     "baseRole" TEXT;

