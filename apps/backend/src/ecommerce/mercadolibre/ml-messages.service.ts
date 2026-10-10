import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketplaceType, Prisma, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { integrationsDisabled } from '../../common/integrations.util';
import { MercadolibreService } from './mercadolibre.service';

const ML_API = 'https://api.mercadolibre.com';
const MAX_TEXT = 350; // límite de Mercado Libre para mensajes postventa

export type MlMsg = { id: string; from: 'BUYER' | 'SELLER'; text: string; date: string; attachments?: string[] };

export const RULE_TRIGGERS = ['SALE_CREATED', 'INVOICE_ISSUED', 'ORDER_DISPATCHED', 'ORDER_DELIVERED'] as const;

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

  constructor(private prisma: PrismaService, private ml: MercadolibreService) {}

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

  async list(user: any, q: { companyId?: string; unread?: string; connectionId?: string; search?: string }) {
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
    const rows = await this.prisma.mlConversation.findMany({
      where, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }], take: 200,
      select: {
        id: true, packId: true, buyerName: true, lastText: true, lastFrom: true, lastMessageAt: true, unread: true, blocked: true,
        connection: { select: { id: true, name: true } },
        sale: { select: { id: true, saleNumber: true, items: { take: 1, select: { product: { select: { name: true, images: { take: 1, orderBy: { order: 'asc' }, select: { url: true } } } } } } } },
      },
    });
    return rows;
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
      const data = await this.mlFetch(conv.connectionId, `/messages/packs/${conv.packId}/sellers/${seller}?tag=post_sale&mark_as_read=${markRead ? 'true' : 'false'}`);
      const raw: any[] = data?.messages || [];
      const msgs: MlMsg[] = raw.map((m) => ({
        id: String(m.id),
        from: (String(m.from?.user_id) === String(seller) ? 'SELLER' : 'BUYER') as MlMsg['from'],
        text: String(m.text || ''),
        date: m.message_date?.created || m.date_created || new Date().toISOString(),
        attachments: (m.message_attachments || []).map((a: any) => a.original_filename || a.filename).filter(Boolean),
      })).sort((a, b) => a.date.localeCompare(b.date));
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
        sale: { select: { id: true, saleNumber: true, externalId: true, total: true, items: { take: 3, select: { quantity: true, product: { select: { name: true, images: { take: 1, orderBy: { order: 'asc' }, select: { url: true } } } } } }, order: { select: { id: true } } } },
      },
    });
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
  async send(user: any, id: string, text: string) {
    const conv = await this.prisma.mlConversation.findUnique({ where: { id }, include: { connection: { select: { mlUserId: true } } } });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (user && user.role !== Role.SUPER_ADMIN && conv.companyId !== user.companyId) throw new ForbiddenException();
    await this.sendRaw(conv, text);
    return this.refresh(conv.id, false);
  }

  private async sendRaw(conv: { id: string; connectionId: string; packId: string; buyerId: string | null; saleId: string | null; connection: { mlUserId: string | null } }, rawText: string) {
    const text = String(rawText || '').trim();
    if (!text) throw new BadRequestException('Escribe un mensaje');
    if (text.length > MAX_TEXT) throw new BadRequestException(`Mercado Libre permite hasta ${MAX_TEXT} caracteres`);
    const seller = conv.connection.mlUserId;
    if (!seller) throw new BadRequestException('La cuenta de Mercado Libre no tiene usuario autorizado');
    const buyer = await this.buyerId(conv);
    try {
      await this.mlFetch(conv.connectionId, `/messages/packs/${conv.packId}/sellers/${seller}?tag=post_sale`, {
        method: 'POST', body: JSON.stringify({ from: { user_id: seller }, to: { user_id: buyer }, text }),
      });
    } catch (e: any) {
      // Sin conversación iniciada por el comprador: se inicia con un motivo.
      if (e.status === 403 || e.status === 400) {
        await this.mlFetch(conv.connectionId, `/messages/action_guide/packs/${conv.packId}/option?tag=post_sale`, {
          method: 'POST', body: JSON.stringify({ option_id: 'OTHER', text }),
        });
      } else {
        throw new BadRequestException(`Mercado Libre rechazó el mensaje: ${e.message}`);
      }
    }
    await this.prisma.mlConversation.update({ where: { id: conv.id }, data: { buyerId: buyer, lastText: text, lastFrom: 'SELLER', lastMessageAt: new Date() } });
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
    return this.prisma.mlMessageRule.findMany({
      where: this.companyWhere(user, companyId), orderBy: { createdAt: 'asc' },
      include: { _count: { select: { logs: true } } },
    });
  }

  private checkRule(dto: any) {
    if (!RULE_TRIGGERS.includes(dto.trigger)) throw new BadRequestException('Momento de envío no válido');
    const text = String(dto.text || '').trim();
    if (!text) throw new BadRequestException('Escribe el mensaje');
    if (text.length > MAX_TEXT) throw new BadRequestException(`El mensaje no puede superar ${MAX_TEXT} caracteres`);
    return {
      name: String(dto.name || '').trim() || 'Mensaje programado',
      active: dto.active !== false,
      trigger: dto.trigger,
      delayMinutes: Math.max(0, Math.round(Number(dto.delayMinutes) || 0)),
      text,
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
    return this.prisma.mlMessageRule.update({ where: { id }, data: this.checkRule({ ...rule, minTotal: rule.minTotal != null ? Number(rule.minTotal) : null, ...dto }) });
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

  async runRules() {
    const rules = await this.prisma.mlMessageRule.findMany({ where: { active: true } });
    const now = Date.now();
    for (const rule of rules) {
      // Solo ventas desde que se creó el mensaje programado (no se escribe a ventas antiguas).
      const sales = await this.prisma.sale.findMany({
        where: {
          companyId: rule.companyId, channel: SaleChannel.MERCADO_LIBRE, createdAt: { gte: rule.createdAt },
          ...(rule.connectionId ? { connectionId: rule.connectionId } : { connectionId: { not: null } }),
          ...(rule.minTotal != null ? { total: { gte: rule.minTotal } } : {}),
          mlMessageLogs: { none: { ruleId: rule.id } },
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
        include: {
          items: { take: 1, select: { product: { select: { name: true } } } },
          invoices: { orderBy: { createdAt: 'desc' }, select: { folio: true, pdfUrl: true, status: true, createdAt: true } },
          order: { select: { status: true, dispatchedAt: true, deliveredAt: true, updatedAt: true } },
          company: { select: { name: true } },
        },
      });
      for (const sale of sales) {
        const at = this.triggerAt(rule.trigger, sale);
        if (!at || at.getTime() + rule.delayMinutes * 60_000 > now) continue;
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
            await this.sendRaw(conv, this.fill(rule.text, sale));
          }
        } catch (e: any) {
          status = 'FAILED';
          detail = e.message;
        }
        await this.prisma.mlMessageLog.create({ data: { ruleId: rule.id, saleId: sale.id, status, detail } }).catch(() => {});
      }
    }
  }
}
