import { BadRequestException, Body, Controller, Get, Injectable, Post, Query, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { PERMISSION_GROUPS, roleForPermissions } from '../common/permissions';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { shapeUser } from './auth.service';
import { buildSimulatedUser, SIMULATION_TTL, type SimulationClaim } from './simulation';

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: 'Admin empresa', CATALOG_MANAGER: 'Gestor catálogo', VENDEDOR: 'Vendedor',
  DESPACHADOR: 'Despachador', ORDER_MANAGER: 'Admin. Pedidos',
};

@Injectable()
export class SimulationService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private activity: ActivityService) {}

  private claim(body: { companyId?: string; profileId?: string; userId?: string }): SimulationClaim {
    if (!body?.companyId) throw new BadRequestException('Elige la empresa');
    if (!body.profileId && !body.userId) throw new BadRequestException('Elige un perfil o un usuario');
    return body.userId ? { companyId: body.companyId, userId: body.userId } : { companyId: body.companyId, profileId: body.profileId };
  }

  // Perfiles y usuarios de la empresa que se pueden simular.
  async targets(companyId: string) {
    if (!companyId) throw new BadRequestException('Elige la empresa');
    const [profiles, users] = await Promise.all([
      this.prisma.accessProfile.findMany({
        where: { OR: [{ companyId }, { companyId: null }] },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, _count: { select: { users: { where: { companyId } } } } },
      }),
      this.prisma.user.findMany({
        where: { companyId, active: true, role: { not: Role.SUPER_ADMIN } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, role: true, accessProfile: { select: { name: true } } },
      }),
    ]);
    return {
      profiles: profiles.map((p) => ({ id: p.id, name: p.name, users: p._count.users })),
      users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleLabel: ROLE_LABEL[u.role] ?? u.role, profileName: u.accessProfile?.name ?? null })),
    };
  }

  // Ficha antes de entrar: la sesión tal como la verá el perfil/usuario, y los permisos por grupo.
  async preview(admin: any, body: { companyId?: string; profileId?: string; userId?: string }) {
    const sim = await buildSimulatedUser(this.prisma, admin, this.claim(body));
    const shaped = shapeUser(sim);
    const perms: string[] = shaped.permissions;
    const all = perms.includes('*');
    const { uncovered } = roleForPermissions(perms);
    const groups = PERMISSION_GROUPS.map((g) => ({
      label: g.label,
      items: g.items.map((i) => ({ key: i.key, label: i.label, granted: all || perms.includes(i.key) })),
    }));
    const labelOf = (k: string) => PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.key === k)?.label ?? k;
    return {
      user: { ...shaped, simulation: sim.simulation },
      roleLabel: ROLE_LABEL[sim.role] ?? sim.role,
      groups,
      // Páginas del perfil que su rol no alcanza a abrir (el servidor las rechazaría).
      uncovered: uncovered.map(labelOf),
    };
  }

  async start(admin: any, body: { companyId?: string; profileId?: string; userId?: string }) {
    const claim = this.claim(body);
    const sim = await buildSimulatedUser(this.prisma, admin, claim);
    const token = this.jwt.sign({ sub: admin.id, email: admin.email, tv: admin.tokenVersion ?? 0, sim: claim }, { expiresIn: SIMULATION_TTL });
    const target = sim.simulation.mode === 'user' ? `el usuario ${sim.simulation.userName}` : `el perfil «${sim.simulation.profileName}»`;
    this.activity.log({
      companyId: claim.companyId, userId: admin.id, actorName: admin.name || admin.email,
      module: 'Seguridad', action: 'SIMULAR', summary: `Inició la simulación de permisos como ${target} (solo lectura)`,
    });
    return { access_token: token, user: { ...shapeUser(sim), simulation: sim.simulation } };
  }

  stop(user: any) {
    const s = user?.simulation;
    if (!s) return { ok: true };
    const target = s.mode === 'user' ? `el usuario ${s.userName}` : `el perfil «${s.profileName}»`;
    this.activity.log({
      companyId: s.companyId, userId: s.by.id, actorName: s.by.name,
      module: 'Seguridad', action: 'SIMULAR', summary: `Terminó la simulación de permisos como ${target}`,
    });
    return { ok: true };
  }
}

@Controller('auth/simulate')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SimulationController {
  constructor(private service: SimulationService) {}

  @Get('targets')
  @Roles(Role.SUPER_ADMIN)
  targets(@Query('companyId') companyId: string) {
    return this.service.targets(companyId);
  }

  @Get('preview')
  @Roles(Role.SUPER_ADMIN)
  preview(@CurrentUser() user: any, @Query() q: { companyId?: string; profileId?: string; userId?: string }) {
    return this.service.preview(user, q);
  }

  @Post('start')
  @Roles(Role.SUPER_ADMIN)
  start(@CurrentUser() user: any, @Body() body: { companyId?: string; profileId?: string; userId?: string }) {
    return this.service.start(user, body);
  }

  // Con el token de simulación (cualquier rol simulado).
  @Post('stop')
  stop(@CurrentUser() user: any) {
    return this.service.stop(user);
  }
}
