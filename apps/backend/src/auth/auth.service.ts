import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, active: true },
      include: { company: true },
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    const token = this.jwt.sign({ sub: user.id, email: user.email });
    const { password: _, ...userData } = user;

    return { access_token: token, user: userData };
  }

  async validateToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, active: true },
      include: { company: true },
    });
    if (!user) throw new UnauthorizedException();
    const { password: _, ...result } = user;
    return result;
  }
}
