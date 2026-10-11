import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAccessProfileDto,
  UpdateAccessProfileDto,
} from './dto/access-profile.dto';
import { PERMISSION_GROUPS, isValidPermissionKey, RETIRED_PERMISSION_KEYS, roleForPermissions } from '../common/permissions';
import { ensureDefaultProfiles, syncProfileUsers } from './default-profiles';

@Injectable()
export class AccessProfilesService implements OnModuleInit {
  private readonly logger = new Logger(AccessProfilesService.name);

  constructor(private prisma: PrismaService) {}

  // El perfil de acceso es lo único que se elige al crear un usuario: cada empresa parte con
  // sus perfiles base, los usuarios sin perfil reciben el equivalente a su rol y el rol de cada
  // usuario se alinea con su perfil.
  async onModuleInit() {
    try {
      const companies = await this.prisma.company.findMany({ select: { id: true } });
      for (const c of companies) {
        const users = await this.prisma.user.findMany({
          where: { companyId: c.id, accessProfileId: null, role: { not: Role.SUPER_ADMIN } }, select: { id: true, role: true },
        });
        // Siempre los 3 base; Despachador / Admin. pedidos solo si hay usuarios con ese rol sin perfil.
        const byRole = await ensureDefaultProfiles(this.prisma, c.id, Array.from(new Set(users.map((u) => u.role))));
        for (const u of users) if (byRole[u.role]) await this.prisma.user.update({ where: { id: u.id }, data: { accessProfileId: byRole[u.role] } });
      }
      const profiles = await this.prisma.accessProfile.findMany({ where: { users: { some: {} } }, select: { id: true, permissions: true } });
      for (const p of profiles) await syncProfileUsers(this.prisma, p.id, p.permissions);
    } catch (e: any) {
      this.logger.warn(`Perfiles base: ${e.message}`);
    }
  }

  // Nivel que el sistema usa para un perfil (para avisar en el editor qué páginas no se pueden combinar).
  level(permissions: string[]) {
    return roleForPermissions(permissions);
  }

  catalog() {
    return PERMISSION_GROUPS;
  }

  /**
   * Empresa efectiva del perfil. Un COMPANY_ADMIN solo opera sobre perfiles de
   * SU empresa (nunca globales ni de otras). SUPER_ADMIN puede indicar empresa
   * o dejar el perfil global (companyId null).
   */
  private resolveCompanyId(
    user: any,
    requested?: string | null,
  ): string | null {
    if (user.role === Role.SUPER_ADMIN) return requested ?? null;
    if (!user.companyId) throw new ForbiddenException('Usuario sin empresa');
    if (requested && requested !== user.companyId) {
      throw new ForbiddenException(
        'No puedes gestionar perfiles de otra empresa',
      );
    }
    return user.companyId;
  }

  private sanitizePermissions(perms: string[]): string[] {
    const clean = Array.from(
      new Set(
        (perms || [])
          .map((p) => String(p).trim())
          .filter((p) => p && !RETIRED_PERMISSION_KEYS.includes(p)),
      ),
    );
    const bad = clean.filter((p) => !isValidPermissionKey(p));
    if (bad.length)
      throw new BadRequestException(`Permisos inválidos: ${bad.join(', ')}`);
    return clean;
  }

  async findAll(user: any, companyId?: string) {
    if (user.role === Role.SUPER_ADMIN) {
      const where = companyId ? { companyId } : {};
      return this.prisma.accessProfile.findMany({
        where,
        orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { users: true } },
          company: { select: { id: true, name: true } },
        },
      }).then((rows) => rows.map((r) => ({ ...r, level: roleForPermissions(r.permissions) })));
    }
    // COMPANY_ADMIN: solo su empresa (los perfiles globales/plantilla no se listan
    // como editables aquí; se copian si se quieren usar).
    return this.prisma.accessProfile.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    }).then((rows) => rows.map((r) => ({ ...r, level: roleForPermissions(r.permissions) })));
  }

  async findOne(id: string, user: any) {
    const profile = await this.prisma.accessProfile.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    if (
      user.role !== Role.SUPER_ADMIN &&
      profile.companyId !== user.companyId
    ) {
      throw new ForbiddenException();
    }
    return profile;
  }

  async create(dto: CreateAccessProfileDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const permissions = this.sanitizePermissions(dto.permissions);

    const dup = await this.prisma.accessProfile.findFirst({
      where: {
        companyId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });
    if (dup) throw new ConflictException('Ya existe un perfil con ese nombre');

    return this.prisma.accessProfile.create({
      data: { name: dto.name.trim(), permissions, companyId },
    });
  }

  async update(id: string, dto: UpdateAccessProfileDto, user: any) {
    const profile = await this.findOne(id, user);
    if (profile.isSystem)
      throw new ForbiddenException('El perfil de sistema no se puede editar');

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.permissions !== undefined)
      data.permissions = this.sanitizePermissions(dto.permissions);

    // La empresa no puede quedar sin administrador por editar el perfil de sus administradores.
    if (data.permissions && profile.companyId && roleForPermissions(data.permissions).role !== Role.COMPANY_ADMIN) {
      const adminsHere = await this.prisma.user.count({ where: { accessProfileId: id, role: Role.COMPANY_ADMIN, active: true } });
      if (adminsHere) {
        const others = await this.prisma.user.count({
          where: { companyId: profile.companyId, role: Role.COMPANY_ADMIN, active: true, accessProfileId: { not: id } },
        });
        if (!others) throw new BadRequestException('Con estos permisos la empresa quedaría sin administrador. Mantén "Usuarios" o "Configuración", o asigna otro administrador antes.');
      }
    }

    const updated = await this.prisma.accessProfile.update({ where: { id }, data });
    // Los usuarios con este perfil quedan con el nivel que corresponde a los nuevos permisos.
    if (data.permissions) await syncProfileUsers(this.prisma, id, updated.permissions);
    return updated;
  }

  async remove(id: string, user: any) {
    const profile = await this.findOne(id, user);
    if (profile.isSystem)
      throw new ForbiddenException('El perfil de sistema no se puede eliminar');
    if (profile._count.users > 0) {
      throw new BadRequestException(
        `Este perfil está asignado a ${profile._count.users} usuario(s). Reasígnalos antes de eliminar.`,
      );
    }
    await this.prisma.accessProfile.delete({ where: { id } });
    return { deleted: true };
  }
}
