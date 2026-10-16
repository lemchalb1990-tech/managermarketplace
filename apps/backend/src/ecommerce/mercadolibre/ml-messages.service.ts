import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketplaceType, Prisma, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { integrationsDisabled } from '../../common/integrations.util';
import { MercadolibreService } from './mercadolibre.service';
import { StorageService } from '../../common/storage/storage.service';

const ML_API = 'https://api.mercadolibre.com';
const MAX_TEXT = 350; // límite de Mercado Libre para mensajes postventa
const PAGE_SIZE = 25; // conversaciones por página en la bandeja
const SITE_ID = 'MLC';

// attachments: nombres (formato antiguo de la caché); files: id de ML para descargarlos.
export type MlMsgFile = { id: string; name: string; type: string | null; size: number | null };
export type MlMsg = { id: string; from: 'BUYER' | 'SELLER'; text: string; date: string; attachments?: string[]; files?: MlMsgFile[] };

export const RULE_TRIGGERS = ['SALE_CREATED', 'INVOICE_ISSUED', 'ORDER_DISPATCHED', 'ORDER_DELIVERED'] as const;
const MAX_RULE_IMAGES = 5;
const RULE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
type RuleImage = { url: string; name: string; type: string; size: number };
const COND_FIELDS = ['category', 'product', 'shipping', 'total', 'account'] as const;
type Cond = { field: (typeof COND_FIELDS)[number]; values: string[]; labels?: Record<string, string> };

// Tipo de envío guardado en la venta ("Flex", "Full", "Turbo", "Colecta (agencia)"...) → grupo.
const shippingGroup = (m?: string | null) => {
  const s = String(m || '');
  if (/^Colecta/i.test(s)) return 'COLECTA';
  if (/flex/i.test(s)) return 'FLEX';
  if (/full/i.test(s)) return 'FULL';
  if (/turbo/i.test(s)) return 'TURBO';
  if (/coordinar/i.test(s)) return 'COORDINAR';
  return s ? 'OTRO' : 'NINGUNO';
};

/**
 * Mensajería postventa de Mercado Libre: bandeja de conversaciones de las ventas, chat por
 * venta y mensajes programados según la venta u orden.
 *
 * Rutas de la API (tag=post_sale): GET/POST /messages/packs/{pack}/sellers/{seller},
 * /messages/unread y, para iniciar contacto, /messages/action_guide/packs/{pack}/option.
 * POR VALIDAR en vivo: el formato exacto de la respuesta y el motivo usado para iniciar contacto.
 */
@Injectable()
export class MlMessagesService {
  private readonly logger = new Logger(MlMessagesService.name);

  constructor(private prisma: PrismaService, private ml: MercadolibreService, private storage: StorageService) {}

  private companyWhere(user: any, companyId?: string) {
    if (user.role === Role.SUPER_ADMIN) return companyId ? { companyId } : {};
    return { companyId: user.companyId };
  }

  private async mlFetch(connectionId: string, path: string, init: RequestInit = {}) {
    const token = await this.ml.getValidToken(connectionId);
    const res = await fetch(`${ML_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const body = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      const causes = Array.isArray(body?.cause) ? body.cause.map((c: any) => c.message || c.code).filter(Boolean).join('; ') : '';
      const err: any = new Error(causes || body?.message || body?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = body?.error || body?.code;
      throw err;
    }
    return body;
  }

  // ── Conversaciones ─────────────────────────────────────────────────────

  async list(user: any, q: { companyId?: string; unread?: string; connectionId?: string; search?: string; page?: string }) {
    const where: Prisma.MlConversationWhereInput = { ...this.companyWhere(user, q.companyId) };
    if (q.unread === '1') where.unread = { gt: 0 };
    if (q.connectionId) where.connectionId = q.connectionId;
    if (q.search) {
      where.OR = [
        { buyerName: { contains: q.search, mode: 'insensitive' } },
        { lastText: { contains: q.search, mode: 'insensitive' } },
        { packId: { contains: q.search } },
      ];
    }
    const total = await this.prisma.mlConversation.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number(q.page) || 1), pages);
    const rows = await this.prisma.mlConversation.findMany({
      where, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, packId: true, buyerName: true, lastText: true, lastFrom: true, lastMessageAt: true, unread: true, blocked: true,
        connection: { select: { id: true, name: true } },
        sale: {
          select: {
            id: true, saleNumber: true, shippingMethod: true, order: { select: { status: true } },
            items: { take: 1, select: { product: { select: { name: true, images: { take: 1, orderBy: { order: 'asc' }, select: { url: true } } } } } },
          },
        },
      },
    });
    return { rows, total, page, pageSize: PAGE_SIZE };
  }

  // Conversación de una venta (se crea si no existe) con los mensajes al día.
  async forSale(user: any, saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, select: { id: true, companyId: true, channel: true, externalId: true, mlPackId: true, connectionId: true, customerName: true } });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) throw new ForbiddenException();
    if (sale.channel !== SaleChannel.MERCADO_LIBRE || !sale.connectionId || !(sale.mlPackId || sale.externalId)) {
      throw new BadRequestException('La mensajería solo está disponible para ventas de Mercado Libre');
    }
    const packId = String(sale.mlPackId || sale.externalId);
    const conv = await this.prisma.mlConversation.upsert({
      where: { connectionId_packId: { connectionId: sale.connectionId, packId } },
      update: { saleId: sale.id },
      create: { companyId: sale.companyId, connectionId: sale.connectionId, packId, saleId: sale.id, buyerName: sale.customerName },
    });
    return this.refresh(conv.id, true);
  }

  async open(user: any, id: string) {
    const conv = await this.prisma.mlConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conv.companyId !== user.companyId) throw new ForbiddenException();
    return this.refresh(conv.id, true);
  }

  // Conversaciones con mensajes sin leer (indicador junto a la campanita).
  async unreadCount(user: any, companyId?: string) {
    const count = await this.prisma.mlConversation.count({ where: { ...this.companyWhere(user, companyId), unread: { gt: 0 } } });
    return { count };
  }

  // Marcar como no leída (o leída) solo en el panel: Mercado Libre no permite desmarcar la lectura.
  async setUnread(user: any, id: string, unread: boolean) {
    const conv = await this.prisma.mlConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conv.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.mlConversation.update({ where: { id }, data: { unread: unread ? Math.max(1, conv.unread) : 0 }, select: { id: true, unread: true } });
  }

  // Trae los mensajes desde Mercado Libre y actualiza la caché (markRead = el usuario la abrió).
  private async refresh(id: string, markRead: boolean) {
    const conv = await this.prisma.mlConversation.findUniqueOrThrow({ where: { id }, include: { connection: { select: { mlUserId: true } } } });
    const seller = conv.connection.mlUserId;
    if (!seller || integrationsDisabled()) return this.view(conv.id);
    try {
      // Mercado Libre devuelve los mensajes por páginas (10 por defecto): se recorren todas
      // para tener el historial completo.
      const base = `/messages/packs/${conv.packId}/sellers/${seller}?tag=post_sale&mark_as_read=${markRead ? 'true' : 'false'}`;
      let data: any = null;
      const raw: any[] = [];
      for (let offset = 0; offset < 5000;) {
        const pageData = await this.mlFetch(conv.connectionId, `${base}&limit=50&offset=${offset}`);
        data = data || pageData;
        const batch: any[] = pageData?.messages || [];
        raw.push(...batch);
        const total = Number(pageData?.paging?.total ?? 0);
        offset += batch.length;
        if (!batch.length || offset >= total) break;
      }
      const seen = new Set<string>();
      const msgs: MlMsg[] = raw.filter((m) => !seen.has(String(m.id)) && !!seen.add(String(m.id))).map((m) => {
        const files: MlMsgFile[] = (m.message_attachments || [])
          .filter((a: any) => a?.filename)
          .map((a: any) => ({ id: String(a.filename), name: String(a.original_filename || a.filename), type: a.type || null, size: a.size ?? null }));
        return {
          id: String(m.id),
          from: (String(m.from?.user_id) === String(seller) ? 'SELLER' : 'BUYER') as MlMsg['from'],
          text: String(m.text || ''),
          date: m.message_date?.created || m.date_created || new Date().toISOString(),
          attachments: files.map((f) => f.name),
          files,
        };
      }).sort((a, b) => a.date.localeCompare(b.date));
      const last = msgs[msgs.length - 1];
      const buyerMsg = raw.find((m) => String(m.from?.user_id) !== String(seller));
      const status = data?.conversation_status || {};
      await this.prisma.mlConversation.update({
        where: { id: conv.id },
        data: {
          messages: msgs as unknown as Prisma.InputJsonValue,
          lastText: last?.text ?? conv.lastText,
          lastFrom: last?.from ?? conv.lastFrom,
          lastMessageAt: last ? new Date(last.date) : conv.lastMessageAt,
          buyerId: conv.buyerId || (buyerMsg ? String(buyerMsg.from.user_id) : null),
          unread: markRead ? 0 : conv.unread,
          blocked: status.status === 'blocked' || !!status.is_blocked,
          blockedReason: status.substatus || status.blocked_reason || null,
          syncedAt: new Date(),
        },
      });
    } catch (e: any) {
      this.logger.warn(`Mensajes pack ${conv.packId}: ${e.message}`);
      if (e.status === 403) {
        await this.prisma.mlConversation.update({ where: { id: conv.id }, data: { blocked: true, blockedReason: e.code || e.message } });
      }
    }
    return this.view(conv.id);
  }

  private async view(id: string) {
    return this.prisma.mlConversation.findUniqueOrThrow({
      where: { id },
      include: {
        connection: { select: { id: true, name: true } },
        sale: {
          select: {
            id: true, saleNumber: true, externalId: true, total: true, shippingMethod: true, createdAt: true,
            items: { take: 3, select: { quantity: true, product: { select: { name: true, sku: true, images: { take: 1, orderBy: { order: 'asc' }, select: { url: true } } } } } },
            order: { select: { id: true, status: true, courier: true, trackingCode: true, dispatchedAt: true, deliveredAt: true } },
            invoices: { orderBy: { createdAt: 'desc' }, take: 1, select: { folio: true, status: true, createdAt: true } },
            mlMessageLogs: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true, rule: { select: { name: true } } } },
          },
        },
      },
    });
  }

  private async ownConversation(user: any, id: string) {
    const conv = await this.prisma.mlConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conv.companyId !== user.companyId) throw new ForbiddenException();
    return conv;
  }

  // Sube un archivo (foto o documento) a Mercado Libre para adjuntarlo al próximo mensaje.
  async uploadAttachment(user: any, id: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
    const conv = await this.ownConversation(user, id);
    const mlId = await this.uploadToMl(conv.connectionId, file.buffer, file.mimetype, file.originalname);
    return { id: mlId, name: file.originalname, type: file.mimetype, size: file.size };
  }

  // Sube bytes a los adjuntos de mensajes de una cuenta de ML y devuelve el id del archivo.
  private async uploadToMl(connectionId: string, buffer: Buffer, mimetype: string, name: string) {
    const token = await this.ml.getValidToken(connectionId);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), name || 'archivo');
    const res = await fetch(`${ML_API}/messages/attachments?tag=post_sale&site_id=${SITE_ID}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(data.message || 'Mercado Libre rechazó el archivo');
    if (!data.id) throw new BadRequestException('Mercado Libre no devolvió el identificador del archivo');
    return String(data.id);
  }

  // Imagen para un mensaje programado: se guarda en nuestro almacenamiento (los adjuntos de ML
  // son por cuenta) y se sube a la cuenta de la venta al momento de enviar.
  async uploadRuleImage(user: any, companyIdParam: string | undefined, file: Express.Multer.File) {
    const companyId = user.role === Role.SUPER_ADMIN ? companyIdParam : user.companyId;
    if (!companyId) throw new BadRequestException('Selecciona una empresa');
    if (!RULE_IMAGE_TYPES.includes(file.mimetype)) throw new BadRequestException('Solo se aceptan imágenes JPG, PNG, WEBP o GIF');
    const stored = await this.storage.persist(file, { folder: `ml-mensajes/${companyId}` });
    return { url: stored.url, name: file.originalname || stored.filename, type: file.mimetype, size: file.size };
  }

  // Descarga un adjunto de la conversación desde Mercado Libre (requiere el token de la cuenta).
  async downloadAttachment(user: any, id: string, fileId: string) {
    const conv = await this.ownConversation(user, id);
    const token = await this.ml.getValidToken(conv.connectionId);
    const res = await fetch(`${ML_API}/messages/attachments/${encodeURIComponent(fileId)}?tag=post_sale&site_id=${SITE_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new BadRequestException('No se pudo descargar el archivo desde Mercado Libre');
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }

  // El comprador (user_id de ML) se saca de la orden si todavía no escribió.
  private async buyerId(conv: { connectionId: string; packId: string; buyerId: string | null; saleId: string | null }) {
    if (conv.buyerId) return conv.buyerId;
    const sale = conv.saleId ? await this.prisma.sale.findUnique({ where: { id: conv.saleId }, select: { externalId: true } }) : null;
    const orderId = sale?.externalId || conv.packId;
    const order = await this.mlFetch(conv.connectionId, `/orders/${orderId}`);
    const id = order?.buyer?.id ? String(order.buyer.id) : null;
    if (!id) throw new BadRequestException('No se pudo identificar al comprador en Mercado Libre');
    return id;
  }

  // Envía un mensaje. Si Mercado Libre exige iniciar el contacto con un motivo (el comprador aún
  // no escribió), se usa el motivo "Otro" con el mismo texto.
  async send(user: any, id: string, text: string, attachments: string[] = []) {
    const conv = await this.prisma.mlConversation.findUnique({ where: { id }, include: { connection: { select: { mlUserId: true } } } });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (user && user.role !== Role.SUPER_ADMIN && conv.companyId !== user.companyId) throw new ForbiddenException();
    await this.sendRaw(conv, text, attachments);
    return this.refresh(conv.id, false);
  }

  // attachments = ids devueltos por uploadAttachment. Se puede enviar solo archivos, sin texto.
  private async sendRaw(conv: { id: string; connectionId: string; packId: string; buyerId: string | null; saleId: string | null; connection: { mlUserId: string | null } }, rawText: string, rawAttachments: string[] = []) {
    const text = String(rawText || '').trim();
    const attachments = (Array.isArray(rawAttachments) ? rawAttachments : []).map(String).filter(Boolean).slice(0, 10);
    if (!text && !attachments.length) throw new BadRequestException('Escribe un mensaje o adjunta un archivo');
    if (text.length > MAX_TEXT) throw new BadRequestException(`Mercado Libre permite hasta ${MAX_TEXT} caracteres`);
    const seller = conv.connection.mlUserId;
    if (!seller) throw new BadRequestException('La cuenta de Mercado Libre no tiene usuario autorizado');
    const buyer = await this.buyerId(conv);
    const post = () => this.mlFetch(conv.connectionId, `/messages/packs/${conv.packId}/sellers/${seller}?tag=post_sale`, {
      method: 'POST', body: JSON.stringify({ from: { user_id: seller }, to: { user_id: buyer }, text, ...(attachments.length ? { attachments } : {}) }),
    });
    try {
      await post();
    } catch (e: any) {
      // Sin conversación iniciada por el comprador: se inicia con un motivo. El motivo no admite
      // archivos, así que después se reintenta el mensaje con los adjuntos.
      if (e.status === 403 || e.status === 400) {
        await this.mlFetch(conv.connectionId, `/messages/action_guide/packs/${conv.packId}/option?tag=post_sale`, {
          method: 'POST', body: JSON.stringify({ option_id: 'OTHER', text: text || 'Te enviamos un archivo sobre tu compra.' }),
        }).catch((e2: any) => { throw new BadRequestException(`Mercado Libre rechazó el mensaje: ${e2.message}`); });
        if (attachments.length) {
          await post().catch((e3: any) => { throw new BadRequestException(`Mercado Libre no aceptó los archivos: ${e3.message}`); });
        }
      } else {
        throw new BadRequestException(`Mercado Libre rechazó el mensaje: ${e.message}`);
      }
    }
    await this.prisma.mlConversation.update({ where: { id: conv.id }, data: { buyerId: buyer, lastText: text || `Archivo adjunto (${attachments.length})`, lastFrom: 'SELLER', lastMessageAt: new Date() } });
  }

  // ── Sincronización: mensajes sin leer de cada cuenta ───────────────────

  async syncUnread(connectionId: string) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { id: true, companyId: true, mlUserId: true, syncEnabled: true } });
    if (!conn?.mlUserId || !conn.syncEnabled) return;
    const data = await this.mlFetch(conn.id, `/messages/unread?role=seller&tag=post_sale`).catch(() => null);
    for (const r of data?.results || []) {
      const packId = String(r.resource || '').match(/packs\/(\d+)/)?.[1];
      if (!packId) continue;
      const sale = await this.prisma.sale.findFirst({
        where: { connectionId: conn.id, OR: [{ mlPackId: packId }, { externalId: packId }] },
        select: { id: true, customerName: true },
      });
      const conv = await this.prisma.mlConversation.upsert({
        where: { connectionId_packId: { connectionId: conn.id, packId } },
        update: { unread: Number(r.count) || 1, ...(sale ? { saleId: sale.id } : {}) },
        create: { companyId: conn.companyId, connectionId: conn.id, packId, saleId: sale?.id, buyerName: sale?.customerName, unread: Number(r.count) || 1 },
      });
      await this.refresh(conv.id, false);
    }
  }

  // Aviso de Mercado Libre (topic "messages"): se revisan los no leídos de esa cuenta.
  async handleWebhook(body: any) {
    const conn = await this.prisma.marketplaceConnection.findFirst({ where: { marketplace: MarketplaceType.MERCADO_LIBRE, mlUserId: String(body?.user_id || '') }, select: { id: true } });
    if (conn) await this.syncUnread(conn.id).catch((e) => this.logger.warn(`Webhook mensajes: ${e.message}`));
    return { received: true };
  }

  @Cron('*/10 * * * *')
  async syncAll() {
    if (integrationsDisabled()) return;
    const conns = await this.prisma.marketplaceConnection.findMany({
      where: { marketplace: MarketplaceType.MERCADO_LIBRE, syncEnabled: true, mlUserId: { not: null } }, select: { id: true },
    });
    for (const c of conns) await this.syncUnread(c.id).catch((e) => this.logger.warn(`Mensajes ${c.id}: ${e.message}`));
    await this.runRules().catch((e) => this.logger.warn(`Mensajes programados: ${e.message}`));
  }

  // ── Mensajes programados ───────────────────────────────────────────────

  async listRules(user: any, companyId?: string) {
    const rules = await this.prisma.mlMessageRule.findMany({
      where: this.companyWhere(user, companyId), orderBy: { createdAt: 'asc' },
      include: { _count: { select: { logs: true } } },
    });
    // Para la tarjeta: envíos en espera, envíos ya vencidos (acumulados en pausa) y el último envío.
    const lastSent = await this.prisma.mlMessageLog.groupBy({
      by: ['ruleId'], where: { ruleId: { in: rules.map((r) => r.id) }, status: 'SENT' }, _max: { createdAt: true },
    });
    const lastByRule = new Map(lastSent.map((l) => [l.ruleId, l._max.createdAt]));
    return Promise.all(rules.map(async (r) => {
      const q = await this.ruleQueue(r).catch(() => ({ waiting: [], due: [], capped: false }));
      return { ...r, waitingCount: q.waiting.length, dueCount: q.due.length, queueCapped: q.capped, lastSentAt: lastByRule.get(r.id) ?? null };
    }));
  }

  // Ventas de la regla aún sin procesar (sin registro), con lo necesario para decidir el envío.
  private ruleSales(rule: { id: string; companyId: string; createdAt: Date; connectionId: string | null; minTotal: Prisma.Decimal | null }, take: number) {
    return this.prisma.sale.findMany({
      where: {
        companyId: rule.companyId, channel: SaleChannel.MERCADO_LIBRE, createdAt: { gte: rule.createdAt },
        ...(rule.connectionId ? { connectionId: rule.connectionId } : { connectionId: { not: null } }),
        ...(rule.minTotal != null ? { total: { gte: rule.minTotal } } : {}),
        mlMessageLogs: { none: { ruleId: rule.id } },
      },
      take,
      orderBy: { createdAt: 'asc' },
      include: {
        items: { select: { productId: true, quantity: true, product: { select: { name: true, category: true } } } },
        invoices: { orderBy: { createdAt: 'desc' }, select: { folio: true, pdfUrl: true, status: true, createdAt: true } },
        order: { select: { id: true, status: true, dispatchedAt: true, deliveredAt: true, updatedAt: true, verificationPending: true } },
        company: { select: { name: true } },
      },
    });
  }

  /**
   * Cola de una regla: «en espera» = la venta ya cumplió el momento pero falta la espera;
   * «vencidos» = ya debió enviarse (se envía en la próxima pasada; en una regla pausada son
   * los que se acumularon durante la pausa). Solo ventas que cumplen las condiciones.
   */
  private async ruleQueue(rule: Parameters<MlMessagesService['ruleSales']>[0] & { trigger: string; delayMinutes: number; conditions: unknown; match: string }) {
    const CAP = 500;
    const sales = await this.ruleSales(rule, CAP);
    const now = Date.now();
    const waiting: typeof sales = [];
    const due: typeof sales = [];
    for (const sale of sales) {
      const at = this.triggerAt(rule.trigger, sale);
      if (!at || !this.matches(rule, sale)) continue;
      if (at.getTime() + rule.delayMinutes * 60_000 > now) waiting.push(sale);
      else due.push(sale);
    }
    return { waiting, due, capped: sales.length >= CAP };
  }

  /**
   * Activa o pausa un mensaje programado desde la tarjeta.
   * Al pausar, pending='cancel' cancela los envíos en espera (y los vencidos); 'keep' los deja
   * para cuando se reactive. Al activar, pending='skip' descarta las ventas cuyo envío se cumplió
   * mientras estaba pausado (quedan omitidas); 'send' les envía el mensaje en la próxima pasada.
   */
  async setRuleActive(user: any, id: string, dto: { active: boolean; pending?: 'cancel' | 'keep' | 'skip' | 'send' }) {
    const rule = await this.prisma.mlMessageRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Mensaje programado no encontrado');
    if (user.role !== Role.SUPER_ADMIN && rule.companyId !== user.companyId) throw new ForbiddenException();
    const active = !!dto.active;
    let skipped = 0;
    if (rule.active !== active) {
      const q = await this.ruleQueue(rule);
      const toSkip = !active && dto.pending === 'cancel' ? [...q.waiting, ...q.due]
        : active && dto.pending === 'skip' ? q.due : [];
      const detail = active ? 'Su envío se cumplió mientras el mensaje estaba pausado' : 'Cancelado al pausar el mensaje';
      if (toSkip.length) {
        const res = await this.prisma.mlMessageLog.createMany({
          data: toSkip.map((s) => ({ ruleId: rule.id, saleId: s.id, status: 'SKIPPED', detail })),
          skipDuplicates: true,
        });
        skipped = res.count;
      }
      await this.prisma.mlMessageRule.update({ where: { id }, data: { active } });
    }
    return { ok: true, active, skipped };
  }

  private checkRule(dto: any) {
    if (!RULE_TRIGGERS.includes(dto.trigger)) throw new BadRequestException('Momento de envío no válido');
    const text = String(dto.text || '').trim();
    const images: RuleImage[] = (Array.isArray(dto.images) ? dto.images : [])
      .filter((i: any) => i && typeof i.url === 'string' && (/^https?:\/\//.test(i.url) || i.url.startsWith('/api/uploads/')))
      .slice(0, MAX_RULE_IMAGES)
      .map((i: any) => ({ url: i.url, name: String(i.name || 'imagen').slice(0, 120), type: String(i.type || ''), size: Number(i.size) || 0 }));
    if (!text && !images.length) throw new BadRequestException('Escribe el mensaje o agrega una imagen');
    if (text.length > MAX_TEXT) throw new BadRequestException(`El mensaje no puede superar ${MAX_TEXT} caracteres`);
    const conditions: Cond[] = (Array.isArray(dto.conditions) ? dto.conditions : [])
      .filter((c: any) => COND_FIELDS.includes(c?.field))
      .map((c: any) => ({
        field: c.field,
        values: (Array.isArray(c.values) ? c.values : [c.values]).map((v: any) => String(v ?? '').trim()).filter(Boolean),
        // Nombres para mostrar (productos): solo texto, no se usan para decidir.
        ...(c.labels && typeof c.labels === 'object' ? { labels: Object.fromEntries(Object.entries(c.labels).map(([k, v]) => [String(k), String(v).slice(0, 120)])) } : {}),
      }))
      .filter((c: Cond) => c.values.length);
    return {
      name: String(dto.name || '').trim() || 'Mensaje programado',
      active: dto.active !== false,
      conditions: conditions as unknown as Prisma.InputJsonValue,
      match: dto.match === 'ANY' ? 'ANY' : 'ALL',
      markVerification: !!dto.markVerification,
      trigger: dto.trigger,
      delayMinutes: Math.max(0, Math.round(Number(dto.delayMinutes) || 0)),
      text,
      images: images.length ? (images as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      connectionId: dto.connectionId || null,
      minTotal: dto.minTotal != null && dto.minTotal !== '' ? Number(dto.minTotal) : null,
    };
  }

  async createRule(user: any, dto: any) {
    const companyId = user.role === Role.SUPER_ADMIN ? dto.companyId : user.companyId;
    if (!companyId) throw new BadRequestException('Selecciona una empresa');
    return this.prisma.mlMessageRule.create({ data: { ...this.checkRule(dto), companyId } });
  }

  async updateRule(user: any, id: string, dto: any) {
    const rule = await this.prisma.mlMessageRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Mensaje programado no encontrado');
    if (user.role !== Role.SUPER_ADMIN && rule.companyId !== user.companyId) throw new ForbiddenException();
    // Reactivado desde el formulario: las ventas cuyo envío se cumplió durante la pausa quedan
    // omitidas (no se le escribe de golpe a todos los compradores acumulados).
    if (!rule.active && dto.active === true) await this.setRuleActive(user, id, { active: true, pending: 'skip' });
    return this.prisma.mlMessageRule.update({ where: { id }, data: this.checkRule({ ...rule, minTotal: rule.minTotal != null ? Number(rule.minTotal) : null, ...dto }) });
  }

  // ¿La venta cumple las condiciones de la regla? (Y = todas, O = cualquiera)
  private matches(rule: { conditions: unknown; match: string }, sale: any) {
    const conds = (Array.isArray(rule.conditions) ? rule.conditions : []) as Cond[];
    if (!conds.length) return true;
    const cats = new Set<string>(sale.items.map((i: any) => String(i.product?.category || '').toLowerCase()).filter(Boolean));
    const prods = new Set<string>(sale.items.map((i: any) => i.productId));
    const test = (c: Cond) => {
      if (c.field === 'category') return c.values.some((v) => cats.has(v.toLowerCase()));
      if (c.field === 'product') return c.values.some((v) => prods.has(v));
      if (c.field === 'shipping') return c.values.includes(shippingGroup(sale.shippingMethod));
      if (c.field === 'total') return Number(sale.total) >= Number(c.values[0] || 0);
      if (c.field === 'account') return c.values.includes(String(sale.connectionId));
      return false;
    };
    return rule.match === 'ANY' ? conds.some(test) : conds.every(test);
  }

  async deleteRule(user: any, id: string) {
    const rule = await this.prisma.mlMessageRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Mensaje programado no encontrado');
    if (user.role !== Role.SUPER_ADMIN && rule.companyId !== user.companyId) throw new ForbiddenException();
    await this.prisma.mlMessageRule.delete({ where: { id } });
    return { ok: true };
  }

  // Reemplaza {nombre}, {producto}, {numero_venta}, {boleta}, {link_boleta}, {tienda}.
  private fill(text: string, sale: any) {
    const inv = (sale.invoices || [])[0];
    const vars: Record<string, string> = {
      nombre: String(sale.customerName || '').split(' ')[0] || 'cliente',
      producto: sale.items?.[0]?.product?.name || 'tu compra',
      productos: (sale.items || []).map((i: any) => `${i.quantity}x ${i.product?.name || ''}`).join(', ') || 'tu compra',
      numero_venta: sale.saleNumber ? String(sale.saleNumber) : String(sale.externalId || ''),
      boleta: inv?.folio ? `N° ${inv.folio}` : '',
      link_boleta: inv?.pdfUrl || '',
      tienda: sale.company?.name || '',
    };
    return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\s{2,}/g, ' ').trim().slice(0, MAX_TEXT);
  }

  // Momento en que la venta cumplió el criterio (o null si todavía no lo cumple).
  private triggerAt(trigger: string, sale: any): Date | null {
    if (trigger === 'SALE_CREATED') return sale.createdAt;
    if (trigger === 'INVOICE_ISSUED') {
      const inv = (sale.invoices || []).find((i: any) => ['ISSUED', 'ACCEPTED'].includes(i.status));
      return inv ? inv.createdAt : null;
    }
    if (trigger === 'ORDER_DISPATCHED') return sale.order?.dispatchedAt || (['IN_TRANSIT', 'DELIVERED'].includes(sale.order?.status) ? sale.order?.updatedAt : null) || null;
    if (trigger === 'ORDER_DELIVERED') return sale.order?.deliveredAt || (sale.order?.status === 'DELIVERED' ? sale.order?.updatedAt : null) || null;
    return null;
  }

  // Sube las imágenes del mensaje programado a la cuenta de ML de la venta (ids de adjunto).
  private async ruleAttachments(images: unknown, connectionId: string) {
    const list = (Array.isArray(images) ? images : []) as RuleImage[];
    const ids: string[] = [];
    for (const img of list) {
      const file = await this.storage.read(img.url);
      if (!file) throw new Error(`No se encontró la imagen "${img.name}"`);
      ids.push(await this.uploadToMl(connectionId, file.bytes, img.type || file.mime, img.name));
    }
    return ids;
  }

  async runRules() {
    const rules = await this.prisma.mlMessageRule.findMany({ where: { active: true } });
    const now = Date.now();
    for (const rule of rules) {
      // Solo ventas desde que se creó el mensaje programado (no se escribe a ventas antiguas).
      const sales = await this.ruleSales(rule, 50);
      for (const sale of sales) {
        const at = this.triggerAt(rule.trigger, sale);
        if (!at || at.getTime() + rule.delayMinutes * 60_000 > now) continue;
        // Solo compras que cumplen las condiciones (las demás quedan registradas como omitidas).
        if (!this.matches(rule, sale)) {
          await this.prisma.mlMessageLog.create({ data: { ruleId: rule.id, saleId: sale.id, status: 'SKIPPED', detail: 'No cumple las condiciones' } }).catch(() => {});
          continue;
        }
        let status = 'SENT';
        let detail: string | null = null;
        try {
          const packId = String(sale.mlPackId || sale.externalId);
          const conv = await this.prisma.mlConversation.upsert({
            where: { connectionId_packId: { connectionId: sale.connectionId!, packId } },
            update: { saleId: sale.id },
            create: { companyId: sale.companyId, connectionId: sale.connectionId!, packId, saleId: sale.id, buyerName: sale.customerName },
            include: { connection: { select: { mlUserId: true } } },
          });
          if (conv.blocked) { status = 'SKIPPED'; detail = 'Mensajería bloqueada por Mercado Libre'; } else {
            const attachments = await this.ruleAttachments(rule.images, sale.connectionId!);
            await this.sendRaw(conv, this.fill(rule.text, sale), attachments);
          }
        } catch (e: any) {
          status = 'FAILED';
          detail = e.message;
        }
        await this.prisma.mlMessageLog.create({ data: { ruleId: rule.id, saleId: sale.id, status, detail } }).catch(() => {});
        // Verificación de la compra: la orden queda marcada para que alguien la revise.
        if (rule.markVerification && sale.order && !sale.order.verificationPending) {
          await this.prisma.order.update({ where: { id: sale.order.id }, data: { verificationPending: true, verifiedAt: null, verifiedByName: null } });
          await this.prisma.orderStatusEvent.create({
            data: {
              orderId: sale.order.id, source: 'SYSTEM', title: 'Pendiente de verificación',
              detail: `Mensaje programado "${rule.name}"${status === 'SENT' ? ' enviado al comprador' : ''}`,
              externalKey: `verify:${rule.id}`, occurredAt: new Date(),
            },
          }).catch(() => {});
        }
      }
    }
  }
}
