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

// Primer Super Admin cuando aún no existe ninguno, solo si se definieron SUPER_ADMIN_EMAIL y
// SUPER_ADMIN_PASSWORD (nunca con una contraseña por defecto).
async function createFirstSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.log('[db-start] Sin SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD: no se crea el Super Admin.');
    return;
  }
  if (password.length < 10) {
    console.log('[db-start] SUPER_ADMIN_PASSWORD debe tener al menos 10 caracteres: no se crea el Super Admin.');
    return;
  }
  const bcrypt = require('bcryptjs');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    // Solo si todavía no hay ningún Super Admin (base nueva).
    if (await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })) return;
    if (await prisma.user.findUnique({ where: { email } })) return;
    await prisma.user.create({
      data: { email, password: await bcrypt.hash(password, 10), name: 'Super Admin', role: 'SUPER_ADMIN' },
    });
    console.log(`[db-start] Super Admin creado: ${email}. Quita SUPER_ADMIN_PASSWORD de las variables.`);
  } finally {
    await prisma.$disconnect();
  }
}

// Supabase expone el esquema public por su API REST con una clave pública (anon). El backend no
// la usa (se conecta directo a Postgres), así que se cierra: RLS activo en todas las tablas (sin
// reglas = la API no lee ni escribe nada) y sin permisos para anon/authenticated. Solo con
// Supabase configurado, para no tocar otras instalaciones.
async function lockSupabaseApi() {
  if (!process.env.SUPABASE_URL) return;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`);
    for (const { tablename } of tables) {
      await prisma.$executeRawUnsafe(`ALTER TABLE public."${tablename.replace(/"/g, '""')}" ENABLE ROW LEVEL SECURITY`);
    }
    for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
      await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL ${kind} IN SCHEMA public FROM anon, authenticated`);
    }
    if (tables.length) console.log(`[db-start] RLS activado en ${tables.length} tabla(s) nuevas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().then(lockSupabaseApi).then(createFirstSuperAdmin).catch((err) => {
  console.error('[db-start] Error preparando la base:', err?.message || err);
  process.exit(1);
});
