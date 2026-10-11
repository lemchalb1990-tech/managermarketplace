import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PlatformMailService } from '../email/platform-mail.service';
import { roleForPermissions } from '../common/permissions';

export const INVITATION_TTL_MS = 7 * 86_400_000; // la invitación vence en 7 días
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador de la empresa', CATALOG_MANAGER: 'Gestor de catálogo', VENDEDOR: 'Vendedor',
  DESPACHADOR: 'Despachador', ORDER_MANAGER: 'Administrador de pedidos',
};
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Invitaciones de los administradores a su empresa. Cada invitación queda atada al correo
 * invitado (solo esa persona puede aceptarla) y se guarda solo el hash del enlace: reenviar o
 * copiar el enlace genera uno nuevo y el anterior deja de servir. La aceptación (con Google o
 * creando la contraseña) la resuelve AuthService.
 */
@Injectable()
export class InvitationsService {
  constructor(private prisma: PrismaService, private subscription: SubscriptionService, private mail: PlatformMailService) {}

  private companyIdFor(user: any, companyId?: string | null) {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('Elige la empresa');
      return companyId;
    }
    return user.companyId as string;
  }

  private async own(user: any, id: string) {
    const inv = await this.prisma.userInvitation.findUnique({ where: { id }, include: { company: { select: { name: true } } } });
    if (!inv) throw new NotFoundException('Invitación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && inv.companyId !== user.companyId) throw new ForbiddenException();
    return inv;
  }

  async list(user: any, companyId?: string) {
    const where = user.role === Role.SUPER_ADMIN ? (companyId ? { companyId } : {}) : { companyId: user.companyId };
    return this.prisma.userInvitation.findMany({
      where: { ...where, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, name: true, role: true, accessProfileId: true, status: true, expiresAt: true, sentAt: true,
        invitedByName: true, createdAt: true, companyId: true, company: { select: { name: true } },
      },
    }).then(async (rows) => {
      const names = new Map((await this.prisma.accessProfile.findMany({
        where: { id: { in: rows.map((r) => r.accessProfileId).filter(Boolean) as string[] } }, select: { id: true, name: true },
      })).map((p) => [p.id, p.name]));
      return rows.map((r) => ({ ...r, profileName: r.accessProfileId ? names.get(r.accessProfileId) || null : null }));
    });
  }

  // Lo único que se elige es el perfil de acceso: define dónde entra y qué puede hacer.
  async create(user: any, dto: { email: string; name?: string; accessProfileId?: string | null; companyId?: string; sendEmail?: boolean }) {
    const email = String(dto.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Escribe un correo válido');
    if (!dto.accessProfileId) throw new BadRequestException('Elige el perfil de acceso');
    const companyId = this.companyIdFor(user, dto.companyId);

    const existing = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { companyId: true } });
    if (existing) {
      throw new ConflictException(existing.companyId === companyId
        ? 'Esa persona ya es usuario de tu empresa'
        : 'Ese correo ya tiene una cuenta en otra empresa de AdminMarket. Por ahora un correo pertenece a una sola empresa: usa otro correo.');
    }
    const profile = await this.prisma.accessProfile.findUnique({ where: { id: dto.accessProfileId } });
    if (!profile || (profile.companyId && profile.companyId !== companyId) || (!profile.companyId && user.role !== Role.SUPER_ADMIN)) {
      throw new ForbiddenException('El perfil de acceso no corresponde a esta empresa');
    }
    const role = roleForPermissions(profile.permissions).role;
    // Si ya había una invitación pendiente para ese correo en esta empresa, se reemplaza.
    const previous = await this.prisma.userInvitation.findFirst({ where: { companyId, email, status: 'PENDING' } });
    // Límite de usuarios del plan: cuentan también las invitaciones pendientes.
    const pending = await this.prisma.userInvitation.count({ where: { companyId, status: 'PENDING', expiresAt: { gt: new Date() }, ...(previous ? { id: { not: previous.id } } : {}) } });
    await this.subscription.assertCanAdd(companyId, 'users', 1 + pending);

    const token = randomBytes(32).toString('hex');
    const data = {
      email, name: String(dto.name || '').trim() || null, role, accessProfileId: dto.accessProfileId || null,
      tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      invitedById: user.id || null, invitedByName: user.name || user.email || null,
    };
    const inv = previous
      ? await this.prisma.userInvitation.update({ where: { id: previous.id }, data })
      : await this.prisma.userInvitation.create({ data: { ...data, companyId } });
    return this.deliver(inv.id, token, dto.sendEmail !== false);
  }

  // Nuevo enlace (el anterior deja de servir) y, si se pide, lo envía por correo.
  private async rotate(user: any, id: string, send: boolean) {
    const inv = await this.own(user, id);
    if (inv.status !== 'PENDING') throw new BadRequestException('La invitación ya no está pendiente');
    const token = randomBytes(32).toString('hex');
    await this.prisma.userInvitation.update({
      where: { id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
    });
    return this.deliver(id, token, send);
  }

  resend(user: any, id: string) {
    return this.rotate(user, id, true);
  }

  link(user: any, id: string) {
    return this.rotate(user, id, false);
  }

  async cancel(user: any, id: string) {
    const inv = await this.own(user, id);
    if (inv.status !== 'PENDING') throw new BadRequestException('La invitación ya no está pendiente');
    await this.prisma.userInvitation.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  private async deliver(id: string, token: string, send: boolean) {
    const inv = await this.prisma.userInvitation.findUniqueOrThrow({ where: { id }, include: { company: { select: { name: true } } } });
    const profileName = inv.accessProfileId
      ? (await this.prisma.accessProfile.findUnique({ where: { id: inv.accessProfileId }, select: { name: true } }))?.name
      : null;
    const link = `${await this.mail.frontendUrl()}/invitacion?token=${token}`;
    let emailSent = false;
    const emailConfigured = await this.mail.isConfigured();
    if (send && emailConfigured) {
      emailSent = await this.mail.send(inv.email, `${inv.invitedByName || 'Te'} te invitó a ${inv.company.name} en AdminMarket`, this.mail.layout({
        title: `Te invitaron a ${inv.company.name}`,
        paragraphs: [
          `${inv.name ? `Hola ${esc(inv.name.split(' ')[0])}, ` : ''}${esc(inv.invitedByName || 'El administrador')} te invitó a unirte a <strong>${esc(inv.company.name)}</strong> en AdminMarket con el perfil <strong>${esc(profileName || ROLE_LABEL[inv.role] || inv.role)}</strong>.`,
          `Puedes entrar con tu cuenta de Google (${esc(inv.email)}) o crear una contraseña. La invitación vence en 7 días.`,
        ],
        button: { label: 'Aceptar invitación', url: link },
      }));
      if (emailSent) await this.prisma.userInvitation.update({ where: { id }, data: { sentAt: new Date() } });
    }
    return {
      invitation: { id: inv.id, email: inv.email, name: inv.name, role: inv.role, profileName, expiresAt: inv.expiresAt, sentAt: emailSent ? new Date() : inv.sentAt, invitedByName: inv.invitedByName },
      link, emailSent, emailConfigured,
    };
  }
}
