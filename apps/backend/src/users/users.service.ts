import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { roleForPermissions } from '../common/permissions';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { SubscriptionService } from '../subscription/subscription.service';

const USER_SELECT = {
  id: true, email: true, name: true, role: true,
  active: true, modules: true, createdAt: true,
  company: { select: { id: true, name: true } },
  accessProfile: { select: { id: true, name: true, companyId: true } },
  posWarehouse: { select: { id: true, name: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private subscription: SubscriptionService) {}

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

  // La bodega de venta del punto de venta debe ser de la empresa del usuario.
  private async resolvePosWarehouse(posWarehouseId: string | null | undefined, companyId: string | null) {
    if (!posWarehouseId) return null;
    const wh = await this.prisma.warehouse.findUnique({ where: { id: posWarehouseId }, select: { companyId: true } });
    if (!wh || !companyId || wh.companyId !== companyId) throw new BadRequestException('La bodega no pertenece a la empresa del usuario');
    return posWarehouseId;
  }

  async create(dto: CreateUserDto, requestingUser: any) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('El email ya está registrado');

    if (requestingUser.role !== Role.SUPER_ADMIN) dto.companyId = requestingUser.companyId;
    // Usuario de empresa: lo único que se elige es el perfil de acceso; el nivel sale de él.
    const superAdmin = requestingUser.role === Role.SUPER_ADMIN && dto.role === Role.SUPER_ADMIN && !dto.companyId;
    let role: Role = Role.SUPER_ADMIN;
    if (!superAdmin) {
      if (!dto.accessProfileId) throw new BadRequestException('Elige el perfil de acceso del usuario');
      role = await this.roleForProfile(dto.accessProfileId);
    }
    // Límite de usuarios del plan de la empresa (sin plan, el máximo configurado en la empresa).
    await this.subscription.assertCanAdd(dto.companyId, 'users');

    await this.assertAssignableProfile(dto.accessProfileId, dto.companyId ?? null, requestingUser);

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
        role,
        companyId: superAdmin ? null : dto.companyId ?? null,
        accessProfileId: superAdmin ? null : dto.accessProfileId ?? null,
        posWarehouseId: superAdmin ? null : await this.resolvePosWarehouse(dto.posWarehouseId, dto.companyId ?? null),
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
    // Los módulos los define la empresa (Empresas → Módulos licenciados), no cada usuario.
    delete dto.modules;

    const data: any = {};
    const isCompanyUser = (target as any).role !== Role.SUPER_ADMIN;
    if (dto.name !== undefined) data.name = dto.name;
    // El nivel de un usuario de empresa no se elige: sale de su perfil de acceso.
    if (dto.role !== undefined && !isCompanyUser) data.role = dto.role;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.posWarehouseId !== undefined && isCompanyUser) {
      data.posWarehouseId = await this.resolvePosWarehouse(dto.posWarehouseId || null, (target as any).companyId ?? null);
    }

    if (dto.accessProfileId !== undefined && isCompanyUser) {
      const next = dto.accessProfileId || null;
      if (!next) throw new BadRequestException('El usuario necesita un perfil de acceso');
      await this.assertAssignableProfile(next, (target as any).companyId ?? null, requestingUser);
      data.accessProfileId = next;
      data.role = await this.roleForProfile(next);
    }
    // La empresa nunca queda sin un administrador activo (ni uno puede quitarse ese acceso a sí mismo).
    const losesAdmin = (target as any).role === Role.COMPANY_ADMIN
      && ((data.role && data.role !== Role.COMPANY_ADMIN) || data.active === false);
    if (losesAdmin) {
      if (id === requestingUser.id) throw new BadRequestException('No puedes quitarte a ti mismo el acceso de administrador');
      const others = await this.prisma.user.count({
        where: { companyId: (target as any).companyId, role: Role.COMPANY_ADMIN, active: true, id: { not: id } },
      });
      if (!others) throw new BadRequestException('La empresa debe tener al menos un usuario administrador activo');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
    return user;
  }

  // Nivel interno que corresponde al perfil (el menor que cubre todas sus páginas).
  private async roleForProfile(profileId: string): Promise<Role> {
    const profile = await this.prisma.accessProfile.findUnique({ where: { id: profileId }, select: { permissions: true } });
    if (!profile) throw new NotFoundException('Perfil de acceso no encontrado');
    return roleForPermissions(profile.permissions).role;
  }
}
