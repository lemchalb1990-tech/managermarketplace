import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { BillingConnection, BillingProvider, DteType, Invoice, InvoiceStatus, PaymentCondition, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OpenFacturaAdapter } from './providers/openfactura.adapter';
import { BsaleAdapter } from './providers/bsale.adapter';
import { FactoAdapter } from './providers/facto.adapter';
import { BillingStubAdapter } from './providers/stub.adapter';
import { BillingAdapter } from './providers/provider.interface';
import { CreateBillingConnectionDto, IssueInvoiceDto, ListInvoicesDto, MarkInvoicePaidDto, UpsertBillingProfileDto } from './dto/billing.dto';
import { normalizeRut } from '../common/rut.util';
import { EmailService } from '../email/email.service';

const PAGE_SIZE = 20;

const IVA = 0.19;

@Injectable()
export class BillingService {
  private adapters: Map<BillingProvider, BillingAdapter>;

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private openfactura: OpenFacturaAdapter,
    private bsale: BsaleAdapter,
    private facto: FactoAdapter,
    private stub: BillingStubAdapter,
  ) {
    this.adapters = new Map<BillingProvider, BillingAdapter>([
      [BillingProvider.OPENFACTURA, openfactura],
      [BillingProvider.BSALE, bsale],
      [BillingProvider.FACTO, facto],
      [BillingProvider.DEFONTANA, stub],
      [BillingProvider.NUBOX, stub],
      [BillingProvider.SIIGO, stub],
    ]);
  }

  private adapter(provider: BillingProvider): BillingAdapter {
    return this.adapters.get(provider) ?? this.stub;
  }

  private companyId(user: any): string {
    if (user.role === Role.SUPER_ADMIN) return user.companyId;
    return user.companyId;
  }

  private resolveCompanyId(user: any, dto?: { companyId?: string }): string {
    if (user.role === Role.SUPER_ADMIN && dto?.companyId) return dto.companyId;
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  // ── Connections ──────────────────────────────────────────────────

  async getConnections(user: any, companyId?: string) {
    const where: any = {};
    if (user.role === Role.SUPER_ADMIN) {
      if (companyId) where.companyId = companyId;
    } else {
      where.companyId = user.companyId;
    }
    return this.prisma.billingConnection.findMany({
      where,
      include: { company: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createConnection(dto: CreateBillingConnectionDto, user: any) {
    const cId = this.resolveCompanyId(user, dto);
    const conn = await this.prisma.billingConnection.create({
      data: {
        name: dto.name,
        provider: dto.provider,
        credentials: dto.credentials ?? {},
        companyId: cId,
      },
    });
    const result = await this.adapter(dto.provider).testConnection(
      (dto.credentials ?? {}) as Record<string, string>,
    );
    if (!result.success) {
      await this.prisma.billingConnection.delete({ where: { id: conn.id } });
      throw new BadRequestException(result.message ?? 'No se pudo conectar con el proveedor');
    }
    return conn;
  }

  async deleteConnection(id: string, user: any) {
    const conn = await this.prisma.billingConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return this.prisma.billingConnection.delete({ where: { id } });
  }

  async testConnection(id: string, user: any) {
    const conn = await this.prisma.billingConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return this.adapter(conn.provider).testConnection(
      (conn.credentials ?? {}) as Record<string, string>,
    );
  }

  // ── Invoices ──────────────────────────────────────────────────────

  async getInvoices(user: any, query: ListInvoicesDto) {
    const page = Number(query.page ?? 1);
    const where: any = {};

    if (user.role === Role.SUPER_ADMIN) {
      if (query.companyId) where.companyId = query.companyId;
    } else {
      where.companyId = user.companyId;
    }
    if (query.dteType) where.dteType = query.dteType;
    if (query.status) where.status = query.status as InvoiceStatus;
    if (query.connectionId) where.connectionId = query.connectionId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { connection: { select: { id: true, name: true, provider: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { invoices, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  private async resolveConnectionAndRefs(dto: IssueInvoiceDto, user: any) {
    const conn = await this.prisma.billingConnection.findUnique({ where: { id: dto.connectionId } });
    if (!conn) throw new NotFoundException('Conexión de facturación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    if (dto.saleId) {
      const sale = await this.prisma.sale.findUnique({ where: { id: dto.saleId } });
      if (!sale || sale.companyId !== conn.companyId) {
        throw new BadRequestException('La venta indicada no pertenece a esta empresa');
      }
    }
    if (dto.clientId) {
      const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
      if (!client || client.companyId !== conn.companyId) {
        throw new BadRequestException('El cliente indicado no pertenece a esta empresa');
      }
    }
    return conn;
  }

  // Replica línea por línea el mismo redondeo que hace el proveedor (ver facto.adapter.ts)
  // para que el total guardado/mostrado en Documentos Emitidos sea siempre el mismo que el
  // del DTE real emitido. Antes se calculaba el neto sumando los montos sin redondear y (para
  // documentos exentos) se dividía por 1+IVA, lo que dejaba el total guardado muy por debajo
  // del monto real timbrado por el proveedor.
  private computeAmounts(dto: Pick<IssueInvoiceDto, 'dteType' | 'items'>) {
    const isExempt = dto.dteType === DteType.FACTURA_EXENTA || dto.dteType === DteType.BOLETA;
    let netAmount = 0;
    let tax = 0;
    for (const i of dto.items) {
      const lineNet = Math.round(i.unitPrice * i.quantity * (1 - (i.discount ?? 0) / 100));
      netAmount += lineNet;
      tax += isExempt ? 0 : Math.round(lineNet * IVA);
    }
    return { netAmount, tax, totalAmount: netAmount + tax };
  }

  // Datos de pago que se guardan en el Invoice (condición + vencimiento). El vencimiento
  // solo aplica a crédito; de contado se ignora.
  private paymentData(dto: IssueInvoiceDto) {
    const condition = dto.paymentCondition ?? null;
    const dueDate =
      condition === PaymentCondition.CREDITO && dto.dueDate ? new Date(dto.dueDate) : null;
    return { paymentCondition: condition, dueDate };
  }

  // Tras emitir un documento de contado, si se pidió marcar el pago se registra de una vez.
  private async applyPaidOnIssue(
    invoice: Invoice,
    opts: { markPaid?: boolean; paymentMethod?: any; paymentReference?: string },
  ) {
    if (!opts.markPaid) return invoice;
    if (invoice.paymentCondition === PaymentCondition.CREDITO) return invoice;
    if (invoice.status !== InvoiceStatus.ISSUED && invoice.status !== InvoiceStatus.ACCEPTED) return invoice;
    if (invoice.paid) return invoice;
    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paid: true,
        paidAt: new Date(),
        paymentMethod: opts.paymentMethod ?? null,
        paymentReference: opts.paymentReference ?? null,
      },
    });
  }

  // Intenta emitir un Invoice ya guardado (DRAFT) ante el proveedor real. La identidad del
  // emisor sale del Perfil de facturación de la empresa (si está configurado), completando
  // lo que falte en las credenciales propias de la conexión para no romper conexiones ya
  // configuradas a mano.
  private async emitToProvider(invoice: Invoice, conn: BillingConnection) {
    const profile = await this.prisma.billingProfile.findUnique({ where: { companyId: conn.companyId } });
    const baseCredentials = (conn.credentials ?? {}) as Record<string, string>;
    const credentials: Record<string, string> = {
      ...baseCredentials,
      companyRut: normalizeRut(profile?.rut || baseCredentials.companyRut),
      companyName: profile?.razonSocial || baseCredentials.companyName,
      companyAddress: profile?.address || baseCredentials.companyAddress,
      companyDistrict: profile?.commune || baseCredentials.companyDistrict,
      companyCity: profile?.city || baseCredentials.companyCity,
      companyPhone: profile?.phone || baseCredentials.companyPhone,
      companyActivity: profile?.giro || baseCredentials.companyActivity,
    };

    try {
      const result = await this.adapter(conn.provider).issueDte(credentials, {
        dteType: invoice.dteType,
        rut: normalizeRut(invoice.rut),
        razonSocial: invoice.razonSocial,
        giro: invoice.giro ?? undefined,
        address: invoice.address ?? undefined,
        commune: invoice.commune ?? undefined,
        email: invoice.email ?? undefined,
        items: invoice.items as any,
        notes: invoice.notes ?? undefined,
        companyRut: credentials.companyRut,
        paymentCondition: invoice.paymentCondition ?? undefined,
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : undefined,
      });
      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          externalId: result.externalId,
          folio: result.folio,
          pdfUrl: result.pdfUrl,
          xmlUrl: result.xmlUrl,
          status: InvoiceStatus.ISSUED,
          issuedAt: new Date(),
        },
      });
    } catch (err: any) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.REJECTED, errorMsg: err.message },
      });
      throw new BadRequestException(err.message);
    }
  }

  async issueInvoice(dto: IssueInvoiceDto, user: any) {
    const conn = await this.resolveConnectionAndRefs(dto, user);
    const { netAmount, tax, totalAmount } = this.computeAmounts(dto);

    const invoice = await this.prisma.invoice.create({
      data: {
        dteType: dto.dteType,
        rut: normalizeRut(dto.rut),
        razonSocial: dto.razonSocial,
        giro: dto.giro,
        address: dto.address,
        commune: dto.commune,
        email: dto.email,
        netAmount,
        tax,
        totalAmount,
        items: dto.items as any,
        notes: dto.notes,
        status: InvoiceStatus.DRAFT,
        connectionId: conn.id,
        companyId: conn.companyId,
        saleId: dto.saleId,
        clientId: dto.clientId,
        ...this.paymentData(dto),
      },
    });

    const issued = await this.emitToProvider(invoice, conn);
    return this.applyPaidOnIssue(issued, dto);
  }

  // Guarda el documento como borrador sin emitirlo ante el proveedor — se puede retomar
  // más tarde desde el listado de documentos con issueDraft.
  async saveDraft(dto: IssueInvoiceDto, user: any) {
    const conn = await this.resolveConnectionAndRefs(dto, user);
    const { netAmount, tax, totalAmount } = this.computeAmounts(dto);

    return this.prisma.invoice.create({
      data: {
        dteType: dto.dteType,
        rut: normalizeRut(dto.rut),
        razonSocial: dto.razonSocial,
        giro: dto.giro,
        address: dto.address,
        commune: dto.commune,
        email: dto.email,
        netAmount,
        tax,
        totalAmount,
        items: dto.items as any,
        notes: dto.notes,
        status: InvoiceStatus.DRAFT,
        connectionId: conn.id,
        companyId: conn.companyId,
        saleId: dto.saleId,
        clientId: dto.clientId,
        ...this.paymentData(dto),
      },
    });
  }

  // Sobrescribe los datos de un documento guardado como borrador (nunca uno ya emitido:
  // un DTE real no se puede editar, solo corregir con una Nota de Crédito aparte).
  async updateDraft(id: string, dto: IssueInvoiceDto, user: any) {
    const existing = await this.prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Documento no encontrado');
    if (user.role !== Role.SUPER_ADMIN && existing.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden editar documentos en estado borrador');
    }

    const conn = await this.resolveConnectionAndRefs(dto, user);
    if (conn.companyId !== existing.companyId) throw new ForbiddenException();
    const { netAmount, tax, totalAmount } = this.computeAmounts(dto);

    return this.prisma.invoice.update({
      where: { id },
      data: {
        dteType: dto.dteType,
        rut: normalizeRut(dto.rut),
        razonSocial: dto.razonSocial,
        giro: dto.giro,
        address: dto.address,
        commune: dto.commune,
        email: dto.email,
        netAmount,
        tax,
        totalAmount,
        items: dto.items as any,
        notes: dto.notes,
        connectionId: conn.id,
        saleId: dto.saleId,
        clientId: dto.clientId,
        ...this.paymentData(dto),
      },
    });
  }

  // Emite ante el proveedor real un documento que ya estaba guardado como borrador.
  async issueDraft(
    id: string,
    user: any,
    opts?: { markPaid?: boolean; paymentMethod?: any; paymentReference?: string },
  ) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { connection: true } });
    if (!invoice) throw new NotFoundException('Documento no encontrado');
    if (user.role !== Role.SUPER_ADMIN && invoice.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden emitir documentos en estado borrador');
    }
    const issued = await this.emitToProvider(invoice, invoice.connection);
    return this.applyPaidOnIssue(issued, opts ?? {});
  }

  async getInvoice(id: string, user: any) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        connection: { select: { id: true, name: true, provider: true } },
        client: { select: { id: true, name: true, email: true } },
      },
    });
    if (!inv) throw new NotFoundException();
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    return inv;
  }

  /** Envía el DTE ya emitido por correo (destinatario opcional; si no, usa el email del DTE o del cliente). */
  async sendInvoiceByEmail(id: string, user: any, toOverride?: string) {
    const inv = await this.getInvoice(id, user);
    if (inv.status !== InvoiceStatus.ISSUED) {
      throw new BadRequestException('Solo se pueden enviar documentos ya emitidos');
    }
    const to = (toOverride || inv.email || (inv as any).client?.email || '').trim();
    if (!to) throw new BadRequestException('No hay un correo de destino');
    await this.email.sendInvoiceEmail(inv.companyId, to, inv);
    return { sent: true, to };
  }

  // Borra por completo un documento que nunca llegó a emitirse (sin folio asignado por el
  // proveedor) — borrador o intento fallido. Uno ya emitido (con folio) nunca se borra, solo
  // se anula, porque es un documento tributario real ante el SII.
  async deleteInvoice(id: string, user: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException();
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    if (inv.folio != null) {
      throw new BadRequestException('No se puede eliminar un documento ya emitido (tiene folio asignado). Anúlalo en su lugar.');
    }
    await this.prisma.invoice.delete({ where: { id } });
    return { deleted: true };
  }

  async cancelInvoice(id: string, user: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException();
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    if (inv.status === InvoiceStatus.CANCELLED) throw new BadRequestException('Ya está anulada');
    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }

  async markInvoicePaid(id: string, dto: MarkInvoicePaidDto, user: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException();
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    if (inv.status === InvoiceStatus.CANCELLED) throw new BadRequestException('No se puede marcar como pagado un documento anulado');
    if (inv.paid) throw new BadRequestException('Este documento ya está marcado como pagado');
    return this.prisma.invoice.update({
      where: { id },
      data: {
        paid: true,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        paymentMethod: dto.paymentMethod,
        paymentReference: dto.paymentReference,
      },
    });
  }

  async unmarkInvoicePaid(id: string, user: any) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException();
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    if (!inv.paid) throw new BadRequestException('Este documento no está marcado como pagado');
    return this.prisma.invoice.update({
      where: { id },
      data: { paid: false, paidAt: null, paymentMethod: null, paymentReference: null },
    });
  }

  // ── Perfil de facturación (identidad de la empresa emisora) ────────────────

  async getProfile(user: any, companyId?: string) {
    const cId = this.resolveCompanyId(user, { companyId });
    return this.prisma.billingProfile.findUnique({ where: { companyId: cId } });
  }

  async upsertProfile(dto: UpsertBillingProfileDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto);
    const { companyId: _omit, ...data } = dto;
    return this.prisma.billingProfile.upsert({
      where: { companyId },
      create: {
        companyId,
        razonSocial: data.razonSocial,
        rut: normalizeRut(data.rut) || data.rut,
        giro: data.giro,
        address: data.address,
        commune: data.commune,
        city: data.city,
        phone: data.phone,
        email: data.email,
        resolutionNumber: data.resolutionNumber,
        resolutionDate: data.resolutionDate ? new Date(data.resolutionDate) : undefined,
        footerText: data.footerText,
      },
      update: {
        razonSocial: data.razonSocial,
        rut: normalizeRut(data.rut) || data.rut,
        giro: data.giro,
        address: data.address,
        commune: data.commune,
        city: data.city,
        phone: data.phone,
        email: data.email,
        resolutionNumber: data.resolutionNumber,
        resolutionDate: data.resolutionDate ? new Date(data.resolutionDate) : undefined,
        footerText: data.footerText,
      },
    });
  }

  async saveProfileLogo(logoUrl: string, user: any, companyId?: string) {
    const cId = this.resolveCompanyId(user, { companyId });
    return this.prisma.billingProfile.upsert({
      where: { companyId: cId },
      create: { companyId: cId, logoUrl },
      update: { logoUrl },
    });
  }
}
