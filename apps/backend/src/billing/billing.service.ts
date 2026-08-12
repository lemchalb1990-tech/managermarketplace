import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { BillingProvider, DteType, InvoiceStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OpenFacturaAdapter } from './providers/openfactura.adapter';
import { BsaleAdapter } from './providers/bsale.adapter';
import { FactoAdapter } from './providers/facto.adapter';
import { BillingStubAdapter } from './providers/stub.adapter';
import { BillingAdapter } from './providers/provider.interface';
import { CreateBillingConnectionDto, IssueInvoiceDto, ListInvoicesDto, MarkInvoicePaidDto, UpsertBillingProfileDto } from './dto/billing.dto';

const PAGE_SIZE = 20;

const IVA = 0.19;

@Injectable()
export class BillingService {
  private adapters: Map<BillingProvider, BillingAdapter>;

  constructor(
    private prisma: PrismaService,
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

  async issueInvoice(dto: IssueInvoiceDto, user: any) {
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

    // Calcular montos
    const isExempt = dto.dteType === DteType.FACTURA_EXENTA || dto.dteType === DteType.BOLETA;
    const netAmount = dto.items.reduce((sum, i) => {
      const subtotal = i.unitPrice * i.quantity * (1 - (i.discount ?? 0) / 100);
      return sum + (isExempt ? subtotal / (1 + IVA) : subtotal);
    }, 0);
    const tax = isExempt ? 0 : Math.round(netAmount * IVA);
    const totalAmount = Math.round(netAmount) + tax;

    // Crear registro draft
    const invoice = await this.prisma.invoice.create({
      data: {
        dteType: dto.dteType,
        rut: dto.rut,
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
      },
    });

    // Emitir DTE — la identidad del emisor sale del Perfil de facturación de la
    // empresa (si está configurado), completando lo que falte en las credenciales
    // propias de la conexión para no romper conexiones ya configuradas a mano.
    const profile = await this.prisma.billingProfile.findUnique({ where: { companyId: conn.companyId } });
    const baseCredentials = (conn.credentials ?? {}) as Record<string, string>;
    const credentials: Record<string, string> = {
      ...baseCredentials,
      companyRut: profile?.rut || baseCredentials.companyRut,
      companyName: profile?.razonSocial || baseCredentials.companyName,
      companyAddress: profile?.address || baseCredentials.companyAddress,
      companyDistrict: profile?.commune || baseCredentials.companyDistrict,
      companyCity: profile?.city || baseCredentials.companyCity,
      companyPhone: profile?.phone || baseCredentials.companyPhone,
      companyActivity: profile?.giro || baseCredentials.companyActivity,
    };

    try {
      const result = await this.adapter(conn.provider).issueDte(
        credentials,
        { ...dto, companyRut: credentials.companyRut },
      );
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

  async getInvoice(id: string, user: any) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: { connection: { select: { id: true, name: true, provider: true } } },
    });
    if (!inv) throw new NotFoundException();
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    return inv;
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
        rut: data.rut,
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
        rut: data.rut,
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
