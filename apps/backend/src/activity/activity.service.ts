import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { currentRequestUser } from '../common/request-context';
import { ACTION_LABELS, ActivityAction, MODULE_NAMES } from './activity-routes';

export interface ActivityEntry {
  companyId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  automatic?: boolean;
  module: string;
  action: ActivityAction;
  entity?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  changes?: { field: string; before: any; after: any }[] | null;
  ip?: string | null;
  href?: string | null;
}

// Campos que se comparan antes/después por tipo de entidad (nunca contraseñas ni credenciales).
const DIFF_FIELDS: Record<string, { label: string; fields: Record<string, string> }> = {
  product: {
    label: 'producto',
    fields: {
      sku: 'SKU', name: 'Nombre', price: 'Precio de venta', mlPrice: 'Precio base ML', cost: 'Costo',
      supplierPrice: 'Precio proveedor', stock: 'Stock', criticalStock: 'Stock crítico', active: 'Activo',
      category: 'Categoría', barcode: 'Código de barras',
    },
  },
  order: { label: 'orden', fields: { status: 'Estado', courier: 'Courier', trackingCode: 'N° de seguimiento' } },
  user: { label: 'usuario', fields: { name: 'Nombre', email: 'Correo', role: 'Rol', active: 'Activo', accessProfileId: 'Perfil de acceso' } },
  profile: { label: 'perfil', fields: { name: 'Nombre', permissions: 'Permisos' } },
};

const DELETE_ALERT_THRESHOLD = 20;   // eliminaciones de un usuario en el día
const FAILED_LOGIN_THRESHOLD = 5;    // intentos fallidos de un correo en 15 minutos

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Escritura ──────────────────────────────────────────────────────────────

  // Registra sin hacer esperar a quien la llama; un error al registrar nunca rompe la acción.
  log(entry: ActivityEntry): void {
    this.write(entry).catch((err) => this.logger.warn(`No se pudo registrar actividad: ${err?.message || err}`));
  }

  async write(entry: ActivityEntry) {
    const row = await this.prisma.activityLog.create({
      data: {
        companyId: entry.companyId ?? null,
        userId: entry.userId ?? null,
        actorName: entry.actorName ?? null,
        automatic: !!entry.automatic,
        module: entry.module,
        action: entry.action,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        entityLabel: entry.entityLabel ?? null,
        summary: entry.summary.slice(0, 1000),
        changes: entry.changes?.length ? (entry.changes as any) : undefined,
        ip: entry.ip ?? null,
        href: entry.href ?? null,
      },
    });
    if (entry.action === 'ELIMINAR' && entry.userId) await this.checkDeleteAlert(entry);
    return row;
  }

  // Acción automática del sistema (ventas importadas, pausas por stock 0, estados desde marketplaces).
  logSystem(entry: Omit<ActivityEntry, 'automatic' | 'userId'>): void {
    this.log({ ...entry, automatic: true, actorName: entry.actorName ?? 'Sistema' });
  }

  // Importación: a nombre del usuario que la inició (botón Importar, Traer desde ML...). Si no
  // la inició nadie (cron, aviso del marketplace) queda como acción automática del Sistema.
  logImport(entry: Omit<ActivityEntry, 'automatic' | 'userId'>): void {
    const user = currentRequestUser();
    if (!user) return this.logSystem(entry);
    this.log({ ...entry, automatic: false, userId: user.id, actorName: user.name || user.email });
  }

  // ─── Entidades: etiqueta, empresa y estado para comparar ─────────────────────

  async snapshot(entity: string | null, id: string | null): Promise<{ companyId: string | null; label: string | null; href: string | null; data: Record<string, any> | null } | null> {
    if (!entity || !id) return null;
    try {
      switch (entity) {
        case 'product': {
          const p = await this.prisma.product.findUnique({ where: { id } });
          return p ? { companyId: p.companyId, label: `${p.sku} — ${p.name}`, href: `/dashboard/catalog?search=${encodeURIComponent(p.sku)}`, data: p as any } : null;
        }
        case 'order': {
          const o = await this.prisma.order.findUnique({ where: { id }, include: { sale: { select: { externalId: true } } } });
          return o ? { companyId: o.companyId, label: `#${o.sale?.externalId || o.id.slice(-8)}`, href: `/dashboard/orders/${o.id}`, data: o as any } : null;
        }
        case 'sale': {
          const s = await this.prisma.sale.findUnique({ where: { id } });
          return s ? { companyId: s.companyId, label: `${s.externalId ? `n° ${s.externalId}` : s.id.slice(-8)} ($${Math.round(Number(s.total)).toLocaleString('es-CL')})`, href: '/dashboard/sales', data: null } : null;
        }
        case 'user': {
          const u = await this.prisma.user.findUnique({ where: { id }, select: { companyId: true, name: true, email: true, role: true, active: true, accessProfileId: true } });
          return u ? { companyId: u.companyId, label: `${u.name} (${u.email})`, href: '/dashboard/users', data: u as any } : null;
        }
        case 'profile': {
          const a = await this.prisma.accessProfile.findUnique({ where: { id } });
          return a ? { companyId: (a as any).companyId ?? null, label: a.name, href: '/dashboard/access-profiles', data: a as any } : null;
        }
        case 'connection': {
          const c = await this.prisma.marketplaceConnection.findUnique({ where: { id }, select: { companyId: true, name: true, marketplace: true } });
          return c ? { companyId: c.companyId, label: c.name, href: null, data: null } : null;
        }
      }
    } catch { /* entidad borrada o id inválido */ }
    return null;
  }

  diff(entity: string | null, before: Record<string, any> | null, after: Record<string, any> | null) {
    const spec = entity ? DIFF_FIELDS[entity] : null;
    if (!spec || !before || !after) return [];
    const norm = (v: any) => (v === null || v === undefined ? null : typeof v === 'object' && 'toNumber' in v ? Number(v) : v);
    const out: { field: string; before: any; after: any }[] = [];
    for (const [key, label] of Object.entries(spec.fields)) {
      const b = norm(before[key]);
      const a = norm(after[key]);
      if (Array.isArray(b) || Array.isArray(a)) {
        const added = (a || []).filter((x: any) => !(b || []).includes(x));
        const removed = (b || []).filter((x: any) => !(a || []).includes(x));
        if (added.length || removed.length) out.push({ field: label, before: removed.length ? `quitó: ${removed.join(', ')}` : '', after: added.length ? `agregó: ${added.join(', ')}` : '' });
      } else if (JSON.stringify(b) !== JSON.stringify(a)) {
        out.push({ field: label, before: b, after: a });
      }
    }
    return out;
  }

  // ─── Alertas ────────────────────────────────────────────────────────────────

  private async checkDeleteAlert(entry: ActivityEntry) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const n = await this.prisma.activityLog.count({ where: { userId: entry.userId, action: 'ELIMINAR', createdAt: { gte: start } } });
    if (n === DELETE_ALERT_THRESHOLD) {
      await this.write({
        companyId: entry.companyId, automatic: true, actorName: 'Sistema', module: 'Seguridad', action: 'ALERTA',
        entity: 'user', entityId: entry.userId, entityLabel: entry.actorName,
        summary: `${entry.actorName || 'Un usuario'} eliminó ${n} registros hoy`, href: '/dashboard/actividad',
      });
    }
  }

  async logLogin(ok: boolean, email: string, ip: string | null, user?: { id: string; name: string; companyId: string | null } | null) {
    if (ok && user) {
      await this.write({ companyId: user.companyId, userId: user.id, actorName: user.name, module: 'Sesión', action: 'SESION', summary: 'Inició sesión', ip });
      return;
    }
    const known = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, name: true, companyId: true } }).catch(() => null);
    await this.write({
      companyId: known?.companyId ?? null, userId: known?.id ?? null, actorName: known?.name ?? email,
      module: 'Sesión', action: 'SESION_FALLIDA', summary: `Intento de inicio de sesión fallido con ${email}`, ip,
    });
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const n = await this.prisma.activityLog.count({ where: { action: 'SESION_FALLIDA', actorName: known?.name ?? email, createdAt: { gte: since } } });
    if (n === FAILED_LOGIN_THRESHOLD) {
      await this.write({
        companyId: known?.companyId ?? null, automatic: true, actorName: 'Sistema', module: 'Seguridad', action: 'ALERTA',
        entity: known ? 'user' : null, entityId: known?.id ?? null, entityLabel: email,
        summary: `${n} intentos fallidos de inicio de sesión con ${email} en 15 minutos`, ip, href: '/dashboard/actividad',
      });
    }
  }

  // ─── Consulta ───────────────────────────────────────────────────────────────

  private companyOf(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('Selecciona una empresa');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException();
    return user.companyId;
  }

  private where(companyId: string, f: { userId?: string; from?: string; to?: string; module?: string; action?: string; automatic?: string }) {
    const where: any = { companyId };
    if (f.userId === 'system') where.automatic = true;
    else if (f.userId) where.userId = f.userId;
    if (f.automatic !== 'true' && f.userId !== 'system') where.automatic = false;
    if (f.module) where.module = f.module;
    if (f.action) where.action = f.action;
    if (f.from || f.to) {
      where.createdAt = {};
      if (f.from) where.createdAt.gte = new Date(`${f.from}T00:00:00-03:00`);
      if (f.to) where.createdAt.lte = new Date(`${f.to}T23:59:59.999-03:00`);
    }
    return where;
  }

  async list(user: any, f: { companyId?: string; userId?: string; from?: string; to?: string; module?: string; action?: string; automatic?: string; page?: string }) {
    const companyId = this.companyOf(user, f.companyId);
    const where = this.where(companyId, f);
    const page = Math.max(1, parseInt(f.page || '1') || 1);
    const take = 50;
    const [total, items] = await Promise.all([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
  }

  async filters(user: any, companyId?: string) {
    const cid = this.companyOf(user, companyId);
    const users = await this.prisma.user.findMany({ where: { companyId: cid }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
    return {
      users,
      modules: MODULE_NAMES,
      actions: Object.entries(ACTION_LABELS).map(([id, label]) => ({ id, label })),
    };
  }

  async export(user: any, f: Parameters<ActivityService['list']>[1]): Promise<Buffer> {
    const companyId = this.companyOf(user, f.companyId);
    const rows = await this.prisma.activityLog.findMany({ where: this.where(companyId, f), orderBy: { createdAt: 'desc' }, take: 50000 });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Historial');
    ws.columns = [
      { header: 'Fecha', key: 'date', width: 20 }, { header: 'Usuario', key: 'user', width: 28 },
      { header: 'Automática', key: 'auto', width: 11 }, { header: 'Módulo', key: 'module', width: 18 },
      { header: 'Acción', key: 'action', width: 20 }, { header: 'Detalle', key: 'summary', width: 70 },
      { header: 'Cambios', key: 'changes', width: 60 }, { header: 'IP', key: 'ip', width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const ch = Array.isArray(r.changes) ? (r.changes as any[]).map((c) => `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`).join(' | ') : '';
      ws.addRow({
        date: r.createdAt.toLocaleString('es-CL', { timeZone: 'America/Santiago' }),
        user: r.actorName || (r.automatic ? 'Sistema' : 'Sin usuario registrado'),
        auto: r.automatic ? 'Sí' : 'No', module: r.module,
        action: (ACTION_LABELS as any)[r.action] || r.action, summary: r.summary, changes: ch, ip: r.ip || '',
      });
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // Alertas recientes para la campana de notificaciones (administradores).
  async recentAlerts(companyId: string | null, since: Date) {
    if (!companyId) return [];
    return this.prisma.activityLog.findMany({
      where: { companyId, action: 'ALERTA', createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
  }

  // ─── Retención ──────────────────────────────────────────────────────────────

  @Cron('30 3 * * *')
  async purgeOld() {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'ACTIVITY_RETENTION_MONTHS' } }).catch(() => null);
    const months = Math.max(1, parseInt(setting?.value || '12') || 12);
    const limit = new Date();
    limit.setMonth(limit.getMonth() - months);
    const { count } = await this.prisma.activityLog.deleteMany({ where: { createdAt: { lt: limit } } });
    if (count) this.logger.log(`Historial de actividad: ${count} registros de más de ${months} meses eliminados`);
  }
}
