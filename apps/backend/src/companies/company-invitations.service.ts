import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformMailService } from '../email/platform-mail.service';
import { INVITATION_TTL_MS, sha256 } from '../users/invitations.service';

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Invitaciones del Super Admin para crear empresas nuevas. La empresa se crea recién cuando el
 * administrador invitado acepta (ver AuthService.acceptCompanyInvitation), con el plan elegido
 * y sus perfiles base. El enlace queda atado al correo invitado y se guarda solo su hash:
 * reenviar o copiar genera uno nuevo.
 */
@Injectable()
export class CompanyInvitationsService {
  constructor(private prisma: PrismaService, private mail: PlatformMailService) {}

  async list() {
    const rows = await this.prisma.companyInvitation.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' },
      select: { id: true, companyName: true, email: true, name: true, planId: true, expiresAt: true, sentAt: true, invitedByName: true, createdAt: true },
    });
    const plans = new Map((await this.prisma.subscriptionPlan.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, planName: r.planId ? plans.get(r.planId) || null : null }));
  }

  async create(user: any, dto: { companyName: string; email: string; name?: string; planId?: string | null; message?: string; sendEmail?: boolean }) {
    const companyName = String(dto.companyName || '').trim().slice(0, 120);
    if (companyName.length < 2) throw new BadRequestException('Escribe el nombre de la empresa');
    const email = String(dto.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Escribe el correo del administrador');
    if (await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
      throw new ConflictException('Ese correo ya tiene una cuenta en AdminMarket. Usa otro correo para el administrador de la nueva empresa.');
    }
    if (dto.planId && !(await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId }, select: { id: true } }))) {
      throw new BadRequestException('El plan no existe');
    }
    const previous = await this.prisma.companyInvitation.findFirst({ where: { email, status: 'PENDING' } });
    const token = randomBytes(32).toString('hex');
    const data = {
      companyName, email, name: String(dto.name || '').trim() || null, planId: dto.planId || null,
      message: String(dto.message || '').trim().slice(0, 500) || null,
      tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      invitedById: user?.id || null, invitedByName: user?.name || user?.email || null,
    };
    const inv = previous
      ? await this.prisma.companyInvitation.update({ where: { id: previous.id }, data })
      : await this.prisma.companyInvitation.create({ data });
    return this.deliver(inv.id, token, dto.sendEmail !== false);
  }

  private async rotate(id: string, send: boolean) {
    const inv = await this.prisma.companyInvitation.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invitación no encontrada');
    if (inv.status !== 'PENDING') throw new BadRequestException('La invitación ya no está pendiente');
    const token = randomBytes(32).toString('hex');
    await this.prisma.companyInvitation.update({ where: { id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) } });
    return this.deliver(id, token, send);
  }

  resend(id: string) {
    return this.rotate(id, true);
  }

  link(id: string) {
    return this.rotate(id, false);
  }

  async cancel(id: string) {
    const inv = await this.prisma.companyInvitation.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invitación no encontrada');
    if (inv.status !== 'PENDING') throw new BadRequestException('La invitación ya no está pendiente');
    await this.prisma.companyInvitation.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  private async deliver(id: string, token: string, send: boolean) {
    const inv = await this.prisma.companyInvitation.findUniqueOrThrow({ where: { id } });
    const plan = inv.planId ? await this.prisma.subscriptionPlan.findUnique({ where: { id: inv.planId }, select: { name: true, isTrial: true, trialDays: true } }) : null;
    const link = `${await this.mail.frontendUrl()}/activar?token=${token}`;
    const emailConfigured = await this.mail.isConfigured();
    let emailSent = false;
    if (send && emailConfigured) {
      emailSent = await this.mail.send(inv.email, `Tu cuenta de ${inv.companyName} en AdminMarket`, this.mail.layout({
        title: `Activa ${inv.companyName} en AdminMarket`,
        paragraphs: [
          `${inv.name ? `Hola ${esc(inv.name.split(' ')[0])}, ` : ''}te invitamos a administrar <strong>${esc(inv.companyName)}</strong> en AdminMarket${plan ? ` con el plan <strong>${esc(plan.name)}</strong>${plan.isTrial ? ` (${plan.trialDays ?? 15} días de prueba)` : ''}` : ''}.`,
          ...(inv.message ? [`<em>“${esc(inv.message)}”</em>`] : []),
          `Entra con tu cuenta de Google (${esc(inv.email)}) o crea una contraseña. El enlace vence en 7 días.`,
        ],
        button: { label: 'Activar mi cuenta', url: link },
      }));
      if (emailSent) await this.prisma.companyInvitation.update({ where: { id }, data: { sentAt: new Date() } });
    }
    return {
      invitation: { id: inv.id, companyName: inv.companyName, email: inv.email, name: inv.name, planName: plan?.name ?? null, expiresAt: inv.expiresAt },
      link, emailSent, emailConfigured,
    };
  }
}
