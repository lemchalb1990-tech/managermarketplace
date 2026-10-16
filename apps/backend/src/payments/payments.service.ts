import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentMethod, PaymentProvider, PaymentRequestStatus, Prisma, ProductType, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PosService } from '../pos/pos.service';
import { WorkOrdersService } from '../pos/work-orders/work-orders.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { companyPlanFeatures } from '../subscription/subscription.service';
import { assertIntegrationsEnabled, integrationsDisabled } from '../common/integrations.util';
import { primaryFrontendUrl } from '../common/frontend-url.util';
import { isSuperAdmin, resolveCompanyId } from '../common/tenant';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { matchesModule } from '../common/modules.util';
import { assertSalePrices, VARIABLE_PRICE_MODULE } from '../pos/sale-prices.util';
import { CreateSaleDto } from '../pos/dto/pos.dto';
import { ChargeStatus, PaymentAdapter, PaymentCredentials, PaymentSettings } from './payment.types';
import { flowAdapter } from './providers/flow.adapter';
import { mercadoPagoAdapter } from './providers/mercadopago.adapter';

const ADAPTERS: Record<PaymentProvider, PaymentAdapter> = {
  FLOW: flowAdapter,
  MERCADO_PAGO: mercadoPagoAdapter,
};

export const PAYMENT_PROVIDER_NAMES: Record<PaymentProvider, string> = {
  FLOW: 'Flow',
  MERCADO_PAGO: 'Mercado Pago',
};

// Credenciales que se guardan cifradas, por pasarela.
const CREDENTIAL_KEYS: Record<PaymentProvider, string[]> = {
  FLOW: ['apiKey', 'secretKey'],
  MERCADO_PAGO: ['accessToken', 'publicKey'],
};

// Función del plan comercial que habilita los cobros en línea.
export const ONLINE_PAYMENTS_FEATURE = 'ONLINE_PAYMENTS';

const POS_EXPIRY_MIN = 30;
const REMOTE_DEFAULT_HOURS = 24;
const WORK_ORDER_DEFAULT_HOURS = 72;
const FLOW_MIN_AMOUNT = 350;
// Consulta a la pasarela al refrescar la pantalla de espera: como máximo cada estos ms.
const POLL_CHECK_MS = 4000;

const OPEN: PaymentRequestStatus[] = [PaymentRequestStatus.PENDING];

export interface CreatePaymentRequestDto extends CreateSaleDto {
  provider: PaymentProvider;
  remote?: boolean;
  // Solo link a distancia: horas de vigencia (1 a 168).
  expiresInHours?: number;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private pos: PosService,
    private workOrders: WorkOrdersService,
    private settings: SettingsService,
    private email: EmailService,
  ) {}

  private provider(p: string): PaymentProvider {
    const key = String(p || '').toUpperCase() as PaymentProvider;
    if (!ADAPTERS[key]) throw new BadRequestException('Pasarela de pago no soportada');
    return key;
  }

  // La empresa tiene los cobros en línea si su plan (o sus adicionales) los incluye; sin plan, todo.
  private async featureEnabled(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { extraFeatures: true, subscriptionPlan: { select: { features: true } } },
    });
    const features = companyPlanFeatures(company);
    return !features || features.includes(ONLINE_PAYMENTS_FEATURE);
  }

  private async assertFeature(companyId: string) {
    if (!(await this.featureEnabled(companyId))) {
      throw new ForbiddenException('El plan de la empresa no incluye cobros en línea (Flow / Mercado Pago)');
    }
  }

  private decrypt(c: { credentials: Prisma.JsonValue | null }): PaymentCredentials {
    const raw = (c.credentials || {}) as Record<string, string>;
    const out: PaymentCredentials = {};
    for (const [k, v] of Object.entries(raw)) out[k] = decryptSecret(v) ?? undefined;
    return out;
  }

  // Nunca se devuelven las credenciales: solo qué campos están cargados.
  private sanitize(c: any) {
    const creds = (c.credentials || {}) as Record<string, string>;
    return {
      id: c.id, provider: c.provider, name: PAYMENT_PROVIDER_NAMES[c.provider as PaymentProvider], active: c.active,
      settings: c.settings || {}, credentialKeys: Object.keys(creds).filter((k) => !!creds[k]), updatedAt: c.updatedAt,
    };
  }

  // ── Conexiones ────────────────────────────────────────────────────────

  async listConnections(user: any, companyId?: string) {
    const cId = resolveCompanyId(user, companyId);
    const [rows, enabled] = await Promise.all([
      this.prisma.paymentConnection.findMany({ where: { companyId: cId }, orderBy: { provider: 'asc' } }),
      this.featureEnabled(cId),
    ]);
    return { enabled, connections: rows.map((r) => this.sanitize(r)) };
  }

  async upsertConnection(user: any, providerRaw: string, dto: { companyId?: string; credentials?: Record<string, string>; settings?: PaymentSettings; active?: boolean }) {
    const provider = this.provider(providerRaw);
    const companyId = resolveCompanyId(user, dto.companyId);
    await this.assertFeature(companyId);
    const prev = await this.prisma.paymentConnection.findUnique({ where: { companyId_provider: { companyId, provider } } });
    // Las credenciales vacías no borran las guardadas (el formulario no las muestra).
    const credentials = { ...((prev?.credentials as Record<string, string>) || {}) };
    for (const k of CREDENTIAL_KEYS[provider]) {
      const v = dto.credentials?.[k];
      if (v != null && String(v).trim() !== '') credentials[k] = encryptSecret(String(v).trim());
    }
    const environment = dto.settings?.environment === 'test' ? 'test' : dto.settings?.environment === 'prod' ? 'prod' : undefined;
    const settings = { ...((prev?.settings as object) || { environment: 'prod' }), ...(environment ? { environment } : {}) };
    const row = await this.prisma.paymentConnection.upsert({
      where: { companyId_provider: { companyId, provider } },
      update: { credentials, settings, active: dto.active ?? prev?.active ?? true },
      create: { companyId, provider, credentials, settings, active: dto.active ?? true },
    });
    return this.sanitize(row);
  }

  async removeConnection(user: any, providerRaw: string, companyId?: string) {
    const provider = this.provider(providerRaw);
    const cId = resolveCompanyId(user, companyId);
    const conn = await this.prisma.paymentConnection.findUnique({ where: { companyId_provider: { companyId: cId, provider } } });
    if (!conn) return { ok: true };
    const used = await this.prisma.paymentRequest.count({ where: { connectionId: conn.id } });
    if (used > 0) {
      // Con cobros creados se desactiva en vez de borrar (el historial los necesita).
      await this.prisma.paymentConnection.update({ where: { id: conn.id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.paymentConnection.delete({ where: { id: conn.id } });
    return { ok: true };
  }

  async testConnection(user: any, providerRaw: string, companyId?: string) {
    assertIntegrationsEnabled();
    const provider = this.provider(providerRaw);
    const cId = resolveCompanyId(user, companyId);
    const conn = await this.prisma.paymentConnection.findUnique({ where: { companyId_provider: { companyId: cId, provider } } });
    if (!conn) throw new BadRequestException(`${PAYMENT_PROVIDER_NAMES[provider]} no está conectado`);
    return ADAPTERS[provider].test(this.decrypt(conn), (conn.settings || {}) as PaymentSettings);
  }

  /** Pasarelas que el punto de venta puede ofrecer: función del plan + conexión activa. */
  async available(user: any, companyId?: string) {
    const cId = resolveCompanyId(user, companyId);
    if (!(await this.featureEnabled(cId))) return [];
    const rows = await this.prisma.paymentConnection.findMany({ where: { companyId: cId, active: true }, orderBy: { provider: 'asc' } });
    return rows
      .filter((r) => CREDENTIAL_KEYS[r.provider].slice(0, 1).every((k) => !!(r.credentials as any)?.[k]))
      .map((r) => ({ provider: r.provider, name: PAYMENT_PROVIDER_NAMES[r.provider], environment: (r.settings as any)?.environment || 'prod' }));
  }

  // ── URLs públicas ─────────────────────────────────────────────────────

  private async backendUrl(): Promise<string | null> {
    const appUrl = (await this.settings.get('APP_URL'))?.replace(/\/+$/, '');
    return appUrl || null;
  }

  private returnUrl(id: string) {
    return `${primaryFrontendUrl().replace(/\/+$/, '')}/pago/${id}`;
  }

  // ── Cobros ────────────────────────────────────────────────────────────

  async createRequest(user: any, dto: CreatePaymentRequestDto) {
    assertIntegrationsEnabled();
    const provider = this.provider(dto.provider);
    const companyId = resolveCompanyId(user, dto.companyId);
    await this.assertFeature(companyId);
    if (dto.channel !== SaleChannel.POS) throw new BadRequestException('Los cobros en línea son para la venta directa');
    if (!dto.items?.length) throw new BadRequestException('El carrito está vacío');

    const conn = await this.prisma.paymentConnection.findUnique({ where: { companyId_provider: { companyId, provider } } });
    if (!conn || !conn.active) throw new BadRequestException(`${PAYMENT_PROVIDER_NAMES[provider]} no está conectado en esta empresa`);

    // Validación previa (la definitiva la hace la venta al confirmarse el pago).
    const products = await this.prisma.product.findMany({ where: { id: { in: dto.items.map((i) => i.productId) }, companyId } });
    for (const item of dto.items) {
      const p = products.find((x) => x.id === item.productId);
      if (!p) throw new BadRequestException(`Producto ${item.productId} no encontrado`);
      if (!p.active) throw new BadRequestException(`El producto "${p.name}" está inactivo`);
      if (p.type !== ProductType.SERVICIO && !p.dropship && p.stock < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para "${p.name}": disponible ${p.stock}, solicitado ${item.quantity}`);
      }
    }
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { modules: true, name: true } });
    assertSalePrices(dto.items, products, matchesModule(company?.modules, VARIABLE_PRICE_MODULE));

    const amount = Math.round(dto.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
    if (!(amount > 0)) throw new BadRequestException('El total debe ser mayor a 0');
    if (provider === PaymentProvider.FLOW && amount < FLOW_MIN_AMOUNT) {
      throw new BadRequestException(`Flow acepta cobros desde $${FLOW_MIN_AMOUNT}`);
    }

    // Datos del cliente (o del cliente registrado elegido).
    let client: { name: string; email: string | null; phone: string | null } | null = null;
    if (dto.clientId) {
      const c = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
      if (!c || c.companyId !== companyId) throw new BadRequestException('Cliente no válido para esta empresa');
      client = { name: c.name, email: c.email, phone: c.phone };
    }
    const customerEmail = dto.customerEmail || client?.email || null;
    // Flow exige un correo: si no hay del cliente, el comprobante de Flow llega al vendedor.
    const chargeEmail = customerEmail || (provider === PaymentProvider.FLOW ? user.email : null);

    const remote = !!dto.remote;
    const hours = Math.min(168, Math.max(1, Math.round(Number(dto.expiresInHours) || REMOTE_DEFAULT_HOURS)));
    const expiresAt = new Date(Date.now() + (remote ? hours * 3600_000 : POS_EXPIRY_MIN * 60_000));

    const { provider: _p, remote: _r, expiresInHours: _e, ...saleData } = dto;
    return this.startCharge(user, conn, {
      provider, amount, remote, expiresAt, chargeEmail,
      subject: `Compra en ${company?.name || 'tienda'}`,
      data: {
        saleData: { ...saleData, companyId } as unknown as Prisma.InputJsonValue,
        customerName: dto.customerName || client?.name || null,
        customerEmail,
        customerPhone: dto.customerPhone || client?.phone || null,
      },
    });
  }

  /** Link de pago de una orden de trabajo pendiente: al pagarse, se convierte en venta. */
  async createForWorkOrder(user: any, workOrderId: string, dto: { provider: PaymentProvider; expiresInHours?: number }) {
    assertIntegrationsEnabled();
    const provider = this.provider(dto.provider);
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { items: true, client: true, company: { select: { name: true } } },
    });
    if (!wo || (!isSuperAdmin(user) && wo.companyId !== user.companyId)) throw new NotFoundException('Orden de trabajo no encontrada');
    if (wo.status !== 'PENDING') throw new BadRequestException('La orden de trabajo ya fue procesada');
    await this.assertFeature(wo.companyId);
    const conn = await this.prisma.paymentConnection.findUnique({ where: { companyId_provider: { companyId: wo.companyId, provider } } });
    if (!conn || !conn.active) throw new BadRequestException(`${PAYMENT_PROVIDER_NAMES[provider]} no está conectado en esta empresa`);

    // Un solo link vigente por orden: si ya hay uno pendiente, se reutiliza.
    const open = await this.prisma.paymentRequest.findFirst({
      where: { workOrderId, status: PaymentRequestStatus.PENDING, expiresAt: { gt: new Date() } },
      include: { sale: { select: { saleNumber: true } }, workOrder: { select: { folio: true } } },
    });
    if (open) {
      if (open.provider !== provider) throw new BadRequestException(`Ya hay un link de ${PAYMENT_PROVIDER_NAMES[open.provider]} pendiente para esta orden; cancélalo para generar otro`);
      return this.view(open);
    }

    const amount = Math.round(wo.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0));
    if (!(amount > 0)) throw new BadRequestException('El total de la orden debe ser mayor a 0');
    if (provider === PaymentProvider.FLOW && amount < FLOW_MIN_AMOUNT) throw new BadRequestException(`Flow acepta cobros desde $${FLOW_MIN_AMOUNT}`);

    const customerEmail = wo.customerEmail || wo.client?.email || null;
    const hours = Math.min(168, Math.max(1, Math.round(Number(dto.expiresInHours) || WORK_ORDER_DEFAULT_HOURS)));
    return this.startCharge(user, conn, {
      provider, amount, remote: true,
      expiresAt: new Date(Date.now() + hours * 3600_000),
      chargeEmail: customerEmail || (provider === PaymentProvider.FLOW ? user.email : null),
      subject: `Orden de trabajo N° ${String(wo.folio).padStart(4, '0')} — ${wo.company?.name || 'tienda'}`,
      data: {
        saleData: {} as Prisma.InputJsonValue,
        customerName: wo.customerName || wo.client?.name || null,
        customerEmail,
        customerPhone: wo.customerPhone || wo.client?.phone || null,
        workOrderId: wo.id,
      },
    }, wo.companyId);
  }

  // Crea la solicitud y el cobro en la pasarela (link). Si la pasarela falla, queda cancelada.
  private async startCharge(
    user: any,
    conn: { id: string; companyId: string; credentials: Prisma.JsonValue | null; settings: Prisma.JsonValue | null },
    o: {
      provider: PaymentProvider; amount: number; remote: boolean; expiresAt: Date; chargeEmail: string | null; subject: string;
      data: { saleData: Prisma.InputJsonValue; customerName: string | null; customerEmail: string | null; customerPhone: string | null; workOrderId?: string };
    },
    companyId = conn.companyId,
  ) {
    const { provider, amount, subject, remote, expiresAt, chargeEmail } = o;
    const req = await this.prisma.paymentRequest.create({
      data: {
        provider, amount, subject, remote, expiresAt, ...o.data,
        companyId, connectionId: conn.id,
        createdById: user.id ?? null, createdByName: user.name ?? user.email ?? null,
      },
    });

    const api = await this.backendUrl();
    const notifyUrl = api ? `${api}/api/payments/webhook/${provider === PaymentProvider.FLOW ? 'flow' : 'mercadopago'}/${req.id}` : null;
    try {
      const charge = await ADAPTERS[provider].createCharge(this.decrypt(conn), (conn.settings || {}) as PaymentSettings, {
        requestId: req.id, amount, subject, email: chargeEmail, expiresAt, notifyUrl,
        returnUrl: this.returnUrl(req.id),
        flowReturnUrl: `${api || ''}/api/payments/flow/return/${req.id}`,
      });
      const updated = await this.prisma.paymentRequest.update({
        where: { id: req.id },
        data: { paymentUrl: charge.url, providerRef: charge.providerRef },
        include: { workOrder: { select: { folio: true } } },
      });
      return this.view(updated);
    } catch (e: any) {
      // Sin link no hay cobro: la solicitud queda cancelada con el motivo.
      await this.prisma.paymentRequest.update({
        where: { id: req.id },
        data: { status: PaymentRequestStatus.CANCELLED, cancelledAt: new Date(), error: String(e?.message || e) },
      });
      throw new BadRequestException(`${PAYMENT_PROVIDER_NAMES[provider]}: ${e?.message || 'no se pudo crear el cobro'}`);
    }
  }

  private view(r: any) {
    return {
      id: r.id, provider: r.provider, providerName: PAYMENT_PROVIDER_NAMES[r.provider as PaymentProvider], status: r.status,
      amount: Number(r.amount), subject: r.subject, remote: r.remote, paymentUrl: r.paymentUrl,
      customerName: r.customerName, customerEmail: r.customerEmail, customerPhone: r.customerPhone,
      paymentMethodName: r.paymentMethodName, fee: r.fee != null ? Number(r.fee) : null,
      statusDetail: r.statusDetail, error: r.error, expiresAt: r.expiresAt, paidAt: r.paidAt, cancelledAt: r.cancelledAt,
      createdAt: r.createdAt, createdByName: r.createdByName, saleId: r.saleId,
      saleNumber: r.sale?.saleNumber ?? null,
      workOrderId: r.workOrderId ?? null, workOrderFolio: r.workOrder?.folio ?? null,
      itemsCount: Array.isArray(r.saleData?.items) ? r.saleData.items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0) : 0,
    };
  }

  private async findForUser(user: any, id: string) {
    const r = await this.prisma.paymentRequest.findUnique({ where: { id }, include: { sale: { select: { saleNumber: true } }, workOrder: { select: { folio: true } } } });
    if (!r || (!isSuperAdmin(user) && r.companyId !== user.companyId)) throw new NotFoundException('Cobro no encontrado');
    return r;
  }

  async listRequests(user: any, q: { companyId?: string; status?: string; page?: string; workOrderId?: string }) {
    const cId = resolveCompanyId(user, q.companyId);
    const where: Prisma.PaymentRequestWhereInput = { companyId: cId, ...(q.workOrderId ? { workOrderId: q.workOrderId } : {}) };
    if (q.status && (Object.values(PaymentRequestStatus) as string[]).includes(q.status)) where.status = q.status as PaymentRequestStatus;
    const page = Math.max(1, Number(q.page) || 1);
    const take = 30;
    const [rows, total, review] = await Promise.all([
      this.prisma.paymentRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take, include: { sale: { select: { saleNumber: true } }, workOrder: { select: { folio: true } } } }),
      this.prisma.paymentRequest.count({ where }),
      this.prisma.paymentRequest.count({ where: { companyId: cId, status: PaymentRequestStatus.NEEDS_REVIEW } }),
    ]);
    return { items: rows.map((r) => this.view(r)), total, page, pages: Math.max(1, Math.ceil(total / take)), needsReview: review };
  }

  /** Estado del cobro (pantalla de espera del POS). Si sigue pendiente, consulta la pasarela. */
  async getRequest(user: any, id: string) {
    const r = await this.findForUser(user, id);
    if (OPEN.includes(r.status) && (!r.lastCheckedAt || Date.now() - r.lastCheckedAt.getTime() > POLL_CHECK_MS)) {
      await this.check(r.id).catch((e) => this.logger.warn(`Consulta de cobro ${r.id}: ${e?.message || e}`));
      return this.view(await this.findForUser(user, id));
    }
    return this.view(r);
  }

  /** Página pública de vuelta del cliente: datos mínimos. */
  async publicStatus(id: string) {
    const r = await this.prisma.paymentRequest.findUnique({ where: { id }, include: { company: { select: { name: true } } } });
    if (!r) throw new NotFoundException('Cobro no encontrado');
    if (r.status === PaymentRequestStatus.PENDING) await this.check(r.id).catch(() => {});
    const fresh = await this.prisma.paymentRequest.findUnique({ where: { id } });
    const status = fresh!.status;
    return {
      status: status === PaymentRequestStatus.PROCESSING || status === PaymentRequestStatus.NEEDS_REVIEW ? 'PAID' : status,
      amount: Number(r.amount),
      companyName: r.company?.name ?? null,
      providerName: PAYMENT_PROVIDER_NAMES[r.provider],
      paymentUrl: status === PaymentRequestStatus.PENDING ? r.paymentUrl : null,
    };
  }

  async cancelRequest(user: any, id: string) {
    const r = await this.findForUser(user, id);
    if (r.status !== PaymentRequestStatus.PENDING) throw new BadRequestException('Solo se puede cancelar un cobro pendiente');
    // Antes de cancelar se confirma que no se haya pagado recién.
    await this.check(r.id).catch(() => {});
    const now = await this.prisma.paymentRequest.findUnique({ where: { id }, include: { sale: { select: { saleNumber: true } }, workOrder: { select: { folio: true } } } });
    if (now!.status !== PaymentRequestStatus.PENDING) return this.view(now);
    const conn = await this.prisma.paymentConnection.findUnique({ where: { id: r.connectionId } });
    if (conn && ADAPTERS[r.provider].cancel && !integrationsDisabled()) {
      await ADAPTERS[r.provider].cancel!(this.decrypt(conn), (conn.settings || {}) as PaymentSettings, r)
        .catch((e) => this.logger.warn(`No se pudo vencer el link ${r.id} en ${r.provider}: ${e?.message || e}`));
    }
    const res = await this.prisma.paymentRequest.updateMany({
      where: { id, status: PaymentRequestStatus.PENDING },
      data: { status: PaymentRequestStatus.CANCELLED, cancelledAt: new Date(), statusDetail: `Cancelado por ${user.name ?? user.email ?? 'usuario'}` },
    });
    if (!res.count) throw new BadRequestException('El cobro cambió de estado; vuelve a cargar');
    return this.view(await this.findForUser(user, id));
  }

  /** Cobro pagado que quedó en revisión: vuelve a intentar crear la venta. */
  async retrySale(user: any, id: string) {
    const r = await this.findForUser(user, id);
    if (r.status !== PaymentRequestStatus.NEEDS_REVIEW || !r.providerPaymentId) {
      throw new BadRequestException('Solo se puede crear la venta de un cobro pagado en revisión');
    }
    const claimed = await this.prisma.paymentRequest.updateMany({
      where: { id, status: PaymentRequestStatus.NEEDS_REVIEW },
      data: { status: PaymentRequestStatus.PROCESSING, error: null },
    });
    if (claimed.count) await this.createSaleFor(id);
    return this.view(await this.findForUser(user, id));
  }

  /** Cobro en revisión resuelto sin venta (p. ej. se devolvió el dinero en la pasarela). */
  async dismiss(user: any, id: string) {
    const r = await this.findForUser(user, id);
    if (r.status !== PaymentRequestStatus.NEEDS_REVIEW) throw new BadRequestException('Solo se cierran cobros en revisión');
    await this.prisma.paymentRequest.update({
      where: { id },
      data: { status: PaymentRequestStatus.CANCELLED, cancelledAt: new Date(), statusDetail: `Cerrado sin venta por ${user.name ?? user.email ?? 'usuario'}` },
    });
    return this.view(await this.findForUser(user, id));
  }

  async sendEmail(user: any, id: string, to: string) {
    const r = await this.findForUser(user, id);
    if (r.status !== PaymentRequestStatus.PENDING || !r.paymentUrl) throw new BadRequestException('El cobro ya no está pendiente');
    const email = String(to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Correo no válido');
    try {
      await this.email.sendPaymentLinkEmail(r.companyId, email, {
        amount: Number(r.amount), url: r.paymentUrl, providerName: PAYMENT_PROVIDER_NAMES[r.provider], expiresAt: r.expiresAt,
        customerName: r.customerName,
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'No se pudo enviar el correo');
    }
    return { ok: true };
  }

  // ── Confirmación del pago ─────────────────────────────────────────────

  /** Consulta la pasarela y aplica el resultado. Lo usan el webhook, la pantalla de espera y el cron. */
  async check(id: string): Promise<void> {
    if (integrationsDisabled()) return;
    const r = await this.prisma.paymentRequest.findUnique({ where: { id }, include: { connection: true } });
    if (!r) return;
    // Los cancelados/vencidos también se revisan: un pago tardío no puede perderse.
    const checkable: PaymentRequestStatus[] = [PaymentRequestStatus.PENDING, PaymentRequestStatus.CANCELLED, PaymentRequestStatus.EXPIRED];
    if (!checkable.includes(r.status)) return;
    let st: ChargeStatus;
    try {
      st = await ADAPTERS[r.provider].getStatus(this.decrypt(r.connection), (r.connection.settings || {}) as PaymentSettings, r);
    } finally {
      await this.prisma.paymentRequest.update({ where: { id }, data: { lastCheckedAt: new Date() } }).catch(() => {});
    }
    await this.apply(r, st);
  }

  private async apply(r: { id: string; status: PaymentRequestStatus; amount: Prisma.Decimal }, st: ChargeStatus) {
    if (st.state !== 'PAID') {
      if (r.status === PaymentRequestStatus.PENDING && st.detail !== undefined) {
        await this.prisma.paymentRequest.update({ where: { id: r.id }, data: { statusDetail: st.detail ?? null } });
      }
      return;
    }
    const paidAt = st.paidAt && !isNaN(st.paidAt.getTime()) ? st.paidAt : new Date();
    const paymentData = {
      providerPaymentId: st.paymentId ?? null, paymentMethodName: st.methodName ?? null,
      fee: st.fee != null ? st.fee : null, paidAt, statusDetail: null,
    };
    const amount = Number(r.amount);
    if (st.amount != null && st.amount + 1 < amount) {
      await this.prisma.paymentRequest.updateMany({
        where: { id: r.id, status: { in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.CANCELLED, PaymentRequestStatus.EXPIRED] } },
        data: { ...paymentData, status: PaymentRequestStatus.NEEDS_REVIEW, error: `Se pagaron $${Math.round(st.amount)} de $${Math.round(amount)}: revisa en la pasarela antes de crear la venta` },
      });
      return;
    }
    if (r.status !== PaymentRequestStatus.PENDING) {
      // Pagado después de cancelar o vencer: puede que ya se haya cobrado de otra forma.
      await this.prisma.paymentRequest.updateMany({
        where: { id: r.id, status: r.status },
        data: {
          ...paymentData, status: PaymentRequestStatus.NEEDS_REVIEW,
          error: `El cliente pagó después de que el cobro quedó ${r.status === PaymentRequestStatus.CANCELLED ? 'cancelado' : 'vencido'}. Crea la venta o devuelve el dinero desde la pasarela.`,
        },
      });
      return;
    }
    // Solo uno toma el cobro (webhook, pantalla y cron pueden llegar a la vez).
    const claimed = await this.prisma.paymentRequest.updateMany({
      where: { id: r.id, status: PaymentRequestStatus.PENDING },
      data: { ...paymentData, status: PaymentRequestStatus.PROCESSING },
    });
    if (claimed.count) await this.createSaleFor(r.id);
  }

  // Crea la venta del punto de venta con el carrito guardado, como lo haría el vendedor al cobrar.
  private async createSaleFor(id: string) {
    const r = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!r || r.status !== PaymentRequestStatus.PROCESSING) return;
    const externalId = `PAY-${r.id}`;
    const method = r.provider === PaymentProvider.FLOW ? PaymentMethod.FLOW : PaymentMethod.MERCADO_PAGO;
    try {
      let sale: { id: string } | null = null;
      if (r.workOrderId) {
        // Orden de trabajo: se convierte en venta como con «Convertir en venta» (crea la orden
        // de retiro y libera la reserva). Si ya estaba convertida, se vincula esa venta.
        const wo = await this.prisma.workOrder.findUnique({ where: { id: r.workOrderId }, select: { status: true, saleId: true } });
        if (!wo) throw new Error('La orden de trabajo ya no existe');
        if (wo.status === 'CONVERTED' && wo.saleId) sale = { id: wo.saleId };
        else if (wo.status !== 'PENDING') throw new Error(`La orden de trabajo está ${wo.status === 'CANCELLED' ? 'anulada' : wo.status === 'REJECTED' ? 'rechazada' : 'cerrada'}`);
        else {
          const user = await this.saleUser(r.createdById, r.companyId);
          const created = await this.workOrders.convertToSale(r.workOrderId, { paymentMethod: method }, user, { fromPayment: true });
          sale = { id: created!.id };
        }
      }
      // Si la venta ya existe (un intento anterior alcanzó a crearla), solo se vincula.
      if (!sale) sale = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.POS, externalId }, select: { id: true } });
      if (!sale) {
        const user = await this.saleUser(r.createdById, r.companyId);
        const data = r.saleData as unknown as CreateSaleDto;
        const created = await this.pos.createSale({
          ...data,
          channel: SaleChannel.POS,
          companyId: r.companyId,
          externalId,
          paymentMethod: method,
          payments: undefined,
          notes: [data.notes, `Pagado con ${PAYMENT_PROVIDER_NAMES[r.provider]}${r.providerPaymentId ? ` (${r.providerPaymentId})` : ''}`].filter(Boolean).join(' · '),
        } as CreateSaleDto, user);
        sale = { id: created!.id };
      }
      await this.prisma.sale.update({ where: { id: sale.id }, data: { paymentMethodName: r.paymentMethodName } }).catch(() => {});
      await this.prisma.paymentRequest.update({ where: { id }, data: { status: PaymentRequestStatus.PAID, saleId: sale.id, error: null } });
      this.logger.log(`Cobro ${id} pagado con ${r.provider}: venta ${sale.id}`);
    } catch (e: any) {
      const msg = e?.response?.message || e?.message || String(e);
      this.logger.error(`Cobro ${id} pagado pero la venta no se creó: ${msg}`);
      await this.prisma.paymentRequest.update({
        where: { id },
        data: { status: PaymentRequestStatus.NEEDS_REVIEW, error: `Pagado, pero la venta no se pudo crear: ${Array.isArray(msg) ? msg.join(', ') : msg}` },
      });
    }
  }

  // Usuario con el que se registra la venta: quien generó el cobro (con su tienda asignada);
  // si ya no existe o está inactivo, un administrador activo de la empresa.
  private async saleUser(userId: string | null, companyId: string) {
    const include = { company: { include: { subscriptionPlan: true } }, accessProfile: true } as const;
    let u = userId ? await this.prisma.user.findFirst({ where: { id: userId, active: true }, include }) : null;
    if (!u) u = await this.prisma.user.findFirst({ where: { companyId, active: true, role: Role.COMPANY_ADMIN }, include, orderBy: { createdAt: 'asc' } });
    if (!u) throw new Error('No hay un usuario activo de la empresa para registrar la venta');
    const { password: _, ...rest } = u;
    return rest;
  }

  // ── Webhooks ──────────────────────────────────────────────────────────

  async webhook(provider: PaymentProvider, id: string) {
    const r = await this.prisma.paymentRequest.findUnique({ where: { id }, select: { provider: true } });
    if (!r || r.provider !== provider) return { ok: true };
    await this.check(id).catch((e) => this.logger.warn(`Webhook ${provider} cobro ${id}: ${e?.message || e}`));
    return { ok: true };
  }

  // ── Revisión periódica (por si un aviso no llegó) ──────────────────────

  @Cron('*/2 * * * *')
  async sweep() {
    if (integrationsDisabled()) return;
    const now = new Date();
    // Ventas que quedaron a medio crear (caída del proceso): a revisión.
    await this.prisma.paymentRequest.updateMany({
      where: { status: PaymentRequestStatus.PROCESSING, updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
      data: { status: PaymentRequestStatus.NEEDS_REVIEW, error: 'Pagado, pero la creación de la venta se interrumpió. Usa «Crear venta».' },
    });
    const pending = await this.prisma.paymentRequest.findMany({
      where: {
        status: PaymentRequestStatus.PENDING,
        createdAt: { lt: new Date(now.getTime() - 60_000) },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 90_000) } }],
      },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
      select: { id: true, expiresAt: true },
    });
    for (const p of pending) {
      try {
        await this.check(p.id);
      } catch (e: any) {
        this.logger.warn(`Revisión de cobro ${p.id}: ${e?.message || e}`);
      }
      if (p.expiresAt < now) {
        await this.prisma.paymentRequest.updateMany({
          where: { id: p.id, status: PaymentRequestStatus.PENDING },
          data: { status: PaymentRequestStatus.EXPIRED, statusDetail: 'El link venció sin pago' },
        });
      }
    }
    // Pagos tardíos: los vencidos o cancelados en las últimas 24 h se revisan una vez más cada hora.
    if (now.getUTCMinutes() < 2) {
      const late = await this.prisma.paymentRequest.findMany({
        where: {
          providerRef: { not: null },
          OR: [
            { status: PaymentRequestStatus.CANCELLED, cancelledAt: { gt: new Date(now.getTime() - 24 * 3600_000) } },
            { status: PaymentRequestStatus.EXPIRED, expiresAt: { gt: new Date(now.getTime() - 24 * 3600_000) } },
          ],
        },
        take: 50, select: { id: true },
      });
      for (const l of late) await this.check(l.id).catch(() => {});
    }
  }
}
