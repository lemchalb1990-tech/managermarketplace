import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageCategory, StorageService } from '../common/storage/storage.service';
import { CompanyClosureService } from './company-closure.service';

// Marca interna (las claves con "_" no aparecen en la configuración del sistema).
const MEASURED_KEY = '_STORAGE_MEASURED_AT';

// Tipo de archivo según la tabla que lo referencia (para el desglose en «Plan y uso»).
function categoryOf(table: string): StorageCategory {
  if (table === 'listing_images') return 'listings';
  if (table.startsWith('product')) return table.startsWith('production') ? 'production' : 'products';
  if (table.includes('photo') || table.startsWith('dispatch')) return 'dispatch';
  if (table === 'invoices' || table.startsWith('courier')) return 'documents';
  if (table.startsWith('finance')) return 'finance';
  if (table.startsWith('ml_message')) return 'messages';
  if (table === 'billing_profiles' || table === 'companies' || table === 'email_brands') return 'logos';
  return 'other';
}

/**
 * Mide una vez el espacio de los archivos que las empresas subieron antes de que existiera el
 * registro por archivo (stored_files): busca los archivos de cada empresa con el mismo recorrido
 * que usa la baja de cuenta y les asigna su peso real en Supabase (o en disco). Corre sola al
 * iniciar el servidor si nunca se hizo; el Super Admin puede repetirla.
 */
@Injectable()
export class StorageUsageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageUsageService.name);
  private running: Promise<{ companies: number; files: number; mb: number }> | null = null;

  constructor(private prisma: PrismaService, private storage: StorageService, private closure: CompanyClosureService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => {
      this.prisma.setting.findUnique({ where: { key: MEASURED_KEY } })
        .then((s) => (s ? null : this.measureAll()))
        .catch((err) => this.logger.error(`Medición de almacenamiento: ${err?.message || err}`));
    }, 60_000);
  }

  get isRunning() {
    return !!this.running;
  }

  /** Mide todas las empresas (si ya está corriendo, devuelve esa misma medición). */
  measureAll() {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    const started = Date.now();
    const remoteSizes = this.storage.remote ? await this.storage.listRemoteSizes() : null;
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let files = 0;
    let bytes = 0;
    for (const { id: companyId } of companies) {
      const found = await this.closure.listCompanyFiles(companyId);
      const rows = new Map<string, { bytes: number; category: StorageCategory }>();
      for (const f of found) {
        if (rows.has(f.rel)) continue;
        const size = remoteSizes ? remoteSizes.get(f.rel) : await this.storage.localSize(f.rel);
        if (size == null) continue; // referenciado pero ya no existe
        rows.set(f.rel, { bytes: size, category: categoryOf(f.table) });
      }
      // Lo subido después de crear el registro ya está anotado: solo se agrega lo que falta.
      const known = new Set((await this.prisma.storedFile.findMany({ where: { key: { in: [...rows.keys()] } }, select: { key: true } })).map((r) => r.key));
      const data = [...rows.entries()].filter(([key]) => !known.has(key)).map(([key, r]) => ({ companyId, key, bytes: r.bytes, category: r.category }));
      for (let i = 0; i < data.length; i += 1000) {
        await this.prisma.storedFile.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true });
      }
      files += data.length;
      bytes += data.reduce((sum, r) => sum + r.bytes, 0);
    }
    const now = new Date().toISOString();
    await this.prisma.setting.upsert({
      where: { key: MEASURED_KEY },
      create: { key: MEASURED_KEY, value: now, label: 'Última medición de almacenamiento', group: 'sistema' },
      update: { value: now },
    });
    const mb = bytes / (1024 * 1024);
    this.logger.log(`Almacenamiento medido: ${companies.length} empresas, ${files} archivos nuevos, ${mb.toFixed(1)} MB en ${Math.round((Date.now() - started) / 1000)} s`);
    return { companies: companies.length, files, mb };
  }
}
