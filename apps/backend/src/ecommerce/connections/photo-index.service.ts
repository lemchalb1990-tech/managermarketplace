import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RipleyAdapter } from '../platforms/ripley.adapter';
import { FalabellaAdapter } from '../platforms/falabella.adapter';
import { ParisAdapter } from '../platforms/paris.adapter';

// Índice de fotos por SKU y por título para los canales que no entregan fotos por API
// (Ripley/Mirakl). Se arma con lo que sí las tiene: el catálogo propio, los reportes de
// importación de productos de Ripley, Falabella y Paris. Se construye en segundo plano y
// queda en memoria unas horas por empresa.
//   - "rápido": catálogo + Ripley + Falabella (segundos).
//   - "completo": además Paris, que exige pedir el detalle de cada producto (minutos).

export const normKey = (s: string | null | undefined) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

type Entry = { images: string[]; source: string };

export class PhotoIndex {
  bySku = new Map<string, Entry>();
  byTitle = new Map<string, Entry>();
  // Título de cada oferta de Ripley (para buscar por título cuando solo se tiene el SKU).
  ripleyTitles = new Map<string, string>();

  add(sku: string | null | undefined, title: string | null | undefined, images: string[], source: string) {
    const imgs = [...new Set(images.filter((u) => /^https?:\/\//i.test(u || '')))];
    if (!imgs.length) return;
    const k = normKey(sku), t = normKey(title);
    if (k && !this.bySku.has(k)) this.bySku.set(k, { images: imgs, source });
    if (t && !this.byTitle.has(t)) this.byTitle.set(t, { images: imgs, source });
  }

  find(sku: string | null | undefined, title?: string | null): Entry | null {
    const k = normKey(sku);
    const t = normKey(title || this.ripleyTitles.get(k));
    return (k && this.bySku.get(k)) || (t && this.byTitle.get(t)) || null;
  }
}

const TTL_MS = 6 * 3600 * 1000;

@Injectable()
export class PhotoIndexService {
  private readonly logger = new Logger(PhotoIndexService.name);
  private cache = new Map<string, { at: number; quick: Promise<PhotoIndex>; full: Promise<PhotoIndex> }>();

  constructor(
    private prisma: PrismaService,
    private ripley: RipleyAdapter,
    private falabella: FalabellaAdapter,
    private paris: ParisAdapter,
  ) {}

  // Índice rápido (sin Paris) y completo de la empresa; ambos comparten la misma instancia,
  // así que el rápido se va completando cuando termina Paris.
  get(companyId: string, opts: { full?: boolean; refresh?: boolean } = {}): Promise<PhotoIndex> {
    let entry = this.cache.get(companyId);
    if (!entry || opts.refresh || Date.now() - entry.at > TTL_MS) {
      const index = new PhotoIndex();
      const quick = this.buildQuick(companyId, index);
      const full = quick.then(() => this.addParis(companyId, index)).then(() => index);
      full.catch(() => this.cache.delete(companyId));
      entry = { at: Date.now(), quick, full };
      this.cache.set(companyId, entry);
    }
    return opts.full ? entry.full : entry.quick;
  }

  private async connection(companyId: string, marketplace: MarketplaceType) {
    return this.prisma.marketplaceConnection.findFirst({ where: { companyId, marketplace, active: true } });
  }

  private async buildQuick(companyId: string, index: PhotoIndex): Promise<PhotoIndex> {
    // 1) Catálogo propio (productos que ya tienen fotos).
    const products = await this.prisma.product.findMany({
      where: { companyId, images: { some: {} } },
      select: { sku: true, name: true, images: { select: { url: true }, orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }] } },
    });
    for (const p of products) index.add(p.sku, p.name, p.images.map((i) => i.url), 'catálogo');

    // 2) Ripley: títulos de las ofertas y fotos originales de los reportes de importación.
    const rc = await this.connection(companyId, MarketplaceType.RIPLEY);
    if (rc) {
      try {
        for (const o of await this.ripley.listOffers(rc)) index.ripleyTitles.set(normKey(o.sku), o.title);
        // Las fotos originales de Ripley tienen prioridad sobre las de otros canales.
        const rows = await this.ripley.listProductImportImages(rc);
        const imgs = new PhotoIndex();
        for (const r of rows) imgs.add(r.sku, r.title, r.images, 'Ripley');
        for (const [k, v] of imgs.bySku) if (!index.bySku.has(k) || index.bySku.get(k)!.source !== 'catálogo') index.bySku.set(k, v);
        for (const [k, v] of imgs.byTitle) if (!index.byTitle.has(k)) index.byTitle.set(k, v);
      } catch (err: any) {
        this.logger.warn(`Índice de fotos ${companyId}: Ripley ${err?.message || err}`);
      }
    }

    // 3) Falabella.
    const fc = await this.connection(companyId, MarketplaceType.FALABELLA);
    if (fc) {
      try {
        for (const p of await this.falabella.listProductsWithImages(fc)) index.add(p.sku, p.title, p.images, 'Falabella');
      } catch (err: any) {
        this.logger.warn(`Índice de fotos ${companyId}: Falabella ${err?.message || err}`);
      }
    }
    return index;
  }

  private async addParis(companyId: string, index: PhotoIndex) {
    const pc = await this.connection(companyId, MarketplaceType.PARIS);
    if (!pc) return;
    try {
      for (const p of await this.paris.listProductsWithImages(pc)) index.add(p.sku, p.title, p.images, 'Paris');
      this.logger.log(`Índice de fotos ${companyId}: ${index.bySku.size} SKU, ${index.byTitle.size} títulos`);
    } catch (err: any) {
      this.logger.warn(`Índice de fotos ${companyId}: Paris ${err?.message || err}`);
    }
  }
}
