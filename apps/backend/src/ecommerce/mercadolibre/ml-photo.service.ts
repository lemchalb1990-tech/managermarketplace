import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { CatalogService } from '../../catalog/catalog.service';
import { StorageService } from '../../common/storage/storage.service';
import { AiCreditsService } from '../../ai/ai-credits.service';
import { AiProvidersService, type ImageData, type PhotoVerdict } from '../../ai/ai-providers.service';
import { MercadolibreService } from './mercadolibre.service';

const ML_API = 'https://api.mercadolibre.com';
const AI_CONCURRENCY = 3;
const FIX_FOLDER = 'ai-fixes';

// Nombres en español de los criterios que documenta Mercado Libre para el diagnóstico.
const ML_CRITERIA: Record<string, string> = {
  white_background: 'Fondo no blanco',
  minimum_size: 'Tamaño menor al mínimo',
  text_logo: 'Textos o logos no permitidos',
  watermark: 'Marca de agua',
};

export interface MlDiagnostic {
  available: boolean;
  ok: boolean | null;
  issues: string[];
  error?: string;
  raw?: unknown;
}

// El formato exacto de la respuesta del diagnóstico de ML no está documentado públicamente
// en detalle: se buscan, en cualquier nivel, objetos que indiquen un problema detectado.
function extractMlIssues(data: unknown): string[] {
  const issues = new Set<string>();
  const failed = (o: any) =>
    o.detected === true || o.passed === false || o.valid === false || o.ok === false || o.approved === false
    || /fail|reject|invalid|detected|not_ok|warning|error|moderat/i.test(String(o.status ?? o.result ?? o.action ?? o.verdict ?? ''));
  const label = (o: any) => {
    const code = String(o.type ?? o.name ?? o.code ?? o.id ?? o.criteria ?? o.detection ?? '');
    return ML_CRITERIA[code] || o.message || o.description || o.reason || o.title || code || null;
  };
  const walk = (v: any, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (failed(v)) { const l = label(v); if (l) issues.add(String(l)); }
    Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(data, 0);
  return [...issues];
}

@Injectable()
export class MlPhotoService {
  private readonly logger = new Logger(MlPhotoService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private catalog: CatalogService,
    private storage: StorageService,
    private credits: AiCreditsService,
    private ai: AiProvidersService,
    private ml: MercadolibreService,
  ) {}

  private async absolute(url: string) {
    if (url.startsWith('http')) return url;
    return `${await this.settings.get('APP_URL')}${url}`;
  }

  private async download(url: string): Promise<ImageData> {
    const res = await fetch(await this.absolute(url));
    if (!res.ok) throw new BadRequestException(`No se pudo leer la foto (${res.status}).`);
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { bytes: Buffer.from(await res.arrayBuffer()), mime };
  }

  private sortedImages(product: any) {
    return [...(product.images || [])]
      .sort((a: any, b: any) => Number(b.isPrimary) - Number(a.isPrimary) || (a.order ?? 0) - (b.order ?? 0))
      .slice(0, 10);
  }

  // Diagnóstico de imágenes de ML: fondo, tamaño, textos/logos y marcas de agua.
  private async mlDiagnostic(token: string, pictureUrl: string, categoryId: string | null, title: string): Promise<MlDiagnostic> {
    try {
      const res = await fetch(`${ML_API}/moderations/pictures/diagnostic`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ picture_url: pictureUrl, context: { ...(categoryId ? { category_id: categoryId } : {}), title } }),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok) {
        this.logger.warn(`Diagnóstico ML no disponible (${res.status}): ${JSON.stringify(data)?.slice(0, 300)}`);
        return { available: false, ok: null, issues: [], error: data?.message || `Mercado Libre respondió ${res.status}`, raw: data };
      }
      const issues = extractMlIssues(data);
      return { available: true, ok: issues.length === 0, issues, raw: data };
    } catch (err: any) {
      return { available: false, ok: null, issues: [], error: err?.message || 'Sin respuesta de Mercado Libre' };
    }
  }

  async check(productId: string, connectionId: string, user: any, opts: { title?: string; useAi?: boolean }) {
    const product: any = await this.catalog.findOne(productId, user);
    const token = await this.ml.getAccessTokenForUser(connectionId, user);
    const title = (opts.title?.trim() || (product.listings || []).find((l: any) => l.connectionId === connectionId)?.title || product.name).trim();
    const categoryId = product.mlCategoryId || (await this.settings.get('ML_DEFAULT_CATEGORY')) || null;
    const images = this.sortedImages(product);
    if (!images.length) throw new BadRequestException('El producto no tiene fotos.');

    // Cuántas fotos alcanza a revisar la IA con los créditos que quedan.
    let aiBudget = 0;
    let aiBlocked: string | null = null;
    if (opts.useAi) {
      const st = await this.credits.status(product.companyId);
      if (!st.ready.PHOTO_CHECK) aiBlocked = 'La revisión con IA no está activa: se revisó solo con el diagnóstico de Mercado Libre.';
      else if (user.role === Role.SUPER_ADMIN) aiBudget = images.length;
      else if (!st.plan) aiBlocked = 'Tu empresa no tiene un plan de IA.';
      else {
        const cost = st.costs.PHOTO_CHECK || 0;
        const left = Math.min(st.remainingToday ?? Infinity, st.remainingMonth ?? Infinity);
        aiBudget = cost === 0 ? images.length : Math.min(images.length, Math.floor(left / cost));
        if (aiBudget < images.length) aiBlocked = 'No quedan créditos de IA suficientes para revisar todas las fotos.';
      }
    }

    const results: any[] = images.map((img: any, i: number) => ({ imageId: img.id, url: img.url, isPrimary: i === 0 }));

    const mlTask = Promise.all(images.map(async (img: any, i: number) => {
      results[i].ml = await this.mlDiagnostic(token, await this.absolute(img.url), categoryId, title);
    }));

    const aiTask = (async () => {
      if (!opts.useAi) return;
      const queue = images.map((img: any, i: number) => ({ img, i })).slice(0, aiBudget);
      // Créditos parciales: se marcan las fotos que quedaron sin revisar. Sin IA, va un solo aviso general.
      if (aiBudget > 0) images.slice(aiBudget).forEach((_: any, k: number) => { results[aiBudget + k].aiError = aiBlocked; });
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { img, i } = job;
          let usageId: string | null = null;
          try {
            usageId = await this.credits.consume(product.companyId, user, 'PHOTO_CHECK', productId);
            const data = await this.download(img.url);
            results[i].ai = await this.ai.checkPhoto(data, { title, isMain: i === 0 }) as PhotoVerdict;
          } catch (err: any) {
            if (usageId) await this.credits.refund(usageId);
            results[i].aiError = err?.response?.message || err?.message || 'No se pudo revisar con IA';
          }
        }
      };
      await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
    })();

    await Promise.all([mlTask, aiTask]);
    return {
      title,
      categoryId,
      images: results,
      aiBlocked: opts.useAi && !aiBudget ? aiBlocked : null,
      credits: opts.useAi ? await this.credits.status(product.companyId) : null,
    };
  }

  // Corrige la foto real con IA y devuelve la sugerencia (no reemplaza nada todavía).
  async fix(productId: string, imageId: string, user: any, title?: string) {
    const product: any = await this.catalog.findOne(productId, user);
    const img = (product.images || []).find((i: any) => i.id === imageId);
    if (!img) throw new NotFoundException('Foto no encontrada');
    const usageId = await this.credits.consume(product.companyId, user, 'PHOTO_FIX', productId);
    try {
      const fixed = await this.ai.fixPhoto(await this.download(img.url), (title?.trim() || product.name));
      const ext = fixed.mime === 'image/png' ? 'png' : 'jpg';
      const { url } = await this.storage.put(fixed.bytes, `ai-fix-${img.id}-${Date.now()}.${ext}`, fixed.mime, { folder: FIX_FOLDER });
      return { url, credits: await this.credits.status(product.companyId) };
    } catch (err) {
      await this.credits.refund(usageId);
      throw err;
    }
  }

  // Reemplaza la foto por la versión corregida que el usuario aprobó.
  async applyFix(productId: string, imageId: string, user: any, url: string) {
    await this.catalog.findOne(productId, user);
    // Solo se aceptan sugerencias generadas para esta misma foto.
    if (!url || !url.includes(`/${FIX_FOLDER}/ai-fix-${imageId}-`)) throw new BadRequestException('Foto corregida no válida');
    const filename = url.split('/').pop()!.split('?')[0];
    const updated = await this.prisma.productImage.updateMany({ where: { id: imageId, productId }, data: { url, filename } });
    if (!updated.count) throw new NotFoundException('Foto no encontrada');
    return this.prisma.productImage.findUnique({ where: { id: imageId } });
  }
}
