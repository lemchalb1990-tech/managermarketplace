import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve, sep } from 'path';

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

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: SupabaseClient | null;
  readonly publicBucket = process.env.SUPABASE_PUBLIC_BUCKET || 'public-files';
  readonly privateBucket = process.env.SUPABASE_PRIVATE_BUCKET || 'private-files';
  private readonly uploadDir = resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'));

  constructor() {
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
  async persist(file: Express.Multer.File, opts: { private?: boolean; folder?: string } = {}): Promise<StoredFile> {
    const filename = file.filename || `${randomUUID()}${extname(file.originalname || '')}`;
    // Disco local y multer ya lo dejó en uploads/: no hay nada más que hacer.
    if (!this.client && file.path && !opts.folder) return { filename, url: `/api/uploads/${filename}` };
    const body = file.buffer ?? (file.path ? await readFile(file.path) : Buffer.alloc(0));
    const stored = await this.put(body, filename, file.mimetype, opts);
    if (this.client && file.path) await unlink(file.path).catch(() => {});
    return stored;
  }

  // Guarda bytes generados por el sistema (p. ej. el PDF de un documento tributario).
  async put(body: Buffer, filename: string, contentType: string, opts: { private?: boolean; folder?: string } = {}): Promise<StoredFile> {
    const rel = opts.folder ? `${opts.folder}/${filename}` : filename;
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

  async remove(refs: string[]) {
    const rels = [...new Set(refs.filter(Boolean).map((r) => (r.includes('/uploads/') ? r.split('/uploads/').pop()! : r).split('?')[0]))];
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
