import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { permissionsForUser } from '../common/permissions';

function sanitizeCompany(company: any) {
  if (!company) return company;
  const { mlClientSecret: _, subscriptionPlan, ...rest } = company;
  // Funciones del plan comercial (el menú oculta lo que el plan no incluye). null = sin plan.
  return { ...rest, planName: subscriptionPlan?.name ?? null, planFeatures: subscriptionPlan?.features ?? null };
}

function shapeUser(user: any) {
  const { password: _p, company, accessProfile, ...rest } = user;
  return {
    ...rest,
    company: sanitizeCompany(company),
    accessProfile: accessProfile
      ? { id: accessProfile.id, name: accessProfile.name }
      : null,
    permissions: permissionsForUser(user),
  };
}

// Usuarios de una empresa desactivada (o con la baja en curso) no pueden entrar. El super admin
// no pertenece a ninguna empresa, así que nunca queda bloqueado.
export function assertCompanyActive(user: { role: string; company?: { name: string; active: boolean; closureScheduledFor?: Date | null } | null }) {
  if (user.role === 'SUPER_ADMIN' || !user.company || user.company.active) return;
  if (user.company.closureScheduledFor) {
    const d = user.company.closureScheduledFor.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    throw new UnauthorizedException(`La cuenta de ${user.company.name} fue dada de baja y sus datos se eliminarán el ${d}. Si fue un error, contacta a soporte antes de esa fecha.`);
  }
  throw new UnauthorizedException(`La cuenta de ${user.company.name} está desactivada. Contacta a soporte.`);
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, active: true },
      include: { company: { include: { subscriptionPlan: true } }, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');
    assertCompanyActive(user);

    const token = this.jwt.sign({ sub: user.id, email: user.email });
    return { access_token: token, user: shapeUser(user) };
  }

  async validateToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, active: true },
      include: { company: { include: { subscriptionPlan: true } }, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    assertCompanyActive(user);
    return shapeUser(user);
  }
}
