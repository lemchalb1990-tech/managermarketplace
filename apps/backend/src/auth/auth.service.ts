import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { permissionsForUser } from '../common/permissions';

function sanitizeCompany(company: any) {
  if (!company) return company;
  const { mlClientSecret: _, ...rest } = company;
  return rest;
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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, active: true },
      include: { company: true, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    const token = this.jwt.sign({ sub: user.id, email: user.email });
    return { access_token: token, user: shapeUser(user) };
  }

  async validateToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, active: true },
      include: { company: true, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    return shapeUser(user);
  }
}
