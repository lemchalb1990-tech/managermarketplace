-- Reportes de ventas programados por correo (semanal).
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "showCost" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_schedules_companyId_idx" ON "report_schedules"("companyId");
CREATE INDEX "report_schedules_weekday_hour_idx" ON "report_schedules"("weekday", "hour");
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
