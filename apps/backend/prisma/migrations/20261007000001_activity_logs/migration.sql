-- Historial de actividad por empresa + reconstrucción del historial desde el inicio de cada
-- empresa con los datos que ya existen (origin = 'history').

CREATE TABLE "activity_logs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "userId" TEXT,
  "actorName" TEXT,
  "automatic" BOOLEAN NOT NULL DEFAULT false,
  "origin" TEXT NOT NULL DEFAULT 'live',
  "module" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT,
  "entityId" TEXT,
  "entityLabel" TEXT,
  "summary" TEXT NOT NULL,
  "changes" JSONB,
  "ip" TEXT,
  "href" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "activity_logs_companyId_createdAt_idx" ON "activity_logs"("companyId", "createdAt");
CREATE INDEX "activity_logs_companyId_userId_createdAt_idx" ON "activity_logs"("companyId", "userId", "createdAt");
CREATE INDEX "activity_logs_companyId_module_createdAt_idx" ON "activity_logs"("companyId", "module", "createdAt");
CREATE INDEX "activity_logs_companyId_action_createdAt_idx" ON "activity_logs"("companyId", "action", "createdAt");

-- Identificador para las filas reconstruidas.
CREATE OR REPLACE FUNCTION pg_temp.hid() RETURNS TEXT AS $$ SELECT 'h' || md5(random()::text || clock_timestamp()::text) $$ LANGUAGE sql;

-- Empresas
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), c."id", false, 'history', 'Empresas', 'CREAR', 'company', c."id", c."name", 'Empresa creada: ' || c."name", c."createdAt"
FROM "companies" c;

-- Usuarios
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), u."companyId", false, 'history', 'Usuarios', 'CREAR', 'user', u."id", u."email",
       'Usuario creado: ' || u."name" || ' (' || u."email" || ')', u."createdAt"
FROM "users" u;

-- Productos (agrupados por empresa y día: las importaciones crean miles de una vez)
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","summary","createdAt")
SELECT pg_temp.hid(), p."companyId", false, 'history', 'Catálogo', 'CREAR',
       CASE WHEN count(*) = 1 THEN 'Producto creado: ' || min(p."sku") || ' — ' || min(p."name")
            ELSE 'Se crearon o importaron ' || count(*) || ' productos' END,
       min(p."createdAt")
FROM "products" p
GROUP BY p."companyId", date_trunc('day', p."createdAt");

-- Publicaciones vinculadas (agrupadas por empresa, tienda y día)
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), mc."companyId", false, 'history',
       CASE WHEN mc."marketplace" = 'MERCADO_LIBRE' THEN 'Mercado Libre' ELSE 'Marketplaces' END,
       'IMPORTAR', 'connection', mc."id", mc."name",
       CASE WHEN count(*) = 1 THEN 'Publicación vinculada en ' || mc."name"
            ELSE 'Se vincularon ' || count(*) || ' publicaciones en ' || mc."name" END,
       min(l."createdAt")
FROM "listings" l
JOIN "marketplace_connections" mc ON mc."id" = l."connectionId"
GROUP BY mc."companyId", mc."id", mc."name", mc."marketplace", date_trunc('day', l."createdAt");

-- Ventas: las de POS / manuales con su usuario; las de marketplaces como automáticas
INSERT INTO "activity_logs" ("id","companyId","userId","actorName","automatic","origin","module","action","entity","entityId","entityLabel","summary","href","createdAt")
SELECT pg_temp.hid(), s."companyId", s."userId", u."name",
       s."channel" NOT IN ('POS','MANUAL','ORDER_REQUEST'), 'history', 'Ventas',
       CASE WHEN s."channel" IN ('POS','MANUAL','ORDER_REQUEST') THEN 'CREAR' ELSE 'IMPORTAR' END,
       'sale', s."id", COALESCE(s."externalId", s."id"),
       CASE WHEN s."channel" IN ('POS','MANUAL','ORDER_REQUEST')
            THEN 'Venta registrada (' || s."channel"::text || ') por $' || round(s."total")::text
            ELSE 'Venta importada de ' || s."channel"::text || COALESCE(' n° ' || s."externalId", '') || ' por $' || round(s."total")::text END,
       '/dashboard/sales', s."createdAt"
FROM "sales" s
LEFT JOIN "users" u ON u."id" = s."userId";

-- Kardex: ajustes, compras, traspasos y devoluciones (las ventas y el stock inicial ya están arriba)
INSERT INTO "activity_logs" ("id","companyId","userId","actorName","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), p."companyId", m."userId", u."name", m."userId" IS NULL, 'history', 'Inventario', 'EDITAR',
       'product', p."id", p."sku",
       CASE m."type"::text WHEN 'ADJUSTMENT' THEN 'Ajuste de stock' WHEN 'PURCHASE' THEN 'Ingreso por compra'
            WHEN 'TRANSFER_OUT' THEN 'Salida por traspaso' WHEN 'TRANSFER_IN' THEN 'Ingreso por traspaso' ELSE 'Devolución' END
         || ' ' || p."sku" || ': ' || CASE WHEN m."quantity" > 0 THEN '+' ELSE '' END || m."quantity"
         || COALESCE(' (' || m."reason" || ')', ''),
       m."createdAt"
FROM "stock_movements" m
JOIN "products" p ON p."id" = m."productId"
LEFT JOIN "users" u ON u."id" = m."userId"
WHERE m."type" IN ('ADJUSTMENT','PURCHASE','TRANSFER_OUT','TRANSFER_IN','RETURN');

-- Historial de órdenes: manuales con el nombre de quien lo hizo; el resto automático
INSERT INTO "activity_logs" ("id","companyId","actorName","automatic","origin","module","action","entity","entityId","entityLabel","summary","href","createdAt")
SELECT pg_temp.hid(), o."companyId", e."actorName", e."source" <> 'MANUAL', 'history', 'Órdenes', 'ESTADO',
       'order', o."id", COALESCE(s."externalId", o."id"),
       'Orden ' || COALESCE(s."externalId", o."id") || ': ' || e."title",
       '/dashboard/orders/' || o."id", e."occurredAt"
FROM "order_status_events" e
JOIN "orders" o ON o."id" = e."orderId"
LEFT JOIN "sales" s ON s."id" = o."saleId";

-- Documentos tributarios
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), i."companyId", false, 'history', 'Facturación', 'EMITIR', 'invoice', i."id", COALESCE(i."folio"::text, i."id"),
       i."dteType"::text || COALESCE(' folio ' || i."folio"::text, '') || ' (' || i."status"::text || ')',
       COALESCE(i."issuedAt", i."createdAt")
FROM "invoices" i;

-- Clientes y proveedores
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), c."companyId", false, 'history', 'Clientes', 'CREAR', 'client', c."id", c."name", 'Cliente creado: ' || c."name", c."createdAt"
FROM "clients" c;
INSERT INTO "activity_logs" ("id","companyId","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), s."companyId", false, 'history', 'Proveedores', 'CREAR', 'supplier', s."id", s."name", 'Proveedor creado: ' || s."name", s."createdAt"
FROM "suppliers" s;

-- Órdenes de trabajo, compras, traspasos y movimientos de finanzas
INSERT INTO "activity_logs" ("id","companyId","userId","actorName","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), w."companyId", w."userId", u."name", false, 'history', 'Ventas', 'CREAR', 'work_order', w."id", w."folio"::text,
       'Orden de trabajo n° ' || w."folio" || ' (' || w."status"::text || ')', w."createdAt"
FROM "work_orders" w LEFT JOIN "users" u ON u."id" = w."userId";
INSERT INTO "activity_logs" ("id","companyId","userId","actorName","automatic","origin","module","action","entity","entityId","summary","createdAt")
SELECT pg_temp.hid(), pu."companyId", pu."userId", u."name", false, 'history', 'Compras', 'CREAR', 'purchase', pu."id",
       'Compra registrada por $' || round(pu."total")::text, pu."createdAt"
FROM "purchases" pu LEFT JOIN "users" u ON u."id" = pu."userId";
INSERT INTO "activity_logs" ("id","companyId","userId","actorName","automatic","origin","module","action","entity","entityId","entityLabel","summary","createdAt")
SELECT pg_temp.hid(), t."companyId", t."createdById", u."name", false, 'history', 'Inventario', 'CREAR', 'transfer', t."id", t."number"::text,
       'Traspaso n° ' || t."number" || ' (' || t."status"::text || ')', t."createdAt"
FROM "transfer_documents" t LEFT JOIN "users" u ON u."id" = t."createdById";
INSERT INTO "activity_logs" ("id","companyId","userId","actorName","automatic","origin","module","action","entity","entityId","summary","createdAt")
SELECT pg_temp.hid(), f."companyId", f."userId", u."name", f."userId" IS NULL, 'history', 'Finanzas', 'CREAR', 'finance_movement', f."id",
       'Movimiento: ' || f."description" || ' $' || round(f."amount")::text, f."createdAt"
FROM "finance_movements" f LEFT JOIN "users" u ON u."id" = f."userId";

-- Los perfiles de acceso que ya administran perfiles de acceso (nivel administrador) reciben el
-- permiso nuevo "Historial de actividad"; al resto se le puede activar desde Perfiles de acceso.
UPDATE "access_profiles" SET "permissions" = array_append("permissions", 'activity')
WHERE 'access-profiles' = ANY("permissions") AND NOT ('activity' = ANY("permissions"));

-- La API pública de Supabase no debe poder leer el historial.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON "activity_logs" FROM anon, authenticated';
  END IF;
END $$;
