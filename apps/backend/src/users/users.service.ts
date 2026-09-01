import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const USER_SELECT = {
  id: true, email: true, name: true, role: true,
  active: true, modules: true, createdAt: true,
  company: { select: { id: true, name: true } },
  accessProfile: { select: { id: true, name: true, companyId: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Valida que el perfil de acceso indicado se pueda asignar a un usuario de
   * `companyId`. Reglas: el perfil debe ser global (companyId null, solo lo
   * asigna SUPER_ADMIN) o pertenecer exactamente a la misma empresa del usuario.
   */
  private async assertAssignableProfile(
    accessProfileId: string | null | undefined,
    targetCompanyId: string | null,
    requestingUser: any,
  ) {
    if (!accessProfileId) return;
    const profile = await this.prisma.accessProfile.findUnique({ where: { id: accessProfileId } });
    if (!profile) throw new BadRequestException('Perfil de acceso no encontrado');

    if (profile.companyId === null) {
      if (requestingUser.role !== Role.SUPER_ADMIN) {
        throw new ForbiddenException('No puedes asignar un perfil global');
      }
      return;
    }
    if (profile.companyId !== targetCompanyId) {
      throw new ForbiddenException('El perfil pertenece a otra empresa');
    }
    if (requestingUser.role !== Role.SUPER_ADMIN && profile.companyId !== requestingUser.companyId) {
      throw new ForbiddenException();
    }
  }

  async create(dto: CreateUserDto, requestingUser: any) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('El email ya está registrado');

    if (requestingUser.role === Role.COMPANY_ADMIN) {
      if (dto.role === Role.SUPER_ADMIN) {
        throw new ForbiddenException('No tienes permiso para asignar ese rol');
      }
      dto.companyId = requestingUser.companyId;

      const company = await this.prisma.company.findUnique({
        where: { id: requestingUser.companyId },
        select: { maxUsers: true, _count: { select: { users: true } } },
      });
      if (company && company._count.users >= company.maxUsers) {
        throw new ForbiddenException(
          `Límite de usuarios alcanzado (${company.maxUsers}). Contacta al administrador del sistema.`,
        );
      }
    }

    await this.assertAssignableProfile(dto.accessProfileId, dto.companyId ?? null, requestingUser);

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
        role: dto.role,
        companyId: dto.companyId ?? null,
        accessProfileId: dto.accessProfileId ?? null,
      },
      select: USER_SELECT,
    });
    return user;
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { companyId: requestingUser.companyId };

    return this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, requestingUser: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { company: true, accessProfile: true },
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
    const target = await this.findOne(id, requestingUser);
    if (dto.role === Role.SUPER_ADMIN && requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('No tienes permiso para asignar ese rol');
    }
    // Activar/desactivar servicios y ecommerce por usuario es exclusivo del super admin.
    if (requestingUser.role !== Role.SUPER_ADMIN) {
      delete dto.modules;
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.modules !== undefined) data.modules = dto.modules;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);

    if (dto.accessProfileId !== undefined) {
      const next = dto.accessProfileId || null;
      await this.assertAssignableProfile(next, (target as any).companyId ?? null, requestingUser);
      data.accessProfileId = next;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
    return user;
  }
}
