import {
  Injectable,
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
import { PERMISSION_GROUPS, isValidPermissionKey } from '../common/permissions';

@Injectable()
export class AccessProfilesService {
  constructor(private prisma: PrismaService) {}

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
      new Set((perms || []).map((p) => String(p).trim()).filter(Boolean)),
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
      });
    }
    // COMPANY_ADMIN: solo su empresa (los perfiles globales/plantilla no se listan
    // como editables aquí; se copian si se quieren usar).
    return this.prisma.accessProfile.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
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

    return this.prisma.accessProfile.update({ where: { id }, data });
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
