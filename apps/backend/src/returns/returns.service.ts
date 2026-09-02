import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ReturnStatus,
  ReturnCondition,
  MovementType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { companyWhere, assertSameCompany } from '../common/tenant';
import {
  CreateReturnDto,
  ReceiveReturnDto,
  ListReturnsDto,
} from './dto/return.dto';

const INCLUDE = {
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, stock: true } },
    },
  },
  sale: { select: { id: true, channel: true, externalId: true } },
  order: { select: { id: true, customerName: true } },
  receivedBy: { select: { id: true, name: true } },
};

@Injectable()
export class ReturnsService {
  constructor(private prisma: PrismaService) {}

  private baseWhere(user: any) {
    return companyWhere(user);
  }

  private guard(ret: any, user: any) {
    assertSameCompany(ret, user);
  }

  async list(user: any, dto: ListReturnsDto) {
    const where: any = { ...this.baseWhere(user) };
    if (dto.status === 'pending') where.status = ReturnStatus.PENDING;
    else if (dto.status === 'received') where.status = ReturnStatus.RECEIVED;
    if (dto.q?.trim()) {
      const q = dto.q.trim();
      where.OR = [
        { externalId: { contains: q, mode: 'insensitive' } },
        { trackingCode: { contains: q, mode: 'insensitive' } },
        { reason: { contains: q, mode: 'insensitive' } },
        { order: { customerName: { contains: q, mode: 'insensitive' } } },
        {
          items: { some: { productSku: { contains: q, mode: 'insensitive' } } },
        },
      ];
    }
    const [rows, pending, received] = await Promise.all([
      this.prisma.return.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.prisma.return.count({
        where: { ...this.baseWhere(user), status: ReturnStatus.PENDING },
      }),
      this.prisma.return.count({
        where: {
          ...this.baseWhere(user),
          status: ReturnStatus.RECEIVED,
          receivedAt: { gte: new Date(Date.now() - 60 * 24 * 3600 * 1000) },
        },
      }),
    ]);
    return { returns: rows, counts: { pending, received } };
  }

  async findOne(id: string, user: any) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!ret) throw new NotFoundException('Devolución no encontrada');
    this.guard(ret, user);
    return ret;
  }

  async create(user: any, dto: CreateReturnDto) {
    if (user.role !== Role.SUPER_ADMIN && !user.companyId) {
      throw new ForbiddenException('Usuario sin empresa');
    }
    let companyId = user.companyId as string | null;
    let channel = dto.channel ?? null;

    if (dto.saleId) {
      const sale = await this.prisma.sale.findUnique({
        where: { id: dto.saleId },
        select: { companyId: true, channel: true },
      });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId)
        throw new ForbiddenException();
      companyId = sale.companyId;
      channel = channel ?? sale.channel;
    }
    if (dto.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { companyId: true },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId)
        throw new ForbiddenException();
      companyId = order.companyId;
    }
    if (!companyId)
      throw new BadRequestException('No se pudo determinar la empresa');
    if (!dto.items?.length)
      throw new BadRequestException('Agrega al menos un ítem');

    // Validar que los productos referenciados son de la misma empresa.
    const productIds = dto.items
      .map((i) => i.productId)
      .filter(Boolean) as string[];
    if (productIds.length) {
      const prods = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, companyId: true },
      });
      if (prods.some((p) => p.companyId !== companyId)) {
        throw new BadRequestException(
          'Un producto no pertenece a esta empresa',
        );
      }
    }

    return this.prisma.return.create({
      data: {
        companyId,
        channel: channel ?? undefined,
        externalId: dto.externalId,
        reason: dto.reason,
        trackingCode: dto.trackingCode,
        notes: dto.notes,
        saleId: dto.saleId,
        orderId: dto.orderId,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId ?? null,
            productName: i.productName,
            productSku: i.productSku,
            quantity: i.quantity,
          })),
        },
      },
      include: INCLUDE,
    });
  }

  async scan(user: any, code: string) {
    const c = code.trim();
    if (!c) throw new BadRequestException('Código vacío');
    const ret = await this.prisma.return.findFirst({
      where: {
        ...this.baseWhere(user),
        status: ReturnStatus.PENDING,
        OR: [
          { id: c },
          { externalId: c },
          { trackingCode: c },
          { order: { id: c } },
        ],
      },
      include: INCLUDE,
    });
    if (!ret)
      return {
        kind: 'unmatched',
        message: `Sin devolución pendiente para "${c}"`,
      };
    return { kind: 'return', return: ret };
  }

  async receive(user: any, id: string, dto: ReceiveReturnDto) {
    const ret = await this.findOne(id, user);
    if (ret.status !== ReturnStatus.PENDING) {
      throw new BadRequestException('Esta devolución ya fue procesada');
    }

    const restockIds = new Set(dto.restockItemIds || []);
    const canRestock = dto.condition === ReturnCondition.GOOD;
    const toRestock = ret.items.filter(
      (it: any) => it.productId && restockIds.has(it.id),
    );
    if (toRestock.length && !canRestock) {
      throw new BadRequestException(
        'Solo se puede reponer stock si la condición es "Buen estado"',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.return.update({
        where: { id },
        data: {
          status: ReturnStatus.RECEIVED,
          condition: dto.condition,
          notes: dto.notes ?? ret.notes,
          receivedAt: new Date(),
          receivedById: user.id,
        },
      });

      for (const it of toRestock) {
        await tx.product.update({
          where: { id: it.productId! },
          data: { stock: { increment: it.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            type: MovementType.RETURN,
            quantity: it.quantity,
            reason: `Devolución ${ret.externalId || id.slice(-6)}`,
            productId: it.productId!,
            userId: user.id,
          },
        });
        await tx.returnItem.update({
          where: { id: it.id },
          data: { restocked: true },
        });
      }
    });

    return this.findOne(id, user);
  }

  async undo(user: any, id: string) {
    const ret = await this.findOne(id, user);
    if (ret.status !== ReturnStatus.RECEIVED) {
      throw new BadRequestException(
        'Solo se puede deshacer una devolución recibida',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      for (const it of ret.items.filter(
        (i: any) => i.restocked && i.productId,
      )) {
        await tx.product.update({
          where: { id: it.productId! },
          data: { stock: { decrement: it.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            type: MovementType.ADJUSTMENT,
            quantity: -it.quantity,
            reason: `Reversa devolución ${ret.externalId || id.slice(-6)}`,
            productId: it.productId!,
            userId: user.id,
          },
        });
        await tx.returnItem.update({
          where: { id: it.id },
          data: { restocked: false },
        });
      }
      await tx.return.update({
        where: { id },
        data: {
          status: ReturnStatus.PENDING,
          condition: null,
          receivedAt: null,
          receivedById: null,
        },
      });
    });
    return this.findOne(id, user);
  }
}
