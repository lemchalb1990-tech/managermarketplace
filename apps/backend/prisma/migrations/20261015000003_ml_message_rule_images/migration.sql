-- Imágenes de los mensajes programados de Mercado Libre: [{ url, name, type, size }].
ALTER TABLE "ml_message_rules" ADD COLUMN "images" JSONB;
