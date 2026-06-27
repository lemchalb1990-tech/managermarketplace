CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "platform" TEXT NOT NULL,
  "displayName" TEXT,
  "description" TEXT,
  "logoUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_settings_platform_key" UNIQUE ("platform")
);
