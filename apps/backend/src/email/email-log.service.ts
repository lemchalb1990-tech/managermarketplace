import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentRequestUser } from '../common/request-context';
import { EMAIL_TYPE_LABELS } from './platform-templates';

export const EMAIL_LOG_RETENTION_DAYS = 90;

export interface EmailLogEntry {
  channel: 'PLATFORM' | 'COMPANY';
  type: string;
  companyId?: string | null;
  to: string;
  from?: string | null;
  subject: string;
  html?: string | null;
  attachments?: string[];
  error?: string | null;
  // Textos que no deben quedar guardados (enlaces de acceso): se reemplazan en el cuerpo.
  redact?: string[];
}

// Registro de todos los correos que salen (plataforma y SMTP de cada empresa). Lo ve el Super Admin.
@Injectable()
export class EmailLogService {
  private readonly logger = new Logger(EmailLogService.name);

  constructor(private prisma: PrismaService) {}

  // Nunca hace fallar el envío: un error al registrar solo queda en el log del servidor.
  async record(e: EmailLogEntry) {
    try {
      const user = currentRequestUser();
      let html = e.html ?? null;
      for (const s of e.redact ?? []) if (html && s) html = html.split(s).join('#enlace-oculto');
      await this.prisma.emailLog.create({
        data: {
          channel: e.channel,
          type: e.type,
          companyId: e.companyId ?? null,
          toEmail: e.to.slice(0, 500),
          fromEmail: e.from ?? null,
          subject: e.subject.slice(0, 500),
          status: e.error ? 'FAILED' : 'SENT',
          error: e.error ? e.error.slice(0, 2000) : null,
          html,
          attachments: e.attachments ?? [],
          triggeredById: user?.id ?? null,
          triggeredByName: user ? user.name || user.email : null,
        },
      });
    } catch (err: any) {
      this.logger.warn(`No se pudo registrar el correo "${e.subject}": ${err?.message || err}`);
    }
  }

  async list(q: { companyId?: string; type?: string; status?: string; channel?: string; search?: string; from?: string; to?: string; page?: string; pageSize?: string }) {
    const where: Prisma.EmailLogWhereInput = {};
    if (q.companyId === 'none') where.companyId = null;
    else if (q.companyId) where.companyId = q.companyId;
    if (q.type) where.type = q.type;
    if (q.status) where.status = q.status;
    if (q.channel) where.channel = q.channel;
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.OR = [{ toEmail: { contains: s, mode: 'insensitive' } }, { subject: { contains: s, mode: 'insensitive' } }];
    }
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    const pageSize = Math.min(100, Math.max(10, Number(q.pageSize) || 50));
    const page = Math.max(1, Number(q.page) || 1);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const [total, rows, failed24h, sent24h] = await Promise.all([
      this.prisma.emailLog.count({ where }),
      this.prisma.emailLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, createdAt: true, channel: true, type: true, companyId: true, toEmail: true, fromEmail: true,
          subject: true, status: true, error: true, attachments: true, triggeredByName: true,
        },
      }),
      this.prisma.emailLog.count({ where: { status: 'FAILED', createdAt: { gte: since24h } } }),
      this.prisma.emailLog.count({ where: { status: 'SENT', createdAt: { gte: since24h } } }),
    ]);
    const companies = await this.companyNames(rows.map((r) => r.companyId));
    return {
      items: rows.map((r) => ({ ...r, typeLabel: EMAIL_TYPE_LABELS[r.type] ?? r.type, companyName: r.companyId ? companies.get(r.companyId) ?? null : null })),
      total, page, pageSize, failed24h, sent24h,
      types: Object.entries(EMAIL_TYPE_LABELS).map(([key, label]) => ({ key, label })),
      retentionDays: EMAIL_LOG_RETENTION_DAYS,
    };
  }

  async get(id: string) {
    const r = await this.prisma.emailLog.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Correo no encontrado');
    const companies = await this.companyNames([r.companyId]);
    return { ...r, typeLabel: EMAIL_TYPE_LABELS[r.type] ?? r.type, companyName: r.companyId ? companies.get(r.companyId) ?? null : null };
  }

  private async companyNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter(Boolean) as string[])];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.company.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((c) => [c.id, c.name]));
  }

  @Cron('45 3 * * *')
  async purgeOld() {
    const cutoff = new Date(Date.now() - EMAIL_LOG_RETENTION_DAYS * 24 * 3600 * 1000);
    const { count } = await this.prisma.emailLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count) this.logger.log(`Registro de correos: ${count} correo(s) de más de ${EMAIL_LOG_RETENTION_DAYS} días eliminados`);
  }
}
