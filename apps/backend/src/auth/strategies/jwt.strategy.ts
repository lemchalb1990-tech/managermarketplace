import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { Request } from 'express';
import { assertCompanyActive } from '../auth.service';
import { assertReadOnly, buildSimulatedUser, type SimulationClaim } from '../simulation';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string; email: string; tv?: number; sim?: SimulationClaim }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, active: true },
      include: { company: { include: { subscriptionPlan: true } }, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    // Sesión cerrada por un cambio de contraseña (el token es de una versión anterior).
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException('Tu sesión se cerró porque la contraseña cambió. Ingresa de nuevo.');
    assertCompanyActive(user);
    // Sesión «ver como» del Super Admin: la petición se atiende como ese perfil/usuario, solo lectura.
    if (payload.sim) {
      assertReadOnly(req.method, req.originalUrl || req.url);
      return buildSimulatedUser(this.prisma, user, payload.sim);
    }
    const { password: _, ...result } = user;
    return result;
  }
}
