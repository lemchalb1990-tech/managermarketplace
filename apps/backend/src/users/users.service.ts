import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto, requestingUser: any) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('El email ya está registrado');

    // COMPANY_ADMIN solo puede crear CATALOG_MANAGER dentro de su empresa
    if (requestingUser.role === Role.COMPANY_ADMIN) {
      if (dto.role !== Role.CATALOG_MANAGER) {
        throw new ForbiddenException('Solo puedes crear gestores de catálogo');
      }
      dto.companyId = requestingUser.companyId;
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { ...dto, password: hashed },
      include: { company: true },
    });
    const { password: _, ...result } = user;
    return result;
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { companyId: requestingUser.companyId };

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true,
        active: true, createdAt: true,
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return users;
  }

  async findOne(id: string, requestingUser: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (
      requestingUser.role !== Role.SUPER_ADMIN &&
      user.companyId !== requestingUser.companyId
    ) {
      throw new ForbiddenException();
    }

    const { password: _, ...result } = user;
    return result;
  }

  async update(id: string, dto: UpdateUserDto, requestingUser: any) {
    await this.findOne(id, requestingUser);
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
    });
    const { password: _, ...result } = user;
    return result;
  }
}
