-- Mensajes programados: momento desde el que el mensaje está activo. Solo se envía a ventas cuyo
-- momento (pagada, boleta, despacho, entrega) ocurrió después de activarlo.
ALTER TABLE "ml_message_rules" ADD COLUMN "activeSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Los existentes mantienen lo que hacían hasta hoy: activos desde que se crearon.
UPDATE "ml_message_rules" SET "activeSince" = "createdAt";
