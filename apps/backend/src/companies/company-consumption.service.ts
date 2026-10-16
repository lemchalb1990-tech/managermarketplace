import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const MAX_HOPS = 3;

type Fk = { child: string; col: string; parent: string; pcol: string };

/**
 * Consumo por empresa (Super Admin): archivos (exacto, de stored_files) y base de datos
 * (estimado). Postgres no informa tamaño por empresa, así que por cada tabla se cuentan las
 * filas de cada empresa y se multiplican por el peso promedio por fila de esa tabla (datos +
 * índices). Las tablas sin companyId se atribuyen siguiendo sus llaves foráneas hasta una que
 * lo tenga (p. ej. sale_items → sales). Se calcula al pedirlo: una consulta agrupada por tabla.
 */
@Injectable()
export class CompanyConsumptionService {
  constructor(private prisma: PrismaService) {}

  async report() {
    const db = this.prisma;
    const [{ size: dbSize }] = await db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
    const tables = await db.$queryRaw<{ name: string; bytes: bigint; est: number }[]>`
      SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, c.reltuples::float8 AS est
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = current_schema() AND c.relname <> '_prisma_migrations'`;
    const withCompanyId = new Set((await db.$queryRaw<{ t: string }[]>`
      SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'companyId'`).map((r) => r.t));
    const fks = (await db.$queryRaw<Fk[]>`
      SELECT tc.relname AS child, a.attname AS col, pc.relname AS parent, pa.attname AS pcol
      FROM pg_constraint c
      JOIN pg_class tc ON tc.oid = c.conrelid
      JOIN pg_class pc ON pc.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = tc.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND n.nspname = current_schema() AND tc.relname <> pc.relname`);

    // Camino de llaves foráneas desde una tabla hasta una con companyId (el más corto).
    const pathTo = (table: string): Fk[] | null => {
      const queue: { t: string; path: Fk[] }[] = [{ t: table, path: [] }];
      const seen = new Set([table]);
      while (queue.length) {
        const { t, path } = queue.shift()!;
        if (path.length >= MAX_HOPS) continue;
        for (const fk of fks.filter((f) => f.child === t)) {
          if (seen.has(fk.parent)) continue;
          const next = [...path, fk];
          if (withCompanyId.has(fk.parent) || fk.parent === 'companies') return next;
          seen.add(fk.parent);
          queue.push({ t: fk.parent, path: next });
        }
      }
      return null;
    };

    const perCompany = new Map<string, { dbBytes: number; tables: Record<string, { rows: number; bytes: number }> }>();
    let attributed = 0;
    for (const t of tables) {
      const bytes = Number(t.bytes);
      if (bytes < 64 * 1024 && t.est <= 0) continue; // tabla vacía
      let sql: string | null = null;
      if (t.name === 'companies') sql = `SELECT id AS cid, count(*)::bigint AS n FROM "companies" GROUP BY id`;
      else if (withCompanyId.has(t.name)) sql = `SELECT "companyId" AS cid, count(*)::bigint AS n FROM ${ident(t.name)} WHERE "companyId" IS NOT NULL GROUP BY 1`;
      else {
        const path = pathTo(t.name);
        if (path) {
          const joins = path.map((fk, i) => `JOIN ${ident(fk.parent)} t${i + 1} ON t${i}.${ident(fk.col)} = t${i + 1}.${ident(fk.pcol)}`).join(' ');
          const last = path[path.length - 1];
          const cidCol = last.parent === 'companies' ? 'id' : 'companyId';
          sql = `SELECT t${path.length}.${ident(cidCol)} AS cid, count(*)::bigint AS n FROM ${ident(t.name)} t0 ${joins} WHERE t${path.length}.${ident(cidCol)} IS NOT NULL GROUP BY 1`;
        }
      }
      if (!sql) continue;
      const groups = await db.$queryRawUnsafe<{ cid: string; n: bigint }[]>(sql);
      const counted = groups.reduce((sum, g) => sum + Number(g.n), 0);
      // Filas totales: la estimación de Postgres si existe; si no (tabla sin analizar), lo contado.
      const totalRows = Math.max(t.est > 0 ? t.est : 0, counted, 1);
      const perRow = bytes / totalRows;
      for (const g of groups) {
        const rows = Number(g.n);
        const share = rows * perRow;
        const entry = perCompany.get(g.cid) ?? { dbBytes: 0, tables: {} };
        entry.dbBytes += share;
        entry.tables[t.name] = { rows, bytes: share };
        perCompany.set(g.cid, entry);
        attributed += share;
      }
    }

    const [companies, files] = await Promise.all([
      db.company.findMany({ select: { id: true, name: true, active: true, subscriptionPlan: { select: { name: true } } } }),
      db.storedFile.groupBy({ by: ['companyId'], _sum: { bytes: true }, _count: { _all: true } }),
    ]);
    const filesBy = new Map(files.map((f) => [f.companyId, { bytes: f._sum.bytes ?? 0, count: f._count._all }]));
    const rows = companies.map((c) => {
      const usage = perCompany.get(c.id);
      const f = filesBy.get(c.id) ?? { bytes: 0, count: 0 };
      const topTables = Object.entries(usage?.tables ?? {})
        .map(([table, v]) => ({ table, rows: v.rows, bytes: Math.round(v.bytes) }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 8);
      const dbBytes = Math.round(usage?.dbBytes ?? 0);
      return {
        id: c.id, name: c.name, active: c.active, plan: c.subscriptionPlan?.name ?? null,
        dbBytes, fileBytes: f.bytes, files: f.count, totalBytes: dbBytes + f.bytes,
        products: usage?.tables.products?.rows ?? 0, listings: usage?.tables.listings?.rows ?? 0,
        sales: usage?.tables.sales?.rows ?? 0, topTables,
      };
    }).sort((a, b) => b.totalBytes - a.totalBytes);

    const fileTotal = files.reduce((sum, f) => sum + (f._sum.bytes ?? 0), 0);
    return {
      generatedAt: new Date().toISOString(),
      platform: {
        dbBytes: Number(dbSize),
        // Lo que no se puede atribuir a una empresa: configuración, registros de la plataforma,
        // espacio interno de Postgres.
        systemBytes: Math.max(0, Number(dbSize) - Math.round(attributed)),
        fileBytes: fileTotal,
        companies: companies.length,
      },
      companies: rows,
    };
  }
}
