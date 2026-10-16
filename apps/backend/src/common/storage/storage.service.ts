import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve, sep } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../../subscription/subscription.service';

// Almacenamiento de archivos subidos (fotos de productos, logos, fotos de despacho/entrega,
// adjuntos de finanzas, documentos tributarios, sonidos).
// - Con SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: se guardan en Supabase Storage. Bucket público
//   para lo que se muestra o comparte (productos, logos, documentos que pide un marketplace) y
//   bucket privado para lo que tiene datos personales (fotos de despacho/entrega, adjuntos de
//   finanzas): esos se guardan como "storage-private:/uploads/…" y StorageInterceptor los cambia
//   por un link firmado temporal en cada respuesta de la API.
// - Sin esas variables: disco local (UPLOAD_DIR), servido en /api/uploads, como siempre.
// Los objetos van bajo "uploads/" para que los enlaces sigan conteniendo "/uploads/" (la baja de
// cuenta encuentra así los archivos de una empresa para borrarlos).

export const PRIVATE_PREFIX = 'storage-private:/';
const SIGNED_URL_SECONDS = 60 * 60;

export interface StoredFile { filename: string; url: string }

// Tipo de archivo, para el desglose del espacio usado en «Plan y uso».
export type StorageCategory = 'products' | 'listings' | 'dispatch' | 'documents' | 'finance' | 'production' | 'messages' | 'logos' | 'other';

// Tablas desde las que se puede deducir la empresa dueña del archivo (por id).
const OWNER_TABLES = ['products', 'orders', 'dispatch_routes', 'marketplace_connections', 'invoices'] as const;

/**
 * Empresa dueña de un archivo: su peso cuenta para el límite de almacenamiento del plan y se
 * rechaza si no hay espacio. Se indica directo (companyId) o por la fila a la que pertenece.
 * Sin owner (logos y sonidos de la plataforma) no cuenta para ninguna empresa.
 */
export interface StorageOwner {
  category: StorageCategory;
  companyId?: string | null;
  table?: (typeof OWNER_TABLES)[number];
  id?: string;
}

type SaveOpts = { private?: boolean; folder?: string; owner?: StorageOwner };

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: SupabaseClient | null;
  readonly publicBucket = process.env.SUPABASE_PUBLIC_BUCKET || 'public-files';
  readonly privateBucket = process.env.SUPABASE_PRIVATE_BUCKET || 'private-files';
  private readonly uploadDir = resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'));

  constructor(private prisma: PrismaService, private subscription: SubscriptionService) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }

  get remote(): boolean {
    return !!this.client;
  }

  // Crea los buckets si no existen (público y privado).
  async onModuleInit() {
    if (!this.client) {
      this.logger.log(`Archivos en disco local: ${this.uploadDir}`);
      return;
    }
    try {
      const { data } = await this.client.storage.listBuckets();
      const names = new Set((data || []).map((b) => b.name));
      if (!names.has(this.publicBucket)) await this.client.storage.createBucket(this.publicBucket, { public: true });
      if (!names.has(this.privateBucket)) await this.client.storage.createBucket(this.privateBucket, { public: false });
      this.logger.log(`Archivos en Supabase Storage (${this.publicBucket} / ${this.privateBucket})`);
    } catch (err: any) {
      this.logger.error(`No se pudieron verificar los buckets de Supabase: ${err?.message || err}`);
    }
  }

  // Guarda un archivo recibido por multer (en disco o en memoria).
  async persist(file: Express.Multer.File, opts: SaveOpts = {}): Promise<StoredFile> {
    const filename = file.filename || `${randomUUID()}${extname(file.originalname || '')}`;
    // Disco local y multer ya lo dejó en uploads/: solo se valida y registra su peso.
    if (!this.client && file.path && !opts.folder) {
      const companyId = await this.ownerCompany(opts.owner);
      if (companyId) {
        try {
          await this.subscription.assertStorageRoom(companyId, file.size);
        } catch (err) {
          await unlink(file.path).catch(() => {});
          throw err;
        }
        await this.track(companyId, filename, file.size, opts.owner!.category);
      }
      return { filename, url: `/api/uploads/${filename}` };
    }
    const body = file.buffer ?? (file.path ? await readFile(file.path) : Buffer.alloc(0));
    try {
      return await this.put(body, filename, file.mimetype, opts);
    } finally {
      if (this.client && file.path) await unlink(file.path).catch(() => {});
    }
  }

  // Guarda bytes generados por el sistema (p. ej. el PDF de un documento tributario).
  async put(body: Buffer, filename: string, contentType: string, opts: SaveOpts = {}): Promise<StoredFile> {
    const rel = opts.folder ? `${opts.folder}/${filename}` : filename;
    const companyId = await this.ownerCompany(opts.owner);
    if (companyId) await this.subscription.assertStorageRoom(companyId, body.length);
    const stored = await this.save(body, rel, filename, contentType, opts);
    if (companyId) await this.track(companyId, rel, body.length, opts.owner!.category);
    return stored;
  }

  private async save(body: Buffer, rel: string, filename: string, contentType: string, opts: SaveOpts): Promise<StoredFile> {
    if (!this.client) {
      const path = join(this.uploadDir, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return { filename, url: `/api/uploads/${rel}` };
    }
    const key = `uploads/${rel}`;
    const bucket = opts.private ? this.privateBucket : this.publicBucket;
    const { error } = await this.client.storage.from(bucket).upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
    if (opts.private) return { filename, url: `${PRIVATE_PREFIX}${key}` };
    return { filename, url: this.client.storage.from(bucket).getPublicUrl(key).data.publicUrl };
  }

  // Borra archivos por su enlace guardado o por su ruta relativa a uploads/ (p. ej. "finance/x.pdf").
  /**
   * Lee un archivo por su enlace guardado: si es de uploads/ en disco se lee directo (no
   * depende de que el servidor sea accesible desde afuera); si no, se descarga.
   */
  async read(ref: string): Promise<{ bytes: Buffer; mime: string } | null> {
    const mimeOf = (n: string) => (/\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : /\.gif$/i.test(n) ? 'image/gif' : 'image/jpeg');
    if (!/^https?:\/\//i.test(ref) && ref.includes('/uploads/')) {
      const rel = ref.split('/uploads/').pop()!.split('?')[0];
      const path = resolve(this.uploadDir, rel);
      if (path.startsWith(this.uploadDir + sep)) {
        try {
          return { bytes: await readFile(path), mime: mimeOf(rel) };
        } catch {
          // Si no está en disco, se intenta descargar abajo.
        }
      }
    }
    if (!/^https?:\/\//i.test(ref)) return null;
    try {
      const res = await fetch(ref);
      if (!res.ok) return null;
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] || mimeOf(ref) };
    } catch {
      return null;
    }
  }

  private async ownerCompany(owner?: StorageOwner): Promise<string | null> {
    if (!owner) return null;
    if (owner.companyId) return owner.companyId;
    if (!owner.table || !owner.id || !OWNER_TABLES.includes(owner.table)) return null;
    const rows = await this.prisma.$queryRawUnsafe<{ companyId: string | null }[]>(
      `SELECT "companyId" FROM "${owner.table}" WHERE id = $1 LIMIT 1`, owner.id,
    );
    return rows[0]?.companyId ?? null;
  }

  // Registra el peso del archivo para la empresa. Un error aquí no debe perder la subida.
  private async track(companyId: string, key: string, bytes: number, category: StorageCategory) {
    await this.prisma.storedFile.upsert({
      where: { key },
      create: { companyId, key, bytes, category },
      update: { companyId, bytes, category },
    }).catch((err) => this.logger.error(`No se pudo registrar el archivo ${key}: ${err?.message || err}`));
  }

  /** Recorre un bucket de Supabase y devuelve el peso de cada archivo bajo uploads/ (ruta relativa → bytes). */
  async listRemoteSizes(): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    if (!this.client) return sizes;
    for (const bucket of [this.publicBucket, this.privateBucket]) {
      const walk = async (dir: string): Promise<void> => {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await this.client!.storage.from(bucket).list(dir, { limit: 1000, offset });
          if (error) throw new Error(`No se pudo listar ${bucket}/${dir}: ${error.message}`);
          for (const item of data ?? []) {
            const path = `${dir}/${item.name}`;
            if (item.id == null) await walk(path); // carpeta
            else sizes.set(path.replace(/^uploads\//, ''), Number((item.metadata as { size?: number } | null)?.size ?? 0));
          }
          if (!data || data.length < 1000) break;
        }
      };
      await walk('uploads');
    }
    return sizes;
  }

  /** Peso de un archivo en disco local (uploads/), o null si no está. */
  async localSize(rel: string): Promise<number | null> {
    const path = resolve(this.uploadDir, rel);
    if (!path.startsWith(this.uploadDir + sep)) return null;
    try {
      return (await stat(path)).size;
    } catch {
      return null;
    }
  }

  private refColumns: { table: string; column: string }[] | null = null;

  /**
   * Al quitar una foto o un adjunto: borra el archivo (y libera su espacio) solo si ninguna otra
   * fila lo sigue usando — una foto puede estar a la vez en el producto y en sus publicaciones.
   */
  async releaseIfUnused(refs: (string | null | undefined)[]) {
    const urls = [...new Set(refs.filter((r): r is string => !!r && r.includes('/uploads/')))];
    if (!urls.length) return 0;
    if (!this.refColumns) {
      this.refColumns = (await this.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying')
          AND (column_name ILIKE '%url%' OR column_name = 'filename') AND table_name <> 'stored_files'`)
        .map((r) => ({ table: r.table_name, column: r.column_name }));
    }
    const unused: string[] = [];
    for (const url of urls) {
      const rel = url.split('/uploads/').pop()!.split('?')[0];
      let used = false;
      for (const { table, column } of this.refColumns) {
        const value = column === 'filename' ? rel : url;
        const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
          `SELECT 1 FROM "${table.replace(/"/g, '""')}" WHERE "${column.replace(/"/g, '""')}" = $1 LIMIT 1`, value,
        );
        if (rows.length) { used = true; break; }
      }
      if (!used) unused.push(url);
    }
    return unused.length ? this.remove(unused) : 0;
  }

  async remove(refs: string[]) {
    const rels = [...new Set(refs.filter(Boolean).map((r) => (r.includes('/uploads/') ? r.split('/uploads/').pop()! : r).split('?')[0]))];
    if (rels.length) await this.prisma.storedFile.deleteMany({ where: { key: { in: rels } } }).catch(() => {});
    let deleted = 0;
    for (const rel of rels) {
      const path = resolve(this.uploadDir, rel);
      if (path.startsWith(this.uploadDir + sep)) {
        try { await unlink(path); deleted++; } catch { /* no estaba en disco */ }
      }
    }
    if (this.client && rels.length) {
      const keys = rels.map((r) => `uploads/${r}`);
      for (const bucket of [this.publicBucket, this.privateBucket]) {
        for (let i = 0; i < keys.length; i += 500) {
          const { data } = await this.client.storage.from(bucket).remove(keys.slice(i, i + 500));
          deleted += data?.length || 0;
        }
      }
    }
    return deleted;
  }

  // Reemplaza en una respuesta los enlaces privados por links firmados temporales.
  async signDeep<T>(value: T): Promise<T> {
    if (!this.client) return value;
    const found = new Set<string>();
    const seen = new WeakSet<object>();
    // Solo objetos JSON simples y arreglos (nunca streams, archivos ni instancias de clases).
    const plain = (v: any) => Array.isArray(v) || (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)));
    const collect = (v: any) => {
      if (typeof v === 'string') { if (v.startsWith(PRIVATE_PREFIX)) found.add(v); return; }
      if (!plain(v) || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) v.forEach(collect); else Object.values(v).forEach(collect);
    };
    collect(value);
    if (!found.size) return value;
    const keys = [...found].map((s) => s.slice(PRIVATE_PREFIX.length));
    const { data } = await this.client.storage.from(this.privateBucket).createSignedUrls(keys, SIGNED_URL_SECONDS);
    const map = new Map<string, string>();
    (data || []).forEach((d, i) => { if (d.signedUrl) map.set(`${PRIVATE_PREFIX}${keys[i]}`, d.signedUrl); });
    const done = new WeakSet<object>();
    const replace = (v: any): any => {
      if (typeof v === 'string') return map.get(v) ?? v;
      if (!plain(v) || done.has(v)) return v;
      done.add(v);
      if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = replace(v[i]); return v; }
      for (const k of Object.keys(v)) v[k] = replace(v[k]);
      return v;
    };
    return replace(value);
  }
}
