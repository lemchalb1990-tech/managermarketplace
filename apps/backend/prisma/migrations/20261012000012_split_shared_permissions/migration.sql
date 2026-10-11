-- Cada opción del menú tiene su propio permiso. Antes compartían uno: Escanear (con Órdenes),
-- Órdenes de trabajo (con Punto de venta), Mensajes (con Preguntas), Couriers (con E-commerce)
-- Uso (con Configuración) y Mis conexiones (con E-commerce). Los perfiles que tenían el permiso compartido reciben el nuevo para
-- no perder acceso; desde ahora se pueden desmarcar por separado.
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'orders.scan') WHERE 'orders' = ANY("permissions") AND NOT ('orders.scan' = ANY("permissions"));
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'pos.work-orders') WHERE 'pos' = ANY("permissions") AND NOT ('pos.work-orders' = ANY("permissions"));
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'ml.mensajes') WHERE 'ml.preguntas' = ANY("permissions") AND NOT ('ml.mensajes' = ANY("permissions"));
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'couriers') WHERE 'ecommerce' = ANY("permissions") AND NOT ('couriers' = ANY("permissions"));
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'usage') WHERE 'settings' = ANY("permissions") AND NOT ('usage' = ANY("permissions"));
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'ecommerce.connections') WHERE 'ecommerce' = ANY("permissions") AND NOT ('ecommerce.connections' = ANY("permissions"));
