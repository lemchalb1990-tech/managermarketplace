import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCompanyActive } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; tv?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, active: true },
      include: { company: { include: { subscriptionPlan: true } }, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    // Sesión cerrada por un cambio de contraseña (el token es de una versión anterior).
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException('Tu sesión se cerró porque la contraseña cambió. Ingresa de nuevo.');
    assertCompanyActive(user);
    const { password: _, ...result } = user;
    return result;
  }
}
