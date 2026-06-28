-- Add DESPACHADOR to Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DESPACHADOR';

-- Add RouteStatus enum
DO $$ BEGIN
  CREATE TYPE "RouteStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Create dispatch_routes table
CREATE TABLE "dispatch_routes" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "status"      "RouteStatus" NOT NULL DEFAULT 'PENDING',
  "notes"       TEXT,
  "startedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "companyId"   TEXT NOT NULL,
  "dispatcherId" TEXT,
  "createdById" TEXT,
  CONSTRAINT "dispatch_routes_pkey" PRIMARY KEY ("id")
);

-- Create route_stops table
CREATE TABLE "route_stops" (
  "id"          TEXT NOT NULL,
  "position"    INTEGER NOT NULL,
  "notes"       TEXT,
  "lat"         DOUBLE PRECISION,
  "lng"         DOUBLE PRECISION,
  "deliveredAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "routeId"     TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "route_stops_orderId_key" ON "route_stops"("orderId");

-- Foreign keys dispatch_routes
ALTER TABLE "dispatch_routes" ADD CONSTRAINT "dispatch_routes_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispatch_routes" ADD CONSTRAINT "dispatch_routes_dispatcherId_fkey"
  FOREIGN KEY ("dispatcherId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dispatch_routes" ADD CONSTRAINT "dispatch_routes_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys route_stops
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "dispatch_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
