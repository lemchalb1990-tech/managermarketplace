import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  async findAll(user: any, companyId?: string) {
    const where = user.role === Role.SUPER_ADMIN
      ? (companyId ? { companyId } : {})
      : { companyId: user.companyId };
    return this.prisma.client.findMany({
      where,
      include: { _count: { select: { orderRequests: true, invoices: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateClientDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const { companyId: _omit, ...data } = dto;
    return this.prisma.client.create({ data: { ...data, companyId } });
  }

  async update(id: string, dto: UpdateClientDto, user: any) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    if (user.role !== Role.SUPER_ADMIN && client.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: any) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { orderRequests: true, invoices: true } } },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    if (user.role !== Role.SUPER_ADMIN && client.companyId !== user.companyId) throw new ForbiddenException();
    if (client._count.orderRequests > 0 || client._count.invoices > 0) {
      throw new ConflictException('El cliente tiene solicitudes o facturas registradas. Desactívalo en vez de eliminarlo.');
    }
    return this.prisma.client.delete({ where: { id } });
  }

  async getHistory(id: string, user: any) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    if (user.role !== Role.SUPER_ADMIN && client.companyId !== user.companyId) throw new ForbiddenException();

    const [invoices, orderRequests] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { clientId: id },
        select: {
          id: true, dteType: true, status: true, folio: true, totalAmount: true,
          paid: true, issuedAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.orderRequest.findMany({
        where: { clientId: id },
        select: {
          id: true, status: true, scheduledDispatchDate: true, createdAt: true,
          items: { select: { quantity: true, unitPrice: true, product: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { client, invoices, orderRequests };
  }

  async getDebt(id: string, user: any) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    if (user.role !== Role.SUPER_ADMIN && client.companyId !== user.companyId) throw new ForbiddenException();

    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: id, paid: false, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.ACCEPTED] } },
      select: { id: true, folio: true, dteType: true, totalAmount: true, issuedAt: true },
      orderBy: { issuedAt: 'asc' },
    });
    const totalDebt = invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
    const creditLimit = client.creditLimit != null ? Number(client.creditLimit) : null;

    return {
      totalDebt,
      creditLimit,
      available: creditLimit != null ? creditLimit - totalDebt : null,
      overLimit: creditLimit != null && totalDebt >= creditLimit,
      invoices,
    };
  }
}
