import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
const GENERATED_FOLDER = 'ai-generated';
const NEEDS_CATEGORY = 'Asigna la categoría ML del producto para revisar, corregir o generar fotos.';

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
    // Desde el almacenamiento (disco o Supabase); si no, por su enlace público.
    const stored = await this.storage.read(url) ?? await this.storage.read(await this.absolute(url));
    if (!stored) throw new BadRequestException('No se pudo leer la foto.');
    return stored;
  }

  private sortedImages(product: any) {
    return [...(product.images || [])]
      .sort((a: any, b: any) => Number(b.isPrimary) - Number(a.isPrimary) || (a.order ?? 0) - (b.order ?? 0))
      .slice(0, 10);
  }

  // Diagnóstico de imágenes de ML: fondo, tamaño, textos/logos y marcas de agua.
  private async mlDiagnostic(token: string, storedUrl: string, categoryId: string | null, title: string): Promise<MlDiagnostic> {
    const call = async (picture: string) => {
      const res = await fetch(`${ML_API}/moderations/pictures/diagnostic`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ picture_url: picture, context: { ...(categoryId ? { category_id: categoryId } : {}), title } }),
      });
      return { res, data: await res.json().catch(() => null) as any };
    };
    try {
      let { res, data } = await call(await this.absolute(storedUrl));
      // Si Mercado Libre no puede descargar la foto (enlace no público o bloqueado), se le sube
      // directo a su CDN y se diagnostica con el id de la foto (la API lo acepta).
      if (!res.ok && /download|descarg/i.test(JSON.stringify(data ?? ''))) {
        const img = await this.download(storedUrl).catch(() => null);
        const pictureId = img ? await this.ml.uploadPictureBytesToMl(token, img.bytes, img.mime, storedUrl) : null;
        if (pictureId) ({ res, data } = await call(pictureId));
      }
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

  async check(productId: string, connectionId: string, user: any, opts: { title?: string; useAi?: boolean; imageIds?: string[] }) {
    const product: any = await this.catalog.findOne(productId, user);
    const token = await this.ml.getAccessTokenForUser(connectionId, user);
    const title = (opts.title?.trim() || (product.listings || []).find((l: any) => l.connectionId === connectionId)?.title || product.name).trim();
    const categoryId = product.mlCategoryId || (await this.settings.get('ML_DEFAULT_CATEGORY')) || null;
    // Se puede revisar foto por foto (el panel muestra el avance); la principal sigue siendo la del producto.
    const allImages = this.sortedImages(product);
    const primaryId = allImages[0]?.id;
    const images = opts.imageIds?.length ? allImages.filter((img: any) => opts.imageIds!.includes(img.id)) : allImages;

    // Lo que incluye el plan de la empresa (el Super Admin tiene todo).
    const st = await this.credits.status(product.companyId);
    const isSuper = user.role === Role.SUPER_ADMIN;
    if (!st.plan) {
      throw new ForbiddenException('Tu empresa no tiene un plan para revisar fotos. Pide al administrador de la plataforma que te asigne uno.');
    }
    // Solo lo que incluye el plan de la empresa, también para el Super Admin.
    const has = (f: string) => !!st.plan?.features.includes(f);
    const features = { ML_DIAGNOSTIC: has('ML_DIAGNOSTIC'), AI_CHECK: has('AI_CHECK'), AI_FIX: has('AI_FIX'), AI_GENERATE: has('AI_GENERATE') };
    const useAi = !!opts.useAi && features.AI_CHECK && !!product.mlCategoryId;

    // Cuántas fotos alcanza a revisar la IA con los créditos que quedan.
    let aiBudget = 0;
    let aiBlocked: string | null = null;
    if (useAi) {
      if (!st.ready.PHOTO_CHECK) aiBlocked = 'La revisión con IA no está activa.';
      else if (isSuper) aiBudget = images.length;
      else {
        const cost = st.costs.PHOTO_CHECK || 0;
        const left = Math.min(st.remainingToday ?? Infinity, st.remainingMonth ?? Infinity);
        aiBudget = cost === 0 ? images.length : Math.min(images.length, Math.floor(left / cost));
        if (aiBudget < images.length) aiBlocked = 'No quedan créditos de IA suficientes para revisar todas las fotos.';
      }
    }

    const results: any[] = images.map((img: any) => ({ imageId: img.id, url: img.url, isPrimary: img.id === primaryId }));

    // Sin categoría ML propia no se diagnostica: los criterios de ML dependen de la categoría.
    const mlSkipped = !product.mlCategoryId ? NEEDS_CATEGORY : null;
    const mlTask = features.ML_DIAGNOSTIC && !mlSkipped ? Promise.all(images.map(async (img: any, i: number) => {
      results[i].ml = await this.mlDiagnostic(token, img.url, categoryId, title);
    })) : Promise.resolve();

    const aiTask = (async () => {
      if (!useAi) return;
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
            results[i].ai = await this.ai.checkPhoto(data, { title, isMain: img.id === primaryId }) as PhotoVerdict;
          } catch (err: any) {
            if (usageId) await this.credits.refund(usageId);
            results[i].aiError = err?.response?.message || err?.message || 'No se pudo revisar con IA';
          }
        }
      };
      await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
    })();

    await Promise.all([mlTask, aiTask]);
    // Registro de las fotos que Mercado Libre diagnosticó (no descuentan créditos), para
    // cuantificarlas en Administrador de plataforma → Inteligencia artificial.
    const diagnosed = results.filter((r) => r.ml?.available).length;
    if (diagnosed) await this.credits.recordFree(product.companyId, user, 'ML_DIAGNOSTIC', productId, diagnosed);
    return {
      title,
      categoryId,
      images: results,
      aiBlocked: useAi && !aiBudget ? aiBlocked : null,
      mlSkipped,
      features,
      credits: await this.credits.status(product.companyId),
    };
  }

  // Corrige la foto real con IA y devuelve la sugerencia (no reemplaza nada todavía).
  async fix(productId: string, imageId: string, user: any, title?: string) {
    const product: any = await this.catalog.findOne(productId, user);
    if (!product.mlCategoryId) throw new BadRequestException(NEEDS_CATEGORY);
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

  // Crea una imagen de referencia desde el título y la devuelve como sugerencia.
  async generate(productId: string, connectionId: string | undefined, user: any, title?: string) {
    const product: any = await this.catalog.findOne(productId, user);
    const finalTitle = (title?.trim()
      || (connectionId ? (product.listings || []).find((l: any) => l.connectionId === connectionId)?.title : null)
      || product.name).trim();
    if (!product.mlCategoryId) throw new BadRequestException(NEEDS_CATEGORY);
    const usageId = await this.credits.consume(product.companyId, user, 'PHOTO_GENERATE', productId);
    try {
      // Título + descripción (la detallada de ML sin HTML y la corta) para una imagen más fiel.
      const stripHtml = (h?: string | null) => (h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const description = [stripHtml(product.mlDescription), stripHtml(product.description)]
        .filter((d, i, all) => d && all.indexOf(d) === i)
        .join('. ');
      const img = await this.ai.generatePhoto(finalTitle, description);
      const ext = img.mime === 'image/png' ? 'png' : 'jpg';
      const { url } = await this.storage.put(img.bytes, `ai-gen-${productId}-${Date.now()}.${ext}`, img.mime, { folder: GENERATED_FOLDER });
      return { url, credits: await this.credits.status(product.companyId) };
    } catch (err) {
      await this.credits.refund(usageId);
      throw err;
    }
  }

  // Agrega al producto la imagen de referencia que el usuario aprobó (al final, no principal
  // salvo que el producto no tenga fotos).
  async addGenerated(productId: string, user: any, url: string) {
    await this.catalog.findOne(productId, user);
    if (!url || !url.includes(`/${GENERATED_FOLDER}/ai-gen-${productId}-`)) throw new BadRequestException('Imagen no válida');
    const filename = url.split('/').pop()!.split('?')[0];
    const count = await this.prisma.productImage.count({ where: { productId } });
    return this.prisma.productImage.create({ data: { productId, url, filename, isPrimary: count === 0, order: count } });
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
