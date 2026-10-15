import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { roleForPermissions } from '../common/permissions';

// «Ver como» (solo Super Admin): una sesión temporal que se comporta como un perfil de acceso o
// como un usuario concreto de una empresa — mismo rol, permisos, módulos y plan — para probar
// qué ve. Es solo lectura: el servidor rechaza cualquier cambio mientras dura.

// Lo que va en el token de simulación (además de sub = Super Admin).
export interface SimulationClaim {
  companyId: string;
  profileId?: string;
  userId?: string;
}

export interface SimulationInfo {
  mode: 'profile' | 'user';
  companyId: string;
  companyName: string;
  profileId: string | null;
  profileName: string | null;
  userId: string | null;
  userName: string | null;
  by: { id: string; name: string };
}

export const SIMULATION_TTL = '4h';

const USER_INCLUDE = { company: { include: { subscriptionPlan: true } }, accessProfile: true } as const;

// Arma el usuario «simulado» que verán los guards y servicios en cada petición.
export async function buildSimulatedUser(prisma: PrismaService, admin: any, claim: SimulationClaim) {
  if (admin?.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Solo el Super Admin puede simular permisos');
  const by = { id: admin.id, name: admin.name || admin.email };

  if (claim.userId) {
    const target = await prisma.user.findFirst({
      where: { id: claim.userId, companyId: claim.companyId, active: true },
      include: USER_INCLUDE,
    });
    if (!target) throw new BadRequestException('El usuario no existe, está inactivo o no pertenece a esta empresa');
    if (target.role === Role.SUPER_ADMIN) throw new BadRequestException('No se puede simular a un Super Admin');
    const { password: _p, ...rest } = target;
    const simulation: SimulationInfo = {
      mode: 'user', companyId: claim.companyId, companyName: target.company?.name ?? '',
      profileId: target.accessProfile?.id ?? null, profileName: target.accessProfile?.name ?? null,
      userId: target.id, userName: target.name, by,
    };
    return { ...rest, simulation };
  }

  if (!claim.profileId) throw new BadRequestException('Elige un perfil o un usuario para simular');
  const [profile, company] = await Promise.all([
    prisma.accessProfile.findFirst({ where: { id: claim.profileId, OR: [{ companyId: claim.companyId }, { companyId: null }] } }),
    prisma.company.findUnique({ where: { id: claim.companyId }, include: { subscriptionPlan: true } }),
  ]);
  if (!company) throw new BadRequestException('Empresa no encontrada');
  if (!profile) throw new BadRequestException('El perfil no existe en esta empresa');
  const { password: _p, ...rest } = admin;
  const simulation: SimulationInfo = {
    mode: 'profile', companyId: company.id, companyName: company.name,
    profileId: profile.id, profileName: profile.name, userId: null, userName: null, by,
  };
  // Mismo rol que recibe un usuario al asignarle este perfil.
  return {
    ...rest,
    name: `${profile.name} (simulación)`,
    role: roleForPermissions(profile.permissions).role,
    companyId: company.id,
    company,
    accessProfileId: profile.id,
    accessProfile: profile,
    simulation,
  };
}

// Consultas que llegan por POST pero no cambian datos (búsquedas, vistas previas, cálculos).
const READ_ONLY_POST = /\/(search|preview|merge-preview|resolve-codes|report|reports|export|calculate|quote|validate|lookup|suggest|predict|summary)(\/|$)/i;

// Solo lectura: GET y las consultas por POST; salir de la simulación siempre se puede.
export function assertReadOnly(method: string, rawPath: string) {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
  const path = rawPath.split('?')[0].replace(/^\/api(?=\/)/, '');
  if (path === '/auth/simulate/stop') return;
  if (m === 'POST' && READ_ONLY_POST.test(path)) return;
  throw new ForbiddenException('Modo simulación (solo lectura): esta acción no se guarda. Sal de la simulación para hacer cambios.');
}
