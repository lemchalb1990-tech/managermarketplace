import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProfitabilityItemDto, UpdateProfitabilityItemDto } from './dto/profitability.dto';

@Injectable()
export class ProfitabilityService {
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
    return this.prisma.profitabilityItem.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(dto: CreateProfitabilityItemDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const { companyId: _omit, ...data } = dto;
    try {
      return await this.prisma.profitabilityItem.create({ data: { ...data, companyId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese nombre');
      }
      throw e;
    }
  }

  private async findOwned(id: string, user: any) {
    const item = await this.prisma.profitabilityItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && item.companyId !== user.companyId) throw new ForbiddenException();
    return item;
  }

  async update(id: string, dto: UpdateProfitabilityItemDto, user: any) {
    await this.findOwned(id, user);
    const { myPrice, ...rest } = dto;
    const data: Prisma.ProfitabilityItemUpdateInput = { ...rest };
    // myPrice presente en el body -> el usuario lo fijó a mano (o lo está reseteando a null
    // para volver a seguir la sugerencia automática = precio competencia - 1000).
    if (myPrice !== undefined) {
      data.myPrice = myPrice ?? null;
      data.manualPrice = myPrice != null;
    }
    try {
      return await this.prisma.profitabilityItem.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese nombre');
      }
      throw e;
    }
  }

  async remove(id: string, user: any) {
    await this.findOwned(id, user);
    return this.prisma.profitabilityItem.delete({ where: { id } });
  }
}
