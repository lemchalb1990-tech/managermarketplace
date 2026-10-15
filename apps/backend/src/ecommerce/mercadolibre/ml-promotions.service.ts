import { companyPlanFeatures } from '../../subscription/subscription.service';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ListingStatus, MarketplaceType, Prisma, Role, SyncQueueField } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { integrationsDisabled } from '../../common/integrations.util';
import { SyncQueueService } from '../sync/sync-queue.service';
import { MercadolibreService } from './mercadolibre.service';
import {
  ACTIVE_STATUSES, MAX_OWN_DAYS, PriceMode, PromoType, TYPE_META, addPayload, deleteQuery, discountPct, estimate, friendlyError,
  isActiveStatus, isPromoType, num, promoKeyOf, propose, topPriceFor, validateApply,
} from './ml-promotions.logic';

const ML_API = 'https://api.mercadolibre.com';
const PAGE = 50;
const MAX_PROMO_PAGES = 20;          // hasta 1.000 publicaciones por campaña en cada sincronización
const ITEMS_PER_CRON = 150;          // publicaciones cuyas promociones se revisan por cuenta en cada corrida
const INFO_TTL_MS = 12 * 3600_000;   // datos de la publicación (precio, categoría, comisión)
const JOB_CONCURRENCY = 3;
const MAX_SUGGESTIONS_PER_RULE = 200;

// Tipos que las reglas pueden sugerir (relámpago queda fuera: requiere decidir el stock reservado).
export const RULE_INVITATION_TYPES: PromoType[] = ['MARKETPLACE_CAMPAIGN', 'SMART', 'PRICE_MATCHING', 'PRE_NEGOTIATED', 'UNHEALTHY_STOCK', 'DEAL', 'DOD'];

type Conn = { id: string; name: string; companyId: string; mlUserId: string | null };

type ItemCtx = {
  itemId: string;
  info: { title: string | null; thumbnail: string | null; permalink: string | null; price: number | null; stock: number | null; feePct: number | null; feeFixed: number | null; categoryId: string | null; status: string | null } | null;
  product: { id: string; name: string; sku: string; cost: number | null; stock: number; category: string | null; image: string | null } | null;
};

type ApplyItem = { itemId: string; price?: number | null; topPrice?: number | null; stock?: number | null; offerId?: string | null; suggestionId?: string | null };
type RemoveEntry = { itemId: string; type: PromoType; promotionId?: string | null; offerId?: string | null };
type JobResult = { itemId: string; title?: string | null; ok: boolean; price?: number | null; error?: string };

const toDate = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};
const dec = (v: unknown) => (v == null ? null : Number(v));
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }); // YYYY-MM-DD
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const x = items[i++];
      await fn(x);
    }
  }));
}

/**
 * Promociones de Mercado Libre (/seller-promotions, app_version=v2): invitaciones de ML,
 * promociones propias (descuento individual, campaña del vendedor, descuento por cantidad),
 * aplicación masiva con vista previa de la ganancia y reglas que SOLO sugieren (el usuario
 * aprueba cada sugerencia; nada se aplica solo).
 *
 * POR VALIDAR en vivo (sin escritura real probada): respuesta exacta de cada tipo de campaña,
 * los tópicos de notificación (public_candidates / public_offers) y la comisión de listing_prices.
 */
@Injectable()
export class MlPromotionsService implements OnModuleInit {
  private readonly logger = new Logger(MlPromotionsService.name);
  private running = false;
  private feeCache = new Map<string, { pct: number | null; fixed: number | null; at: number }>();

  constructor(private prisma: PrismaService, private ml: MercadolibreService, private syncQueue: SyncQueueService) {}

  // Aplicaciones que quedaron a medias por un reinicio del servidor.
  async onModuleInit() {
    await this.prisma.mlPromotionJob.updateMany({
      where: { status: 'RUNNING', createdAt: { lt: new Date(Date.now() - 30 * 60_000) } },
      data: { status: 'FAILED', finishedAt: new Date() },
    }).catch(() => {});
  }

  // ── Acceso ─────────────────────────────────────────────────────────────

  private companyWhere(user: any, companyId?: string) {
    if (user.role === Role.SUPER_ADMIN) return companyId ? { companyId } : {};
    return { companyId: user.companyId };
  }

  private async connectionFor(user: any, connectionId: string): Promise<Conn> {
    if (!connectionId) throw new BadRequestException('Elige la cuenta de Mercado Libre');
    const conn = await this.prisma.marketplaceConnection.findUnique({
      where: { id: connectionId }, select: { id: true, name: true, companyId: true, mlUserId: true, marketplace: true },
    });
    if (!conn || conn.marketplace !== MarketplaceType.MERCADO_LIBRE) throw new NotFoundException('Cuenta de Mercado Libre no encontrada');
    if (user && user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    return conn;
  }

  private async connectionsFor(user: any, companyId?: string) {
    return this.prisma.marketplaceConnection.findMany({
      where: { ...this.companyWhere(user, companyId), marketplace: MarketplaceType.MERCADO_LIBRE, active: true, mlUserId: { not: null } },
      select: { id: true, name: true, companyId: true, mlUserId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // GET/POST a ML con reintentos cuando la publicación está bloqueada (423) o hay límite de uso (429).
  private async mlFetch(connectionId: string, path: string, init: RequestInit = {}, attempt = 0): Promise<any> {
    const token = await this.ml.getValidToken(connectionId);
    const res = await fetch(`${ML_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if ((res.status === 423 || res.status === 429) && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      return this.mlFetch(connectionId, path, init, attempt + 1);
    }
    const text = await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!res.ok) {
      const causes = Array.isArray(body?.cause) ? body.cause.map((c: any) => c.message || c.code).filter(Boolean).join('; ') : '';
      const err: any = new Error(causes || body?.message || body?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ── Sincronización con ML ──────────────────────────────────────────────

  // Una cuenta, o todas las de la empresa si no se indica.
  async syncNow(user: any, connectionId?: string, companyId?: string) {
    if (integrationsDisabled()) throw new BadRequestException('Integraciones desactivadas en este servidor');
    const conns: Conn[] = connectionId ? [await this.connectionFor(user, connectionId)] : await this.connectionsFor(user, companyId);
    if (!conns.length) throw new BadRequestException('No hay cuentas de Mercado Libre conectadas');
    const errors: string[] = [];
    for (const conn of conns) {
      try {
        await this.syncConnection(conn);
        await this.syncSomeItems(conn, 300);
      } catch (e: any) {
        errors.push(`${conn.name}: ${e.message}`);
      }
    }
    await this.runRules(conns[0].companyId).catch((e) => this.logger.warn(`Reglas de promociones: ${e.message}`));
    return { ...(await this.summary(user, { companyId: conns[0].companyId })), errors };
  }

  // Invitaciones y campañas de la cuenta, con las publicaciones de cada una.
  async syncConnection(conn: Conn) {
    if (!conn.mlUserId) return;
    const seen = new Set<string>();
    for (let offset = 0; offset < 500; offset += PAGE) {
      const data = await this.mlFetch(conn.id, `/seller-promotions/users/${conn.mlUserId}?app_version=v2&offset=${offset}&limit=${PAGE}`);
      const results: any[] = data?.results || [];
      for (const p of results) {
        if (!p?.id || !p?.type) continue;
        seen.add(String(p.id));
        await this.prisma.mlPromotion.upsert({
          where: { connectionId_mlId: { connectionId: conn.id, mlId: String(p.id) } },
          update: {
            type: p.type, subType: p.sub_type || p.benefits?.type || null, status: String(p.status || 'started'), name: p.name || null,
            startDate: toDate(p.start_date), finishDate: toDate(p.finish_date), deadlineDate: toDate(p.deadline_date),
            benefits: p.benefits ?? undefined, syncedAt: new Date(),
          },
          create: {
            companyId: conn.companyId, connectionId: conn.id, mlId: String(p.id), type: p.type, subType: p.sub_type || p.benefits?.type || null,
            status: String(p.status || 'started'), name: p.name || null,
            startDate: toDate(p.start_date), finishDate: toDate(p.finish_date), deadlineDate: toDate(p.deadline_date),
            benefits: p.benefits ?? undefined, syncedAt: new Date(),
          },
        });
      }
      const total = Number(data?.paging?.total ?? results.length);
      if (results.length < PAGE || offset + PAGE >= total) break;
    }
    // Las que ML ya no informa terminaron.
    await this.prisma.mlPromotion.updateMany({
      where: { connectionId: conn.id, status: { not: 'finished' }, mlId: { notIn: Array.from(seen) } },
      data: { status: 'finished' },
    });
    const promos = await this.prisma.mlPromotion.findMany({ where: { connectionId: conn.id, status: { not: 'finished' } } });
    for (const p of promos) {
      if (!isPromoType(p.type)) continue;
      await this.syncPromotionItems(conn, p).catch((e) => this.logger.warn(`Promoción ${p.mlId}: ${e.message}`));
    }
  }

  private mapRow(r: any) {
    const status = String(r.status || 'candidate').toLowerCase();
    const suggested = num(r.suggested_discounted_price);
    return {
      status,
      offerId: r.offer_id || r.ref_id || null,
      price: status === 'candidate' && !num(r.price) ? suggested : num(r.price),
      originalPrice: num(r.original_price),
      topPrice: num(r.top_deal_price ?? r.top_price),
      minPrice: num(r.min_discounted_price),
      maxPrice: num(r.max_discounted_price),
      suggestedPrice: suggested,
      meliPct: num(r.meli_percentage ?? r.meli_percent),
      sellerPct: num(r.seller_percentage ?? r.seller_percent),
      stockMin: num(r.stock?.min),
      stockMax: num(r.stock?.max),
      boosted: !!r.boosted_offer,
      boostedPrice: num(r.total_price_for_boosted_offer),
      startDate: toDate(r.start_date),
      finishDate: toDate(r.finish_date || r.end_date),
      raw: r as Prisma.InputJsonValue,
    };
  }

  private async syncPromotionItems(conn: Conn, promo: { mlId: string; type: string }) {
    const key = promoKeyOf(promo.type, promo.mlId);
    const seen: string[] = [];
    let after: string | null = null;
    let complete = false;
    for (let page = 0; page < MAX_PROMO_PAGES; page++) {
      const q = new URLSearchParams({ promotion_type: promo.type, app_version: 'v2', limit: String(PAGE) });
      if (after) q.set('search_after', after);
      const data = await this.mlFetch(conn.id, `/seller-promotions/promotions/${encodeURIComponent(promo.mlId)}/items?${q}`);
      const results: any[] = data?.results || [];
      for (const r of results) {
        if (!r?.id) continue;
        const itemId = String(r.id);
        seen.push(itemId);
        const row = this.mapRow(r);
        await this.prisma.mlPromotionItem.upsert({
          where: { connectionId_itemId_promoKey: { connectionId: conn.id, itemId, promoKey: key } },
          update: { ...row, type: promo.type, promotionMlId: promo.mlId, syncedAt: new Date() },
          create: { ...row, companyId: conn.companyId, connectionId: conn.id, itemId, promoKey: key, type: promo.type, promotionMlId: promo.mlId },
        });
      }
      after = data?.searchAfter || data?.search_after || data?.paging?.searchAfter || null;
      if (!results.length || !after) { complete = true; break; }
    }
    if (complete) {
      await this.prisma.mlPromotionItem.updateMany({
        where: { connectionId: conn.id, promoKey: key, status: { not: 'finished' }, itemId: { notIn: seen } },
        data: { status: 'finished' },
      });
    }
    await this.prisma.mlPromotion.update({ where: { connectionId_mlId: { connectionId: conn.id, mlId: promo.mlId } }, data: { itemsSyncedAt: new Date() } }).catch(() => {});
    await this.refreshItemInfo(conn, seen);
  }

  // Todas las promociones de cada publicación (incluye los descuentos individuales, que no
  // vienen en la lista de campañas). Si una publicación sale de su última promoción, se vuelve
  // a encolar su precio (mientras estuvo en promoción no se le envió).
  async syncItemPromos(conn: Conn, itemIds: string[]) {
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    const ended: string[] = [];
    await pool(ids, 4, async (itemId) => {
      try {
        const data = await this.mlFetch(conn.id, `/seller-promotions/items/${itemId}?app_version=v2`);
        const entries: any[] = Array.isArray(data) ? data : data?.results || [];
        const before = await this.prisma.mlPromotionItem.findMany({ where: { connectionId: conn.id, itemId }, select: { promoKey: true, status: true } });
        const keys: string[] = [];
        for (const e of entries) {
          if (!e?.type) continue;
          const key = promoKeyOf(e.type, e.id);
          if (keys.includes(key)) continue;
          keys.push(key);
          const row = this.mapRow(e);
          await this.prisma.mlPromotionItem.upsert({
            where: { connectionId_itemId_promoKey: { connectionId: conn.id, itemId, promoKey: key } },
            update: { ...row, type: e.type, promotionMlId: e.id || null, syncedAt: new Date() },
            create: { ...row, companyId: conn.companyId, connectionId: conn.id, itemId, promoKey: key, type: e.type, promotionMlId: e.id || null },
          });
        }
        await this.prisma.mlPromotionItem.updateMany({
          where: { connectionId: conn.id, itemId, status: { not: 'finished' }, promoKey: { notIn: keys } },
          data: { status: 'finished' },
        });
        const wasActive = before.some((b) => isActiveStatus(b.status));
        const isActive = entries.some((e) => isActiveStatus(e.status));
        if (wasActive && !isActive) ended.push(itemId);
        await this.prisma.mlItemInfo.updateMany({ where: { connectionId: conn.id, itemId }, data: { promosSyncedAt: new Date() } });
      } catch (e: any) {
        this.logger.warn(`Promociones de ${itemId}: ${e.message}`);
      }
    });
    if (ended.length) await this.requeuePrices(conn.id, ended);
  }

  private async requeuePrices(connectionId: string, itemIds: string[]) {
    const listings = await this.prisma.listing.findMany({ where: { connectionId, externalId: { in: itemIds } }, select: { productId: true } });
    for (const productId of new Set(listings.map((l) => l.productId))) {
      await this.syncQueue.enqueue(productId, connectionId, SyncQueueField.PRICE, { reason: 'fin de promoción ML' }).catch(() => {});
    }
  }

  // Precio, stock, categoría y comisión de las publicaciones (para calcular la ganancia).
  async refreshItemInfo(conn: Conn, itemIds: string[], force = false) {
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    if (!ids.length) return;
    const fresh = force ? [] : await this.prisma.mlItemInfo.findMany({
      where: { connectionId: conn.id, itemId: { in: ids }, infoSyncedAt: { gt: new Date(Date.now() - INFO_TTL_MS) } }, select: { itemId: true },
    });
    const skip = new Set(fresh.map((f) => f.itemId));
    const todo = ids.filter((i) => !skip.has(i));
    const attrs = 'id,title,price,original_price,available_quantity,secure_thumbnail,thumbnail,permalink,status,category_id,listing_type_id';
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      const data = await this.mlFetch(conn.id, `/items?ids=${batch.join(',')}&attributes=${attrs}`).catch(() => []);
      for (const entry of Array.isArray(data) ? data : []) {
        const b = entry?.body;
        if (entry?.code !== 200 || !b?.id) continue;
        // Precio de lista (sin la promoción): con descuento activo ML lo informa en original_price.
        const price = Math.max(Number(b.price) || 0, Number(b.original_price) || 0) || null;
        const fee = price && b.category_id && b.listing_type_id ? await this.fee(String(b.id).slice(0, 3), b.category_id, b.listing_type_id, price) : null;
        const data2 = {
          title: b.title || null, thumbnail: b.secure_thumbnail || b.thumbnail || null, permalink: b.permalink || null,
          categoryId: b.category_id || null, listingTypeId: b.listing_type_id || null, status: b.status || null,
          price, stock: num(b.available_quantity), feePct: fee?.pct ?? null, feeFixed: fee?.fixed ?? null, infoSyncedAt: new Date(),
        };
        await this.prisma.mlItemInfo.upsert({
          where: { connectionId_itemId: { connectionId: conn.id, itemId: String(b.id) } },
          update: data2,
          create: { ...data2, companyId: conn.companyId, connectionId: conn.id, itemId: String(b.id) },
        });
      }
    }
  }

  // Comisión de ML por categoría y tipo de publicación (porcentaje + cargo fijo), en caché 12 h.
  private async fee(site: string, categoryId: string, listingTypeId: string, price: number) {
    const key = `${site}|${categoryId}|${listingTypeId}|${Math.round(price / 1000)}`;
    const hit = this.feeCache.get(key);
    if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit;
    try {
      const res = await fetch(`${ML_API}/sites/${site}/listing_prices?price=${Math.round(price)}&category_id=${categoryId}&listing_type_id=${listingTypeId}`);
      const body: any = await res.json().catch(() => null);
      const row = Array.isArray(body) ? body.find((x: any) => x.listing_type_id === listingTypeId) || body[0] : body;
      const d = row?.sale_fee_details || {};
      const fixed = num(d.fixed_fee) ?? 0;
      let pct = num(d.percentage_fee) ?? num(d.meli_percentage_fee);
      if (pct == null && num(row?.sale_fee_amount) != null) pct = ((Number(row.sale_fee_amount) - fixed) / price) * 100;
      const out = { pct: pct ?? null, fixed, at: Date.now() };
      this.feeCache.set(key, out);
      return out;
    } catch {
      return null;
    }
  }

  // Revisa las promociones de las publicaciones activas, empezando por las que hace más tiempo no se revisan.
  private async syncSomeItems(conn: Conn, max = ITEMS_PER_CRON) {
    const listings = await this.prisma.listing.findMany({
      where: { connectionId: conn.id, externalId: { not: null }, status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] } },
      select: { externalId: true }, distinct: ['externalId'],
    });
    const all = listings.map((l) => l.externalId!) as string[];
    if (!all.length) return;
    const infos = await this.prisma.mlItemInfo.findMany({ where: { connectionId: conn.id, itemId: { in: all } }, select: { itemId: true, promosSyncedAt: true } });
    const known = new Map(infos.map((i) => [i.itemId, i.promosSyncedAt?.getTime() ?? 0]));
    const order = all.sort((a, b) => (known.get(a) ?? -1) - (known.get(b) ?? -1)).slice(0, max);
    await this.refreshItemInfo(conn, order);
    await this.syncItemPromos(conn, order);
  }

  // Avisos de ML (tópicos public_candidates / public_offers): se revisa la publicación afectada.
  async handleWebhook(body: any) {
    const conn = await this.prisma.marketplaceConnection.findFirst({
      where: { marketplace: MarketplaceType.MERCADO_LIBRE, mlUserId: String(body?.user_id || '') },
      select: { id: true, name: true, companyId: true, mlUserId: true },
    });
    if (!conn || integrationsDisabled()) return { received: true };
    try {
      const resource = String(body?.resource || '');
      const data = await this.mlFetch(conn.id, `${resource.startsWith('/') ? '' : '/'}${resource}${resource.includes('?') ? '&' : '?'}app_version=v2`);
      const itemId = data?.item_id ? String(data.item_id) : null;
      if (data?.promotion_id && /candidate/i.test(String(body?.topic))) {
        const exists = await this.prisma.mlPromotion.findUnique({ where: { connectionId_mlId: { connectionId: conn.id, mlId: String(data.promotion_id) } } });
        if (!exists) await this.syncConnection(conn);
      }
      if (itemId) {
        await this.refreshItemInfo(conn, [itemId]);
        await this.syncItemPromos(conn, [itemId]);
      }
    } catch (e: any) {
      this.logger.warn(`Webhook promociones: ${e.message}`);
    }
    return { received: true };
  }

  @Cron('7,37 * * * *')
  async syncAll() {
    if (integrationsDisabled() || this.running) return;
    this.running = true;
    try {
      const conns = await this.prisma.marketplaceConnection.findMany({
        where: { marketplace: MarketplaceType.MERCADO_LIBRE, active: true, syncEnabled: true, mlUserId: { not: null }, company: { active: true } },
        select: { id: true, name: true, companyId: true, mlUserId: true, company: { select: { extraFeatures: true, subscriptionPlan: { select: { features: true } } } } },
      });
      const companies = new Set<string>();
      for (const c of conns) {
        // Solo empresas cuyo plan incluye promociones (sin plan = todo incluido).
        const features = companyPlanFeatures(c.company);
        if (features && !features.includes('ML_PROMOTIONS')) continue;
        try {
          await this.syncConnection(c);
          await this.syncSomeItems(c);
          companies.add(c.companyId);
        } catch (e: any) {
          this.logger.warn(`Promociones ${c.name}: ${e.message}`);
        }
      }
      for (const companyId of companies) await this.runRules(companyId).catch((e) => this.logger.warn(`Reglas de promociones: ${e.message}`));
    } finally {
      this.running = false;
    }
  }

  // ── Consultas ──────────────────────────────────────────────────────────

  // Resumen de las tarjetas del menú. connectionIds (separados por coma) limita a esas cuentas.
  async summary(user: any, q: { companyId?: string; connectionIds?: string }) {
    const where = this.companyWhere(user, q.companyId);
    const conns = await this.connectionsFor(user, q.companyId);
    const ids = q.connectionIds ? String(q.connectionIds).split(',').filter(Boolean) : null;
    const connFilter = ids ? { connectionId: { in: ids } } : {};
    const now = new Date();
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const week = new Date(Date.now() + 7 * 86_400_000);
    const invitationTypes = Object.keys(TYPE_META).filter((t) => TYPE_META[t as PromoType].origin === 'INVITATION');
    const [invitations, urgent, candidates, active, endingSoon, suggestions, rules, last] = await Promise.all([
      this.prisma.mlPromotion.count({ where: { ...where, ...connFilter, status: { not: 'finished' }, type: { in: invitationTypes }, OR: [{ deadlineDate: null }, { deadlineDate: { gt: now } }] } }),
      this.prisma.mlPromotion.count({ where: { ...where, ...connFilter, status: { not: 'finished' }, type: { in: invitationTypes }, deadlineDate: { gt: now, lt: soon } } }),
      this.prisma.mlPromotionItem.count({ where: { ...where, ...connFilter, status: 'candidate', type: { not: 'PRICE_DISCOUNT' } } }),
      this.prisma.mlPromotionItem.count({ where: { ...where, ...connFilter, status: { in: ACTIVE_STATUSES } } }),
      this.prisma.mlPromotionItem.count({ where: { ...where, ...connFilter, status: { in: ACTIVE_STATUSES }, finishDate: { gt: now, lt: week } } }),
      this.prisma.mlPromotionSuggestion.count({ where: { ...where, ...connFilter, status: 'PENDING' } }),
      this.prisma.mlPromotionRule.count({ where: { ...where, active: true } }),
      this.prisma.mlPromotion.findFirst({ where: { ...where, ...connFilter }, orderBy: { syncedAt: { sort: 'desc', nulls: 'last' } }, select: { syncedAt: true } }),
    ]);
    return {
      connections: conns.map((c) => ({ id: c.id, name: c.name })),
      invitations, urgent, candidates, active, endingSoon, suggestions, rules,
      lastSyncAt: last?.syncedAt ?? null,
    };
  }

  // Campañas e invitaciones vigentes con cuántas publicaciones hay en cada estado.
  async campaigns(user: any, q: { companyId?: string; connectionId?: string; scope?: string }) {
    const where: Prisma.MlPromotionWhereInput = { ...this.companyWhere(user, q.companyId), status: { not: 'finished' } };
    if (q.connectionId) where.connectionId = q.connectionId;
    const promos = await this.prisma.mlPromotion.findMany({
      where, orderBy: [{ deadlineDate: { sort: 'asc', nulls: 'last' } }, { finishDate: 'asc' }],
      include: { connection: { select: { id: true, name: true } } },
    });
    const filtered = promos.filter((p) => isPromoType(p.type) && (!q.scope || TYPE_META[p.type as PromoType].origin === q.scope));
    const counts = filtered.length ? await this.prisma.mlPromotionItem.groupBy({
      by: ['connectionId', 'promoKey', 'status'],
      where: { connectionId: { in: Array.from(new Set(filtered.map((p) => p.connectionId))) }, promoKey: { in: filtered.map((p) => p.mlId) } },
      _count: { _all: true },
    }) : [];
    return filtered.map((p) => {
      const c = (st: string[]) => counts.filter((x) => x.connectionId === p.connectionId && x.promoKey === p.mlId && st.includes(x.status)).reduce((s, x) => s + x._count._all, 0);
      return {
        id: p.id, mlId: p.mlId, type: p.type, typeLabel: TYPE_META[p.type as PromoType].label, subType: p.subType, status: p.status, name: p.name,
        startDate: p.startDate, finishDate: p.finishDate, deadlineDate: p.deadlineDate, benefits: p.benefits, createdByUs: p.createdByUs,
        origin: TYPE_META[p.type as PromoType].origin, pricing: TYPE_META[p.type as PromoType].pricing,
        connection: p.connection, candidates: c(['candidate']), active: c(ACTIVE_STATUSES), itemsSyncedAt: p.itemsSyncedAt,
      };
    });
  }

  // Producto del catálogo e info de ML de cada publicación.
  private async contexts(connectionId: string, itemIds: string[]): Promise<Map<string, ItemCtx>> {
    const [infos, listings] = await Promise.all([
      this.prisma.mlItemInfo.findMany({ where: { connectionId, itemId: { in: itemIds } } }),
      this.prisma.listing.findMany({
        where: { connectionId, externalId: { in: itemIds } },
        orderBy: { slot: 'asc' },
        select: {
          externalId: true,
          product: { select: { id: true, name: true, sku: true, cost: true, stock: true, category: true, images: { take: 1, orderBy: { order: 'asc' }, select: { url: true } } } },
        },
      }),
    ]);
    const out = new Map<string, ItemCtx>();
    for (const id of itemIds) out.set(id, { itemId: id, info: null, product: null });
    for (const i of infos) {
      out.get(i.itemId)!.info = {
        title: i.title, thumbnail: i.thumbnail, permalink: i.permalink, price: dec(i.price), stock: i.stock,
        feePct: dec(i.feePct), feeFixed: dec(i.feeFixed), categoryId: i.categoryId, status: i.status,
      };
    }
    for (const l of listings) {
      const ctx = out.get(l.externalId!);
      if (!ctx || ctx.product) continue;
      const p = l.product;
      ctx.product = { id: p.id, name: p.name, sku: p.sku, cost: dec(p.cost), stock: p.stock, category: p.category, image: p.images[0]?.url || null };
    }
    return out;
  }

  private async productsWithSales(productIds: string[], days: number) {
    if (!productIds.length || !days) return new Set<string>();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.saleItem.findMany({
      where: { productId: { in: productIds }, sale: { createdAt: { gte: since } } },
      select: { productId: true }, distinct: ['productId'],
    });
    return new Set(rows.map((r) => r.productId));
  }

  private activeSummary(rows: Array<{ type: string; status: string; price: unknown; originalPrice: unknown; finishDate: Date | null; promoKey: string; promotionMlId: string | null; offerId: string | null }>) {
    return rows.filter((r) => isActiveStatus(r.status)).map((r) => ({
      type: r.type, typeLabel: TYPE_META[r.type as PromoType]?.label || r.type, status: r.status, promoKey: r.promoKey,
      promotionId: r.promotionMlId, offerId: r.offerId, price: dec(r.price), originalPrice: dec(r.originalPrice),
      discountPct: discountPct(dec(r.originalPrice), dec(r.price)), finishDate: r.finishDate,
    }));
  }

  // Filas de una cuenta para el asistente: las de una campaña (promoKey) o todas sus publicaciones activas.
  private async itemRowsFor(conn: Conn, promoKey: string | null, status?: string) {
    let base: Array<{ itemId: string; row: any | null }>;
    if (promoKey) {
      const rows = await this.prisma.mlPromotionItem.findMany({
        where: { connectionId: conn.id, promoKey, status: status ? status : { not: 'finished' } },
        orderBy: { itemId: 'asc' },
      });
      base = rows.map((r) => ({ itemId: r.itemId, row: r }));
    } else {
      const listings = await this.prisma.listing.findMany({
        where: { connectionId: conn.id, externalId: { not: null }, status: ListingStatus.ACTIVE },
        select: { externalId: true }, distinct: ['externalId'], take: 5000,
      });
      base = listings.map((l) => ({ itemId: l.externalId!, row: null }));
      // Candidatura al descuento individual (trae el rango de precios que acepta ML).
      const cands = await this.prisma.mlPromotionItem.findMany({ where: { connectionId: conn.id, promoKey: 'PRICE_DISCOUNT', itemId: { in: base.map((b) => b.itemId) } } });
      const byItem = new Map(cands.map((c) => [c.itemId, c]));
      for (const b of base) b.row = byItem.get(b.itemId) || null;
    }
    const ids = base.map((b) => b.itemId);
    const ctx = await this.contexts(conn.id, ids);
    const allPromos = await this.prisma.mlPromotionItem.findMany({
      where: { connectionId: conn.id, itemId: { in: ids }, status: { in: [...ACTIVE_STATUSES, 'candidate'] } },
      select: { itemId: true, type: true, status: true, price: true, originalPrice: true, finishDate: true, promoKey: true, promotionMlId: true, offerId: true },
    });
    const promosByItem = new Map<string, typeof allPromos>();
    for (const p of allPromos) promosByItem.set(p.itemId, [...(promosByItem.get(p.itemId) || []), p]);

    return base.map(({ itemId, row }) => {
      const c = ctx.get(itemId)!;
      const original = dec(row?.originalPrice) ?? c.info?.price ?? null;
      const promoPrice = row ? dec(row.price) ?? dec(row.suggestedPrice) : null;
      const current = original != null ? estimate({ price: original, cost: c.product?.cost, feePct: c.info?.feePct, feeFixed: c.info?.feeFixed }) : null;
      const atPromo = promoPrice != null ? estimate({ price: promoPrice, originalPrice: original, meliPct: dec(row?.meliPct), cost: c.product?.cost, feePct: c.info?.feePct, feeFixed: c.info?.feeFixed }) : null;
      const others = promosByItem.get(itemId) || [];
      return {
        key: `${conn.id}|${itemId}`,
        itemId,
        connection: { id: conn.id, name: conn.name },
        promotionId: promoKey,
        title: c.info?.title || c.product?.name || itemId,
        thumbnail: c.info?.thumbnail || null,
        permalink: c.info?.permalink || null,
        product: c.product,
        stock: c.product?.stock ?? c.info?.stock ?? null,
        mlStatus: c.info?.status || null,
        originalPrice: original,
        feePct: c.info?.feePct ?? null,
        currentEstimate: current,
        promo: row ? {
          type: row.type, status: row.status, offerId: row.offerId, price: promoPrice, minPrice: dec(row.minPrice), maxPrice: dec(row.maxPrice),
          suggestedPrice: dec(row.suggestedPrice), topPrice: dec(row.topPrice), meliPct: dec(row.meliPct), sellerPct: dec(row.sellerPct),
          stockMin: row.stockMin, stockMax: row.stockMax, discountPct: discountPct(original, promoPrice), boosted: row.boosted,
          boostedPrice: dec(row.boostedPrice), startDate: row.startDate, finishDate: row.finishDate,
        } : null,
        promoEstimate: atPromo,
        activePromos: this.activeSummary(others),
        invitations: others.filter((o) => o.status === 'candidate' && o.type !== 'PRICE_DISCOUNT').length,
      };
    });
  }

  /**
   * Publicaciones para elegir en el asistente, de varias cuentas a la vez.
   * - targets "cuenta:campaña,cuenta:campaña": las publicaciones de esa campaña en cada cuenta
   *   (una misma campaña de ML existe por separado en cada cuenta).
   * - sin targets: todas las publicaciones activas de las cuentas indicadas (connectionIds) o de
   *   todas las cuentas de la empresa (descuento propio).
   * Cada fila trae su cuenta; la clave de selección es "cuenta|publicación".
   */
  async items(user: any, q: {
    companyId?: string; connectionIds?: string; targets?: string; account?: string; status?: string; search?: string; category?: string;
    minStock?: string; maxStock?: string; minMargin?: string; noSalesDays?: string; promo?: string; page?: string; pageSize?: string; productIds?: string;
  }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize) || 50));
    const search = String(q.search || '').trim().toLowerCase();
    // Productos elegidos en el catálogo ("Poner en promoción").
    const onlyProducts = q.productIds ? new Set(String(q.productIds).split(',').filter(Boolean)) : null;
    const pairs: Array<{ conn: Conn; promoKey: string | null }> = [];
    if (q.targets) {
      for (const t of String(q.targets).split(',').filter(Boolean)) {
        const [connectionId, ...rest] = t.split(':');
        pairs.push({ conn: await this.connectionFor(user, connectionId), promoKey: rest.join(':') || null });
      }
    } else {
      const ids = q.connectionIds ? String(q.connectionIds).split(',').filter(Boolean) : null;
      const conns = ids ? await Promise.all(ids.map((id) => this.connectionFor(user, id))) : await this.connectionsFor(user, q.companyId);
      for (const conn of conns) pairs.push({ conn, promoKey: null });
    }
    const campaignMode = pairs.some((x) => x.promoKey);
    const rows = (await Promise.all(pairs.map((x) => this.itemRowsFor(x.conn, x.promoKey, q.status)))).flat();

    const noSalesDays = Number(q.noSalesDays) || 0;
    const withSales = await this.productsWithSales(Array.from(new Set(rows.map((r) => r.product?.id).filter(Boolean))) as string[], noSalesDays);
    const minStock = q.minStock !== undefined && q.minStock !== '' ? Number(q.minStock) : null;
    const maxStock = q.maxStock !== undefined && q.maxStock !== '' ? Number(q.maxStock) : null;
    const minMargin = q.minMargin !== undefined && q.minMargin !== '' ? Number(q.minMargin) : null;
    const filtered = rows.filter((r) => {
      if (q.account && r.connection.id !== q.account) return false;
      if (search && !`${r.title} ${r.product?.name || ''} ${r.product?.sku || ''} ${r.itemId}`.toLowerCase().includes(search)) return false;
      if (onlyProducts && !(r.product && onlyProducts.has(r.product.id))) return false;
      if (q.category && (r.product?.category || '') !== q.category) return false;
      if (minStock != null && (r.stock ?? 0) < minStock) return false;
      if (maxStock != null && (r.stock ?? 0) > maxStock) return false;
      const margin = (campaignMode ? r.promoEstimate : r.currentEstimate)?.marginPct;
      if (minMargin != null && (margin == null || margin < minMargin)) return false;
      if (noSalesDays && r.product && withSales.has(r.product.id)) return false;
      if (q.promo === 'none' && r.activePromos.length) return false;
      if (q.promo === 'active' && !r.activePromos.length) return false;
      if (q.promo === 'invited' && !r.invitations) return false;
      if (q.promo === 'nocost' && r.product?.cost) return false;
      return true;
    });
    // El mismo producto queda junto en sus distintas cuentas.
    filtered.sort((a, b) => (a.product?.name || a.title).localeCompare(b.product?.name || b.title) || a.connection.name.localeCompare(b.connection.name));
    const categories = Array.from(new Set(rows.map((r) => r.product?.category).filter(Boolean))).sort() as string[];
    return {
      total: filtered.length,
      page, pageSize,
      categories,
      rows: filtered.slice((page - 1) * pageSize, page * pageSize),
      // Claves de todo el resultado filtrado, para "seleccionar todos".
      allIds: filtered.map((r) => r.key),
    };
  }

  // "Mis promociones": publicaciones con promoción activa o programada.
  async active(user: any, q: { companyId?: string; connectionId?: string; type?: string; search?: string }) {
    const where: Prisma.MlPromotionItemWhereInput = { ...this.companyWhere(user, q.companyId), status: { in: ACTIVE_STATUSES } };
    if (q.connectionId) where.connectionId = q.connectionId;
    if (q.type) where.type = q.type;
    const rows = await this.prisma.mlPromotionItem.findMany({
      where, orderBy: [{ finishDate: { sort: 'asc', nulls: 'last' } }], take: 2000,
      include: { connection: { select: { id: true, name: true } } },
    });
    const byConn = new Map<string, string[]>();
    for (const r of rows) byConn.set(r.connectionId, [...(byConn.get(r.connectionId) || []), r.itemId]);
    const ctxs = new Map<string, ItemCtx>();
    for (const [cid, ids] of byConn) for (const [k, v] of await this.contexts(cid, ids)) ctxs.set(`${cid}|${k}`, v);
    const promoNames = new Map((await this.prisma.mlPromotion.findMany({
      where: { mlId: { in: rows.map((r) => r.promotionMlId).filter(Boolean) as string[] } }, select: { mlId: true, name: true },
    })).map((p) => [p.mlId, p.name]));
    const search = String(q.search || '').trim().toLowerCase();
    return rows.map((r) => {
      const c = ctxs.get(`${r.connectionId}|${r.itemId}`);
      const original = dec(r.originalPrice) ?? c?.info?.price ?? null;
      const price = dec(r.price);
      const meta = TYPE_META[r.type as PromoType];
      return {
        id: r.id, itemId: r.itemId, connection: r.connection, type: r.type, typeLabel: meta?.label || r.type, status: r.status,
        promotionId: r.promotionMlId, promotionName: r.promotionMlId ? promoNames.get(r.promotionMlId) || null : null, offerId: r.offerId,
        title: c?.info?.title || c?.product?.name || r.itemId, thumbnail: c?.info?.thumbnail || null, permalink: c?.info?.permalink || null, product: c?.product || null,
        price, originalPrice: original, topPrice: dec(r.topPrice), discountPct: discountPct(original, price), meliPct: dec(r.meliPct),
        boosted: r.boosted, boostedPrice: dec(r.boostedPrice), startDate: r.startDate, finishDate: r.finishDate,
        estimate: price != null ? estimate({ price, originalPrice: original, meliPct: dec(r.meliPct), cost: c?.product?.cost, feePct: c?.info?.feePct, feeFixed: c?.info?.feeFixed }) : null,
        removable: !(meta?.lockedWhenStarted && r.status === 'started'),
      };
    }).filter((r) => !search || `${r.title} ${r.product?.sku || ''} ${r.itemId}`.toLowerCase().includes(search));
  }

  // Promociones de un producto (ficha del catálogo).
  async forProduct(user: any, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { companyId: true } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();
    const listings = await this.prisma.listing.findMany({
      where: { productId, externalId: { not: null }, connection: { marketplace: MarketplaceType.MERCADO_LIBRE } },
      select: { externalId: true, connectionId: true, connection: { select: { name: true } } },
    });
    const out: Array<{ connection: string; connectionId: string; itemId: string; active: ReturnType<MlPromotionsService['activeSummary']>; invitations: number }> = [];
    for (const l of listings) {
      const rows = await this.prisma.mlPromotionItem.findMany({
        where: { connectionId: l.connectionId, itemId: l.externalId!, status: { in: [...ACTIVE_STATUSES, 'candidate'] } },
        select: { type: true, status: true, price: true, originalPrice: true, finishDate: true, promoKey: true, promotionMlId: true, offerId: true },
      });
      out.push({
        connection: l.connection.name, connectionId: l.connectionId, itemId: l.externalId!, active: this.activeSummary(rows),
        invitations: rows.filter((r) => r.status === 'candidate' && r.type !== 'PRICE_DISCOUNT').length,
      });
    }
    return out;
  }

  // Descuento activo por producto (etiqueta "En promo" del catálogo).
  async activeByProducts(user: any, productIds: string[]) {
    const ids = productIds.slice(0, 500);
    if (!ids.length) return {};
    const listings = await this.prisma.listing.findMany({
      where: { productId: { in: ids }, externalId: { not: null }, connection: { marketplace: MarketplaceType.MERCADO_LIBRE, ...this.companyWhere(user) } },
      select: { productId: true, externalId: true, connectionId: true },
    });
    if (!listings.length) return {};
    const rows = await this.prisma.mlPromotionItem.findMany({
      where: { OR: listings.map((l) => ({ connectionId: l.connectionId, itemId: l.externalId! })), status: { in: ACTIVE_STATUSES } },
      select: { connectionId: true, itemId: true, price: true, originalPrice: true, status: true, type: true },
    });
    const out: Record<string, { discountPct: number | null; status: string; type: string; count: number }> = {};
    for (const r of rows) {
      for (const l of listings.filter((x) => x.connectionId === r.connectionId && x.externalId === r.itemId)) {
        const pct = discountPct(dec(r.originalPrice), dec(r.price));
        const cur = out[l.productId];
        if (!cur || (pct ?? 0) > (cur.discountPct ?? 0)) out[l.productId] = { discountPct: pct, status: r.status, type: r.type, count: (cur?.count || 0) + 1 };
        else cur.count += 1;
      }
    }
    return out;
  }

  // ── Vista previa y aplicación ──────────────────────────────────────────

  /**
   * Vista previa en varias cuentas. targets: [{ connectionId, promotionId?, itemIds }]. Con
   * allAccounts (descuento individual) se suma el mismo producto en las demás cuentas donde está
   * publicado. manualPrices usa la clave "cuenta|publicación".
   */
  async preview(user: any, dto: {
    type: string; targets: Array<{ connectionId: string; promotionId?: string | null; itemIds: string[] }>; mode?: PriceMode; percent?: number;
    minMarginPct?: number; manualPrices?: Record<string, number>; loyaltyExtraPts?: number; stock?: number; allAccounts?: boolean;
  }) {
    if (!isPromoType(dto.type)) throw new BadRequestException('Tipo de promoción no válido');
    const type = dto.type;
    let targets = (dto.targets || []).filter((t) => t?.connectionId && t.itemIds?.length);
    if (!targets.length) throw new BadRequestException('Elige al menos una publicación');
    if (dto.allAccounts && type === 'PRICE_DISCOUNT') targets = await this.expandToAllAccounts(user, targets);
    let total = 0;
    const rows: any[] = [];
    for (const t of targets) {
      const conn = await this.connectionFor(user, t.connectionId);
      const ids = Array.from(new Set(t.itemIds.map(String))).slice(0, 1000 - total);
      total += ids.length;
      rows.push(...(await this.previewTarget(conn, type, t.promotionId || null, ids, dto)));
      if (total >= 1000) break;
    }
    const ok = rows.filter((r) => r.status !== 'error');
    const withMargin = ok.filter((r) => r.estimate?.marginPct != null);
    return {
      rows,
      totals: {
        ok: rows.filter((r) => r.status === 'ok').length,
        warn: rows.filter((r) => r.status === 'warn').length,
        error: rows.filter((r) => r.status === 'error').length,
        avgDiscount: ok.length ? Math.round(ok.reduce((s, r) => s + (r.discountPct || 0), 0) / ok.length * 10) / 10 : null,
        avgMargin: withMargin.length ? Math.round(withMargin.reduce((s, r) => s + r.estimate.marginPct, 0) / withMargin.length * 10) / 10 : null,
      },
    };
  }

  // El mismo producto en las demás cuentas de ML de la empresa donde está publicado (activo).
  private async expandToAllAccounts(user: any, targets: Array<{ connectionId: string; promotionId?: string | null; itemIds: string[] }>) {
    const first = await this.connectionFor(user, targets[0].connectionId);
    const listings = await this.prisma.listing.findMany({
      where: { OR: targets.map((t) => ({ connectionId: t.connectionId, externalId: { in: t.itemIds } })) },
      select: { productId: true },
    });
    const productIds = Array.from(new Set(listings.map((l) => l.productId)));
    const all = await this.prisma.listing.findMany({
      where: {
        productId: { in: productIds }, externalId: { not: null }, status: ListingStatus.ACTIVE,
        connection: { companyId: first.companyId, marketplace: MarketplaceType.MERCADO_LIBRE, active: true },
      },
      select: { connectionId: true, externalId: true },
    });
    const byConn = new Map<string, Set<string>>();
    for (const t of targets) byConn.set(t.connectionId, new Set(t.itemIds));
    for (const l of all) {
      if (!byConn.has(l.connectionId)) byConn.set(l.connectionId, new Set());
      byConn.get(l.connectionId)!.add(l.externalId!);
    }
    return Array.from(byConn.entries()).map(([connectionId, ids]) => ({ connectionId, promotionId: null, itemIds: Array.from(ids) }));
  }

  private async previewTarget(conn: Conn, type: PromoType, promotionId: string | null, ids: string[], dto: {
    mode?: PriceMode; percent?: number; minMarginPct?: number; manualPrices?: Record<string, number>; loyaltyExtraPts?: number; stock?: number;
  }) {
    await this.refreshItemInfo(conn, ids).catch(() => {});
    const key = promoKeyOf(type, promotionId);
    const promoRows = await this.prisma.mlPromotionItem.findMany({ where: { connectionId: conn.id, itemId: { in: ids }, promoKey: key } });
    const byItem = new Map(promoRows.map((r) => [r.itemId, r]));
    const otherActive = await this.prisma.mlPromotionItem.findMany({
      where: { connectionId: conn.id, itemId: { in: ids }, status: { in: ACTIVE_STATUSES }, promoKey: { not: key } }, select: { itemId: true, type: true },
    });
    const ctx = await this.contexts(conn.id, ids);
    const meta = TYPE_META[type];
    return ids.map((itemId) => {
      const rowKey = `${conn.id}|${itemId}`;
      const c = ctx.get(itemId)!;
      const row = byItem.get(itemId);
      const original = dec(row?.originalPrice) ?? c.info?.price ?? null;
      const manual = dto.manualPrices?.[rowKey];
      const p = propose({
        type, originalPrice: original, minPrice: dec(row?.minPrice), maxPrice: dec(row?.maxPrice), suggestedPrice: dec(row?.suggestedPrice),
        mlPrice: dec(row?.price), meliPct: dec(row?.meliPct), cost: c.product?.cost, feePct: c.info?.feePct, feeFixed: c.info?.feeFixed,
        // Un precio escrito a mano en la vista previa manda sobre la regla.
        mode: manual != null ? 'MANUAL' : dto.mode || 'PERCENT', percent: dto.percent, minMarginPct: dto.minMarginPct ?? null, manualPrice: manual,
      });
      const messages = [...p.messages];
      let status = p.status;
      if (meta.origin === 'INVITATION' && !row) { messages.unshift('La publicación no está invitada a esta promoción'); status = 'error'; }
      if (row && isActiveStatus(row.status)) { messages.unshift('Ya participa en esta promoción'); if (status !== 'error') status = 'warn'; }
      if (row && meta.offer && !row.offerId) { messages.push('Mercado Libre no informó la invitación (offer_id)'); status = 'error'; }
      const others = otherActive.filter((o) => o.itemId === itemId);
      if (others.length) messages.push(`También está en: ${others.map((o) => TYPE_META[o.type as PromoType]?.label || o.type).join(', ')} (ML aplica el mejor precio)`);
      if (c.info?.status && c.info.status !== 'active') { messages.push('La publicación no está activa en ML'); status = 'error'; }
      let topPrice: number | null = null;
      if (meta.top && dto.loyaltyExtraPts && p.price && original) {
        const t = topPriceFor(original, p.price, dto.loyaltyExtraPts);
        if (t.error) { messages.push(t.error); if (status === 'ok') status = 'warn'; } else topPrice = t.topPrice;
      }
      let stock: number | null = null;
      if (meta.stock) {
        const available = c.product?.stock ?? c.info?.stock ?? 0;
        const want = dto.stock || row?.stockMin || 1;
        stock = Math.min(Math.max(want, row?.stockMin || 1), row?.stockMax || want, available);
        if (stock < (row?.stockMin || 1)) { messages.push(`Stock insuficiente: ML pide al menos ${row?.stockMin || 1} unidades`); status = 'error'; }
      }
      return {
        key: rowKey, itemId, connection: { id: conn.id, name: conn.name }, promotionId,
        title: c.info?.title || c.product?.name || itemId, thumbnail: c.info?.thumbnail || null, product: c.product,
        originalPrice: original, price: p.price, topPrice, stock, discountPct: p.discountPct, offerId: row?.offerId || null,
        minPrice: dec(row?.minPrice), maxPrice: dec(row?.maxPrice), meliPct: dec(row?.meliPct),
        estimate: p.estimate, status, messages,
      };
    });
  }

  // Aplica en varias cuentas: un trabajo en segundo plano por cuenta.
  async applyMany(user: any, dto: { type: string; startDate?: string; days?: number; targets: Array<{ connectionId: string; promotionId?: string | null; items: ApplyItem[] }> }) {
    const targets = (dto.targets || []).filter((t) => t?.connectionId && t.items?.length);
    if (!targets.length) throw new BadRequestException('No hay publicaciones para aplicar');
    const jobs: any[] = [];
    for (const t of targets) {
      jobs.push(await this.apply(user, { connectionId: t.connectionId, type: dto.type, promotionId: t.promotionId || undefined, startDate: dto.startDate, days: dto.days, items: t.items }));
    }
    return { jobs };
  }

  // Aplica en una cuenta en segundo plano: devuelve el trabajo y se consulta su avance con job().
  async apply(user: any, dto: { connectionId: string; type: string; promotionId?: string; startDate?: string; days?: number; items: ApplyItem[] }) {
    const conn = await this.connectionFor(user, dto.connectionId);
    if (integrationsDisabled()) throw new BadRequestException('Integraciones desactivadas en este servidor');
    if (!isPromoType(dto.type)) throw new BadRequestException('Tipo de promoción no válido');
    const type = dto.type;
    const items = (dto.items || []).filter((i) => i?.itemId).slice(0, 1000);
    if (!items.length) throw new BadRequestException('No hay publicaciones para aplicar');
    let startDate: string | null = null;
    let finishDate: string | null = null;
    if (type === 'PRICE_DISCOUNT') {
      startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dto.startDate || '')) ? String(dto.startDate) : today();
      if (startDate < today()) startDate = today();
      const days = Math.min(MAX_OWN_DAYS, Math.max(1, Math.round(Number(dto.days) || 7)));
      finishDate = addDays(startDate, days - 1);
    }
    const promo = dto.promotionId ? await this.prisma.mlPromotion.findUnique({ where: { connectionId_mlId: { connectionId: conn.id, mlId: dto.promotionId } } }) : null;
    const title = `${TYPE_META[type].label}${promo?.name ? ` · ${promo.name}` : ''} · ${conn.name}`;
    return this.startJob(user, conn, 'APPLY', title, type, dto.promotionId || null, items.map((i) => ({ ...i, startDate, finishDate })));
  }

  async remove(user: any, dto: { connectionId: string; entries: RemoveEntry[] }) {
    const conn = await this.connectionFor(user, dto.connectionId);
    if (integrationsDisabled()) throw new BadRequestException('Integraciones desactivadas en este servidor');
    const entries = (dto.entries || []).filter((e) => e?.itemId && isPromoType(e.type)).slice(0, 1000);
    if (!entries.length) throw new BadRequestException('No hay promociones para quitar');
    const types = Array.from(new Set(entries.map((e) => e.type)));
    const title = `Quitar ${types.length === 1 ? TYPE_META[types[0]].label.toLowerCase() : 'promociones'}`;
    return this.startJob(user, conn, 'REMOVE', title, types.length === 1 ? types[0] : null, null, entries);
  }

  private async startJob(user: any, conn: Conn, kind: 'APPLY' | 'REMOVE', title: string, type: PromoType | null, promotionId: string | null, entries: any[]) {
    const job = await this.prisma.mlPromotionJob.create({
      data: {
        companyId: conn.companyId, connectionId: conn.id, kind, title, type, promotionMlId: promotionId,
        total: entries.length, createdByName: user?.name || user?.email || null,
      },
    });
    void this.runJob(job.id, conn, kind, type, promotionId, entries).catch(async (e) => {
      this.logger.error(`Trabajo de promociones ${job.id}: ${e.message}`);
      await this.prisma.mlPromotionJob.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date() } }).catch(() => {});
    });
    return job;
  }

  private async runJob(jobId: string, conn: Conn, kind: 'APPLY' | 'REMOVE', type: PromoType | null, promotionId: string | null, entries: any[]) {
    const results: JobResult[] = [];
    const ctx = await this.contexts(conn.id, entries.map((e) => e.itemId));
    let done = 0, ok = 0, failed = 0;
    const promoRows = new Map((await this.prisma.mlPromotionItem.findMany({
      where: { connectionId: conn.id, itemId: { in: entries.map((e) => e.itemId) }, ...(type ? { promoKey: promoKeyOf(type, promotionId) } : {}) },
    })).map((r) => [`${r.itemId}|${r.promoKey}`, r]));

    await pool(entries, JOB_CONCURRENCY, async (e) => {
      const c = ctx.get(e.itemId);
      const title = c?.info?.title || c?.product?.name || e.itemId;
      try {
        if (kind === 'APPLY') {
          const t = type!;
          const key = promoKeyOf(t, promotionId);
          const row = promoRows.get(`${e.itemId}|${key}`);
          const input = {
            type: t, promotionId, offerId: e.offerId || row?.offerId || null, price: num(e.price) ?? (TYPE_META[t].pricing === 'ML' ? dec(row?.price) : null),
            topPrice: num(e.topPrice), stock: num(e.stock), startDate: e.startDate, finishDate: e.finishDate,
          };
          const invalid = validateApply({ ...input, originalPrice: dec(row?.originalPrice) ?? c?.info?.price ?? null, stockAvailable: c?.product?.stock ?? null, stockMin: row?.stockMin, stockMax: row?.stockMax });
          if (invalid) throw new Error(invalid);
          const res = await this.mlFetch(conn.id, `/seller-promotions/items/${e.itemId}?app_version=v2`, { method: 'POST', body: JSON.stringify(addPayload(input)) });
          const price = num(res?.price) ?? input.price;
          const started = !input.startDate || input.startDate <= today();
          await this.prisma.mlPromotionItem.upsert({
            where: { connectionId_itemId_promoKey: { connectionId: conn.id, itemId: e.itemId, promoKey: key } },
            update: { status: started ? 'started' : 'pending', price, topPrice: num(res?.top_price) ?? input.topPrice, offerId: res?.offer_id || input.offerId, syncedAt: new Date() },
            create: {
              companyId: conn.companyId, connectionId: conn.id, itemId: e.itemId, promoKey: key, type: t, promotionMlId: promotionId,
              status: started ? 'started' : 'pending', price, originalPrice: num(res?.original_price) ?? c?.info?.price ?? null,
              topPrice: input.topPrice, offerId: res?.offer_id || input.offerId,
              startDate: input.startDate ? new Date(`${input.startDate}T03:00:00Z`) : null, finishDate: input.finishDate ? new Date(`${input.finishDate}T23:59:59-03:00`) : null,
            },
          });
          if (e.suggestionId) await this.prisma.mlPromotionSuggestion.update({ where: { id: e.suggestionId }, data: { status: 'APPLIED', error: null } }).catch(() => {});
          results.push({ itemId: e.itemId, title, ok: true, price });
        } else {
          await this.mlFetch(conn.id, `/seller-promotions/items/${e.itemId}?${deleteQuery({ type: e.type, promotionId: e.promotionId, offerId: e.offerId })}`, { method: 'DELETE' });
          await this.prisma.mlPromotionItem.updateMany({
            where: { connectionId: conn.id, itemId: e.itemId, promoKey: promoKeyOf(e.type, e.promotionId) },
            data: { status: TYPE_META[e.type as PromoType].origin === 'INVITATION' ? 'candidate' : 'finished' },
          });
          results.push({ itemId: e.itemId, title, ok: true });
        }
        ok++;
      } catch (err: any) {
        failed++;
        const error = friendlyError(err.message);
        if (e.suggestionId) await this.prisma.mlPromotionSuggestion.update({ where: { id: e.suggestionId }, data: { status: 'FAILED', error } }).catch(() => {});
        results.push({ itemId: e.itemId, title, ok: false, error });
      }
      done++;
      if (done % 5 === 0 || done === entries.length) {
        await this.prisma.mlPromotionJob.update({ where: { id: jobId }, data: { done, ok, failed, results: results as unknown as Prisma.InputJsonValue } }).catch(() => {});
      }
    });
    await this.prisma.mlPromotionJob.update({
      where: { id: jobId },
      data: { status: 'DONE', done, ok, failed, results: results as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
    });
    // Estado real según ML (precio final, bonificación extra, programada o activa).
    const touched = results.filter((r) => r.ok).map((r) => r.itemId);
    if (touched.length) {
      void (async () => {
        await sleep(5000);
        await this.syncItemPromos(conn, touched);
        if (kind === 'REMOVE') await this.requeuePrices(conn.id, touched);
      })().catch(() => {});
    }
  }

  async job(user: any, id: string) {
    const job = await this.prisma.mlPromotionJob.findUnique({ where: { id }, include: { connection: { select: { name: true } } } });
    if (!job) throw new NotFoundException('Aplicación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && job.companyId !== user.companyId) throw new ForbiddenException();
    return job;
  }

  async jobs(user: any, q: { companyId?: string; connectionId?: string }) {
    return this.prisma.mlPromotionJob.findMany({
      where: { ...this.companyWhere(user, q.companyId), ...(q.connectionId ? { connectionId: q.connectionId } : {}) },
      orderBy: { createdAt: 'desc' }, take: 50,
      include: { connection: { select: { name: true } } },
    });
  }

  // ── Campañas propias ───────────────────────────────────────────────────

  async createCampaign(user: any, dto: {
    connectionId: string; type: 'SELLER_CAMPAIGN' | 'VOLUME'; name: string; startDate: string; days?: number;
    subType?: 'BNGM' | 'BNSP' | 'SPONTH'; buyQuantity?: number; payQuantity?: number; discountPercentage?: number; allowCombination?: boolean;
  }) {
    const conn = await this.connectionFor(user, dto.connectionId);
    if (integrationsDisabled()) throw new BadRequestException('Integraciones desactivadas en este servidor');
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Ponle un nombre a la campaña');
    let start = /^\d{4}-\d{2}-\d{2}$/.test(String(dto.startDate || '')) ? String(dto.startDate) : today();
    if (start < today()) start = today();
    const maxDays = dto.type === 'SELLER_CAMPAIGN' ? MAX_OWN_DAYS : 60;
    const days = Math.min(maxDays, Math.max(1, Math.round(Number(dto.days) || 7)));
    const finish = addDays(start, days - 1);
    const body: Record<string, unknown> = { promotion_type: dto.type, name, start_date: `${start}T00:00:00`, finish_date: `${finish}T00:00:00` };
    if (dto.type === 'SELLER_CAMPAIGN') {
      body.sub_type = 'FLEXIBLE_PERCENTAGE';
    } else if (dto.type === 'VOLUME') {
      const sub = dto.subType || 'BNGM';
      body.sub_type = sub;
      body.allow_combination = !!dto.allowCombination;
      const buy = Math.round(Number(dto.buyQuantity) || 0);
      if (buy < 2) throw new BadRequestException('La cantidad a comprar debe ser 2 o más');
      body.buy_quantity = buy;
      if (sub === 'BNGM') {
        const pay = Math.round(Number(dto.payQuantity) || 0);
        if (pay < 1 || pay >= buy) throw new BadRequestException('Lo que se paga debe ser menor a lo que se lleva (ej.: lleva 3, paga 2)');
        body.pay_quantity = pay;
      } else {
        const pct = Number(dto.discountPercentage) || 0;
        if (pct <= 0 || pct > 70) throw new BadRequestException('El descuento debe estar entre 1% y 70%');
        body.discount_percentage = pct;
      }
    } else {
      throw new BadRequestException('Tipo de campaña no válido');
    }
    let res: any;
    try {
      res = await this.mlFetch(conn.id, '/seller-promotions/promotions?app_version=v2', { method: 'POST', body: JSON.stringify(body) });
    } catch (e: any) {
      throw new BadRequestException(friendlyError(e.message));
    }
    if (!res?.id) throw new BadRequestException('Mercado Libre no devolvió la campaña creada');
    const promo = await this.prisma.mlPromotion.upsert({
      where: { connectionId_mlId: { connectionId: conn.id, mlId: String(res.id) } },
      update: {},
      create: {
        companyId: conn.companyId, connectionId: conn.id, mlId: String(res.id), type: dto.type, subType: res.sub_type || String(body.sub_type),
        status: res.status || 'pending', name: res.name || name, startDate: toDate(res.start_date), finishDate: toDate(res.finish_date),
        benefits: dto.type === 'VOLUME' ? (body as Prisma.InputJsonValue) : undefined, createdByUs: true, syncedAt: new Date(),
      },
    });
    await this.syncPromotionItems(conn, promo).catch((e) => this.logger.warn(`Campaña ${promo.mlId}: ${e.message}`));
    return promo;
  }

  async deleteCampaign(user: any, id: string) {
    const promo = await this.prisma.mlPromotion.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Campaña no encontrada');
    if (user.role !== Role.SUPER_ADMIN && promo.companyId !== user.companyId) throw new ForbiddenException();
    if (!['SELLER_CAMPAIGN', 'VOLUME'].includes(promo.type)) throw new BadRequestException('Solo se pueden eliminar las campañas propias');
    try {
      await this.mlFetch(promo.connectionId, `/seller-promotions/promotions/${encodeURIComponent(promo.mlId)}?promotion_type=${promo.type}&app_version=v2`, { method: 'DELETE' });
    } catch (e: any) {
      throw new BadRequestException(friendlyError(e.message));
    }
    await this.prisma.mlPromotion.update({ where: { id }, data: { status: 'finished' } });
    const items = await this.prisma.mlPromotionItem.findMany({ where: { connectionId: promo.connectionId, promoKey: promo.mlId, status: { in: ACTIVE_STATUSES } }, select: { itemId: true } });
    await this.prisma.mlPromotionItem.updateMany({ where: { connectionId: promo.connectionId, promoKey: promo.mlId }, data: { status: 'finished' } });
    if (items.length) await this.requeuePrices(promo.connectionId, items.map((i) => i.itemId));
    return { ok: true };
  }

  // ── Reglas (solo sugieren) ─────────────────────────────────────────────

  async listRules(user: any, companyId?: string) {
    const rules = await this.prisma.mlPromotionRule.findMany({ where: this.companyWhere(user, companyId), orderBy: { createdAt: 'asc' } });
    const counts = rules.length ? await this.prisma.mlPromotionSuggestion.groupBy({
      by: ['ruleId', 'status'], where: { ruleId: { in: rules.map((r) => r.id) } }, _count: { _all: true },
    }) : [];
    return rules.map((r) => ({
      ...r,
      pending: counts.filter((c) => c.ruleId === r.id && c.status === 'PENDING').reduce((s, c) => s + c._count._all, 0),
      applied: counts.filter((c) => c.ruleId === r.id && c.status === 'APPLIED').reduce((s, c) => s + c._count._all, 0),
    }));
  }

  private checkRule(dto: any) {
    const kind = dto.kind === 'DISCOUNT' ? 'DISCOUNT' : 'INVITATIONS';
    const n = (v: unknown, lo: number, hi: number) => {
      const x = num(v);
      return x == null ? null : Math.min(hi, Math.max(lo, x));
    };
    const c = dto.config || {};
    const common = {
      minMarginPct: n(c.minMarginPct, 0, 90) ?? 10,
      categories: (Array.isArray(c.categories) ? c.categories : []).map(String).filter(Boolean).slice(0, 50),
      excludeProductIds: (Array.isArray(c.excludeProductIds) ? c.excludeProductIds : []).map(String).filter(Boolean).slice(0, 500),
      excludeLabels: c.excludeLabels && typeof c.excludeLabels === 'object' ? Object.fromEntries(Object.entries(c.excludeLabels).slice(0, 500).map(([k, v]) => [String(k), String(v).slice(0, 120)])) : {},
    };
    let config: Record<string, unknown>;
    if (kind === 'INVITATIONS') {
      const types = (Array.isArray(c.types) ? c.types : RULE_INVITATION_TYPES).filter((t: string) => RULE_INVITATION_TYPES.includes(t as PromoType));
      if (!types.length) throw new BadRequestException('Elige al menos un tipo de invitación');
      config = { ...common, types, maxDiscountPct: n(c.maxDiscountPct, 1, 80) ?? 30, minMeliPct: n(c.minMeliPct, 0, 100), priceMode: c.priceMode === 'BEST_MARGIN' ? 'BEST_MARGIN' : 'SUGGESTED' };
    } else {
      const discountPct2 = n(c.discountPct, 5, 80);
      if (!discountPct2) throw new BadRequestException('Indica el porcentaje de descuento (entre 5% y 80%)');
      config = { ...common, discountPct: discountPct2, durationDays: n(c.durationDays, 1, MAX_OWN_DAYS) ?? 7, minStock: n(c.minStock, 0, 1_000_000) ?? 1, noSalesDays: n(c.noSalesDays, 0, 365) ?? 30 };
    }
    return {
      name: String(dto.name || '').trim() || (kind === 'INVITATIONS' ? 'Invitaciones convenientes' : 'Liquidar productos sin ventas'),
      active: dto.active !== false, kind, connectionId: dto.connectionId || null, config: config as Prisma.InputJsonValue,
    };
  }

  async createRule(user: any, dto: any) {
    const companyId = user.role === Role.SUPER_ADMIN ? dto.companyId : user.companyId;
    if (!companyId) throw new BadRequestException('Selecciona una empresa');
    if (dto.connectionId) await this.connectionFor(user, dto.connectionId);
    const rule = await this.prisma.mlPromotionRule.create({ data: { ...this.checkRule(dto), companyId } });
    await this.runRules(companyId, rule.id).catch((e) => this.logger.warn(`Regla ${rule.id}: ${e.message}`));
    return rule;
  }

  async updateRule(user: any, id: string, dto: any) {
    const rule = await this.prisma.mlPromotionRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Regla no encontrada');
    if (user.role !== Role.SUPER_ADMIN && rule.companyId !== user.companyId) throw new ForbiddenException();
    const data = this.checkRule({ ...rule, ...dto, config: dto.config ?? rule.config });
    const updated = await this.prisma.mlPromotionRule.update({ where: { id }, data });
    // Las sugerencias pendientes se recalculan con la regla nueva.
    await this.prisma.mlPromotionSuggestion.updateMany({ where: { ruleId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    if (updated.active) await this.runRules(rule.companyId, id).catch((e) => this.logger.warn(`Regla ${id}: ${e.message}`));
    return updated;
  }

  async deleteRule(user: any, id: string) {
    const rule = await this.prisma.mlPromotionRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Regla no encontrada');
    if (user.role !== Role.SUPER_ADMIN && rule.companyId !== user.companyId) throw new ForbiddenException();
    await this.prisma.mlPromotionRule.delete({ where: { id } });
    return { ok: true };
  }

  // Genera sugerencias (nunca aplica). Topes de seguridad: costo cargado obligatorio, margen
  // mínimo, descuento máximo, publicación activa y sin otra promoción en curso del mismo tipo.
  async runRules(companyId: string, onlyRuleId?: string) {
    await this.expireSuggestions(companyId);
    const rules = await this.prisma.mlPromotionRule.findMany({ where: { companyId, active: true, ...(onlyRuleId ? { id: onlyRuleId } : {}) } });
    for (const rule of rules) {
      const conns = await this.prisma.marketplaceConnection.findMany({
        where: { companyId, marketplace: MarketplaceType.MERCADO_LIBRE, active: true, mlUserId: { not: null }, ...(rule.connectionId ? { id: rule.connectionId } : {}) },
        select: { id: true, name: true, companyId: true, mlUserId: true },
      });
      let created = 0;
      for (const conn of conns) {
        if (created >= MAX_SUGGESTIONS_PER_RULE) break;
        created += rule.kind === 'DISCOUNT'
          ? await this.suggestDiscounts(rule, conn, MAX_SUGGESTIONS_PER_RULE - created)
          : await this.suggestInvitations(rule, conn, MAX_SUGGESTIONS_PER_RULE - created);
      }
      await this.prisma.mlPromotionRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
    }
  }

  private passesFilters(cfg: any, ctx: ItemCtx) {
    if (!ctx.product) return 'Publicación sin producto del catálogo';
    if ((cfg.excludeProductIds || []).includes(ctx.product.id)) return 'Producto excluido';
    if ((cfg.categories || []).length && !(cfg.categories as string[]).includes(ctx.product.category || '')) return 'Fuera de las categorías';
    if (!ctx.product.cost || ctx.product.cost <= 0) return 'Sin costo cargado';
    if (ctx.info?.status && ctx.info.status !== 'active') return 'Publicación no activa';
    return null;
  }

  private async existingKeys(ruleId: string, connectionId: string, statuses: string[], since?: Date) {
    const rows = await this.prisma.mlPromotionSuggestion.findMany({
      where: { ruleId, connectionId, status: { in: statuses }, ...(since ? { updatedAt: { gte: since } } : {}) }, select: { itemId: true, promoKey: true },
    });
    return new Set(rows.map((r) => `${r.itemId}|${r.promoKey}`));
  }

  private async suggestInvitations(rule: { id: string; companyId: string; config: unknown }, conn: Conn, max: number) {
    const cfg = rule.config as any;
    const now = new Date();
    const promos = await this.prisma.mlPromotion.findMany({
      where: { connectionId: conn.id, status: { not: 'finished' }, type: { in: cfg.types }, OR: [{ deadlineDate: null }, { deadlineDate: { gt: now } }] },
    });
    if (!promos.length) return 0;
    const cands = await this.prisma.mlPromotionItem.findMany({ where: { connectionId: conn.id, status: 'candidate', promoKey: { in: promos.map((p) => p.mlId) } } });
    if (!cands.length) return 0;
    // Una sugerencia por publicación y campaña: no se repite si está pendiente o si el usuario ya la descartó o aplicó.
    const skip = await this.existingKeys(rule.id, conn.id, ['PENDING', 'DISMISSED', 'APPLIED']);
    await this.refreshItemInfo(conn, cands.map((c) => c.itemId)).catch(() => {});
    const ctx = await this.contexts(conn.id, Array.from(new Set(cands.map((c) => c.itemId))));
    let created = 0;
    for (const r of cands) {
      if (created >= max) break;
      if (skip.has(`${r.itemId}|${r.promoKey}`)) continue;
      const c = ctx.get(r.itemId)!;
      if (this.passesFilters(cfg, c)) continue;
      const t = r.type as PromoType;
      if (!isPromoType(t) || (TYPE_META[t].offer && !r.offerId)) continue;
      const meliPct = dec(r.meliPct);
      if (cfg.minMeliPct && (meliPct ?? 0) < cfg.minMeliPct) continue;
      const original = dec(r.originalPrice) ?? c.info?.price ?? null;
      const p = propose({
        type: t, originalPrice: original, minPrice: dec(r.minPrice), maxPrice: dec(r.maxPrice), suggestedPrice: dec(r.suggestedPrice), mlPrice: dec(r.price),
        meliPct, cost: c.product!.cost, feePct: c.info?.feePct, feeFixed: c.info?.feeFixed, mode: cfg.priceMode || 'SUGGESTED', minMarginPct: cfg.minMarginPct,
      });
      if (p.status === 'error' || p.price == null || p.estimate?.profit == null || p.estimate.profit < 0) continue;
      if ((p.discountPct ?? 0) > cfg.maxDiscountPct) continue;
      const promo = promos.find((x) => x.mlId === r.promoKey);
      const reason = [
        `${TYPE_META[t].label}${promo?.name ? ` "${promo.name}"` : ''}`,
        `−${p.discountPct}%`,
        meliPct ? `ML aporta ${meliPct}%` : null,
        `margen ${p.estimate.marginPct}%`,
      ].filter(Boolean).join(' · ');
      await this.prisma.mlPromotionSuggestion.create({
        data: {
          ruleId: rule.id, companyId: rule.companyId, connectionId: conn.id, itemId: r.itemId, promoKey: r.promoKey, type: t,
          promotionMlId: r.promotionMlId, offerId: r.offerId, price: p.price, originalPrice: original!, profit: p.estimate.profit,
          marginPct: p.estimate.marginPct, reason, productId: c.product!.id, startDate: promo?.startDate, finishDate: promo?.finishDate,
        },
      });
      created++;
    }
    return created;
  }

  private async suggestDiscounts(rule: { id: string; companyId: string; config: unknown }, conn: Conn, max: number) {
    const cfg = rule.config as any;
    const listings = await this.prisma.listing.findMany({
      where: { connectionId: conn.id, externalId: { not: null }, status: ListingStatus.ACTIVE, product: { stock: { gte: cfg.minStock || 1 } } },
      select: { externalId: true }, distinct: ['externalId'], take: 3000,
    });
    const ids = listings.map((l) => l.externalId!) as string[];
    if (!ids.length) return 0;
    const busy = new Set((await this.prisma.mlPromotionItem.findMany({
      where: { connectionId: conn.id, itemId: { in: ids }, status: { in: ACTIVE_STATUSES } }, select: { itemId: true },
    })).map((r) => r.itemId));
    // No se insiste con lo descartado en los últimos 14 días.
    const skip = await this.existingKeys(rule.id, conn.id, ['PENDING']);
    const dismissed = await this.existingKeys(rule.id, conn.id, ['DISMISSED'], new Date(Date.now() - 14 * 86_400_000));
    const candidates = ids.filter((i) => !busy.has(i) && !skip.has(`${i}|PRICE_DISCOUNT`) && !dismissed.has(`${i}|PRICE_DISCOUNT`));
    if (!candidates.length) return 0;
    const ctx = await this.contexts(conn.id, candidates);
    const withSales = await this.productsWithSales(Array.from(new Set(Array.from(ctx.values()).map((c) => c.product?.id).filter(Boolean))) as string[], cfg.noSalesDays || 0);
    const ranges = new Map((await this.prisma.mlPromotionItem.findMany({ where: { connectionId: conn.id, promoKey: 'PRICE_DISCOUNT', itemId: { in: candidates } } })).map((r) => [r.itemId, r]));
    const start = today();
    const finish = addDays(start, (cfg.durationDays || 7) - 1);
    let created = 0;
    for (const itemId of candidates) {
      if (created >= max) break;
      const c = ctx.get(itemId)!;
      if (this.passesFilters(cfg, c)) continue;
      if (cfg.noSalesDays && withSales.has(c.product!.id)) continue;
      const r = ranges.get(itemId);
      const original = dec(r?.originalPrice) ?? c.info?.price ?? null;
      const p = propose({
        type: 'PRICE_DISCOUNT', originalPrice: original, minPrice: dec(r?.minPrice), maxPrice: dec(r?.maxPrice), suggestedPrice: dec(r?.suggestedPrice),
        cost: c.product!.cost, feePct: c.info?.feePct, feeFixed: c.info?.feeFixed, mode: 'PERCENT', percent: cfg.discountPct, minMarginPct: cfg.minMarginPct,
      });
      if (p.status === 'error' || p.price == null || p.estimate?.profit == null || p.estimate.profit < 0) continue;
      const reason = [
        `Descuento individual −${p.discountPct}% por ${cfg.durationDays || 7} días`,
        cfg.noSalesDays ? `sin ventas en ${cfg.noSalesDays} días` : null,
        `stock ${c.product!.stock}`,
        `margen ${p.estimate.marginPct}%`,
      ].filter(Boolean).join(' · ');
      await this.prisma.mlPromotionSuggestion.create({
        data: {
          ruleId: rule.id, companyId: rule.companyId, connectionId: conn.id, itemId, promoKey: 'PRICE_DISCOUNT', type: 'PRICE_DISCOUNT',
          price: p.price, originalPrice: original!, profit: p.estimate.profit, marginPct: p.estimate.marginPct, reason, productId: c.product!.id,
          startDate: new Date(`${start}T03:00:00Z`), finishDate: new Date(`${finish}T23:59:59-03:00`),
        },
      });
      created++;
    }
    return created;
  }

  // Sugerencias que ya no sirven: campaña terminada o vencida, publicación ya en la promoción,
  // o descuento propio sugerido hace más de 3 días (los datos cambiaron).
  private async expireSuggestions(companyId: string) {
    const pending = await this.prisma.mlPromotionSuggestion.findMany({ where: { companyId, status: 'PENDING' } });
    if (!pending.length) return;
    const promos = await this.prisma.mlPromotion.findMany({
      where: { companyId, mlId: { in: pending.map((p) => p.promotionMlId).filter(Boolean) as string[] } }, select: { connectionId: true, mlId: true, status: true, deadlineDate: true },
    });
    const items = await this.prisma.mlPromotionItem.findMany({
      where: { companyId, itemId: { in: pending.map((p) => p.itemId) }, status: { in: ACTIVE_STATUSES } }, select: { connectionId: true, itemId: true, promoKey: true },
    });
    const now = Date.now();
    const expired = pending.filter((s) => {
      if (s.type === 'PRICE_DISCOUNT') {
        if (now - s.createdAt.getTime() > 3 * 86_400_000) return true;
        return items.some((i) => i.connectionId === s.connectionId && i.itemId === s.itemId);
      }
      const promo = promos.find((p) => p.connectionId === s.connectionId && p.mlId === s.promotionMlId);
      if (!promo || promo.status === 'finished' || (promo.deadlineDate && promo.deadlineDate.getTime() < now)) return true;
      return items.some((i) => i.connectionId === s.connectionId && i.itemId === s.itemId && i.promoKey === s.promoKey);
    });
    if (expired.length) await this.prisma.mlPromotionSuggestion.updateMany({ where: { id: { in: expired.map((e) => e.id) } }, data: { status: 'EXPIRED' } });
  }

  async suggestions(user: any, q: { companyId?: string; connectionId?: string; ruleId?: string }) {
    const rows = await this.prisma.mlPromotionSuggestion.findMany({
      where: { ...this.companyWhere(user, q.companyId), status: 'PENDING', ...(q.connectionId ? { connectionId: q.connectionId } : {}), ...(q.ruleId ? { ruleId: q.ruleId } : {}) },
      orderBy: [{ ruleId: 'asc' }, { marginPct: 'desc' }], take: 1000,
      include: { rule: { select: { id: true, name: true, kind: true } }, connection: { select: { id: true, name: true } } },
    });
    const byConn = new Map<string, string[]>();
    for (const r of rows) byConn.set(r.connectionId, [...(byConn.get(r.connectionId) || []), r.itemId]);
    const ctxs = new Map<string, ItemCtx>();
    for (const [cid, ids] of byConn) for (const [k, v] of await this.contexts(cid, ids)) ctxs.set(`${cid}|${k}`, v);
    return rows.map((r) => {
      const c = ctxs.get(`${r.connectionId}|${r.itemId}`);
      return {
        id: r.id, rule: r.rule, connection: r.connection, itemId: r.itemId, type: r.type, typeLabel: TYPE_META[r.type as PromoType]?.label || r.type,
        promotionId: r.promotionMlId, price: dec(r.price), originalPrice: dec(r.originalPrice), discountPct: discountPct(dec(r.originalPrice), dec(r.price)),
        profit: dec(r.profit), marginPct: dec(r.marginPct), reason: r.reason, startDate: r.startDate, finishDate: r.finishDate, createdAt: r.createdAt,
        title: c?.info?.title || c?.product?.name || r.itemId, thumbnail: c?.info?.thumbnail || null, product: c?.product || null,
      };
    });
  }

  // Aprobar sugerencias: se agrupan por cuenta y promoción, y cada grupo se aplica como un trabajo.
  async applySuggestions(user: any, ids: string[]) {
    const rows = await this.prisma.mlPromotionSuggestion.findMany({ where: { id: { in: (ids || []).slice(0, 1000) }, status: 'PENDING' } });
    if (!rows.length) throw new BadRequestException('No hay sugerencias pendientes para aplicar');
    if (user.role !== Role.SUPER_ADMIN && rows.some((r) => r.companyId !== user.companyId)) throw new ForbiddenException();
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.connectionId}|${r.type}|${r.promotionMlId || ''}`;
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    const jobs: any[] = [];
    const errors: string[] = [];
    for (const [k, list] of groups) {
      const [connectionId, type, promotionId] = k.split('|');
      try {
        if (type === 'PRICE_DISCOUNT') {
          // Fechas desde hoy con la duración que se sugirió.
          const days = list[0].startDate && list[0].finishDate ? Math.max(1, Math.round((list[0].finishDate.getTime() - list[0].startDate.getTime()) / 86_400_000)) : 7;
          jobs.push(await this.apply(user, {
            connectionId, type, startDate: today(), days,
            items: list.map((s) => ({ itemId: s.itemId, price: dec(s.price), suggestionId: s.id })),
          }));
        } else {
          jobs.push(await this.apply(user, {
            connectionId, type, promotionId: promotionId || undefined,
            items: list.map((s) => ({ itemId: s.itemId, price: TYPE_META[type as PromoType].pricing === 'SELLER' ? dec(s.price) : null, offerId: s.offerId, suggestionId: s.id })),
          }));
        }
      } catch (e: any) {
        errors.push(e.message);
      }
    }
    return { jobs, errors };
  }

  async dismissSuggestions(user: any, ids: string[]) {
    const where: Prisma.MlPromotionSuggestionWhereInput = { id: { in: (ids || []).slice(0, 1000) }, status: 'PENDING', ...this.companyWhere(user) };
    const res = await this.prisma.mlPromotionSuggestion.updateMany({ where, data: { status: 'DISMISSED' } });
    return { dismissed: res.count };
  }
}
