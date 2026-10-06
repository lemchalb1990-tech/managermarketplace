// Prepara la base de datos antes de iniciar el backend.
// - Base vacía (p. ej. un proyecto nuevo de Supabase): crea el esquema completo con `db push` y
//   marca todas las migraciones como aplicadas (las migraciones del repo solo modifican tablas que
//   ya existían; no hay una migración inicial que cree la base desde cero).
// - Base con historial de migraciones: `prisma migrate deploy`.
// - Base existente sin historial de migraciones (instalaciones antiguas): `db push`, como antes.
// Para las migraciones usa DIRECT_URL si existe (en Supabase, la conexión directa o el pooler en
// modo sesión; el pooler en modo transacción de DATABASE_URL no sirve para migrar).
const { execSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const { join } = require('path');
const { PrismaClient } = require('@prisma/client');

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const env = { ...process.env, DATABASE_URL: url };
const prismaBin = join(__dirname, '..', 'node_modules', '.bin', 'prisma');
const run = (args) => execSync(`${prismaBin} ${args}`, { stdio: 'inherit', env });

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let hasSchema = false;
  let hasHistory = false;
  try {
    const [r] = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public.companies') IS NOT NULL AS schema, to_regclass('public._prisma_migrations') IS NOT NULL AS history`,
    );
    hasSchema = !!r.schema;
    hasHistory = !!r.history;
  } finally {
    await prisma.$disconnect();
  }

  if (!hasSchema) {
    console.log('[db-start] Base vacía: creando el esquema completo.');
    run('db push --skip-generate');
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const names = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();
    for (const name of names) run(`migrate resolve --applied ${name}`);
    console.log(`[db-start] ${names.length} migraciones marcadas como aplicadas.`);
    return;
  }
  if (hasHistory) {
    console.log('[db-start] Aplicando migraciones pendientes.');
    run('migrate deploy');
    return;
  }
  console.log('[db-start] Base sin historial de migraciones: sincronizando el esquema (modo anterior).');
  run('db push --accept-data-loss --skip-generate');
}

main().catch((err) => {
  console.error('[db-start] Error preparando la base:', err?.message || err);
  process.exit(1);
});
