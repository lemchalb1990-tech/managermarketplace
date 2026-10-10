-- Tamaño del logo por vista (panel, círculo del inicio, cinta, login, ícono), en %.
ALTER TABLE "platform_settings" ADD COLUMN "logoScales" JSONB;
