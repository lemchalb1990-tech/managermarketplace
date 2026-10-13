import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

const TABLE_LABEL: Record<string, string> = {
  sales: 'Ventas', orders: 'Órdenes', stock_movements: 'Movimientos de stock', purchases: 'Compras',
  stock_transfers: 'Traspasos de stock', transfer_documents: 'Documentos de traspaso', returns: 'Devoluciones',
  order_requests: 'Solicitudes de pedido', work_orders: 'Órdenes de trabajo', order_item_checks: 'Revisiones de productos',
  shipment_photos: 'Fotos de despacho', dispatch_routes: 'Rutas de despacho', driver_payments: 'Pagos a conductores',
  finance_movements: 'Movimientos de finanzas', finance_transfers: 'Transferencias de finanzas', audit_logs: 'Auditoría',
  ai_usages: 'Uso de IA', courier_shipments: 'Envíos por courier', user_invitations: 'Invitaciones',
  company_invitations: 'Invitaciones de empresas', companies: 'Empresa (baja de cuenta)',
};
const tableLabel = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, ' ');

// Filas que son solo del usuario y se borran con él (no se traspasan).
const DELETE_TABLES = new Set(['password_reset_tokens', 'driver_profiles']);
// El registro de actividad guarda el nombre de quien actuó (actorName): queda tal cual como historial.
const KEEP_TABLES = new Set(['activity_logs']);

type Col = { table: string; col: string; unique: boolean };

/**
 * Eliminación de usuarios (solo Super Admin): todos sus registros pasan a un administrador activo de
 * su empresa y luego se borra el usuario, en una sola transacción.
 * Las columnas se descubren solas: llaves foráneas hacia users más las columnas de usuario sin llave
 * (userId, …ById, …UserId). Actualizar por igualdad con el id del usuario es inocuo en columnas
 * homónimas que no son de usuario (p. ej. mlUserId), porque nunca contienen un id interno.
 */
@Injectable()
export class UserDeletionService {
  constructor(private prisma: PrismaService, private activity: ActivityService) {}

  private async columns(db: Prisma.TransactionClient | PrismaService): Promise<Col[]> {
    const fks = await db.$queryRaw<{ table: string; col: string }[]>`
      SELECT tc.relname AS "table", a.attname AS col
      FROM pg_constraint c
      JOIN pg_class tc ON tc.oid = c.conrelid
      JOIN pg_class pc ON pc.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = tc.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND n.nspname = current_schema() AND pc.relname = 'users'`;
    const named = await db.$queryRaw<{ table: string; col: string }[]>`
      SELECT table_name AS "table", column_name AS col FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name <> 'users'
        AND data_type IN ('text', 'character varying')
        AND (column_name = 'userId' OR column_name LIKE '%ById' OR column_name LIKE '%UserId')`;
    const uniques = await db.$queryRaw<{ table: string; col: string }[]>`
      SELECT t.relname AS "table", a.attname AS col
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
      WHERE i.indisunique AND i.indnatts = 1 AND n.nspname = current_schema()`;
    const uniq = new Set(uniques.map((u) => `${u.table}.${u.col}`));
    const seen = new Map<string, Col>();
    for (const { table, col } of [...fks, ...named]) {
      if (table === 'users' || KEEP_TABLES.has(table)) continue;
      seen.set(`${table}.${col}`, { table, col, unique: uniq.has(`${table}.${col}`) });
    }
    return [...seen.values()];
  }

  // Usuario a eliminar + administradores de su empresa a los que se puede traspasar.
  private async load(id: string, requestingUser: any) {
    if (requestingUser.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Solo el Super Admin puede eliminar usuarios');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, companyId: true, company: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.id === requestingUser.id) throw new BadRequestException('No puedes eliminarte a ti mismo');
    if (user.role === Role.SUPER_ADMIN || !user.companyId) throw new BadRequestException('Un Super Admin no se puede eliminar');
    const admins = await this.prisma.user.findMany({
      where: { companyId: user.companyId, role: Role.COMPANY_ADMIN, active: true, id: { not: id } },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admins.length) {
      throw new BadRequestException('La empresa no tiene otro administrador activo que reciba los registros. Asigna uno antes de eliminar este usuario.');
    }
    return { user, admins };
  }

  async preview(id: string, requestingUser: any) {
    const { user, admins } = await this.load(id, requestingUser);
    const totals = new Map<string, number>();
    for (const c of await this.columns(this.prisma)) {
      if (DELETE_TABLES.has(c.table)) continue;
      const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM ${ident(c.table)} WHERE ${ident(c.col)} = $1`, id,
      );
      if (Number(n)) totals.set(c.table, (totals.get(c.table) ?? 0) + Number(n));
    }
    const records = [...totals.entries()]
      .map(([table, count]) => ({ table, label: tableLabel(table), count }))
      .sort((a, b) => b.count - a.count);
    return {
      user: { id: user.id, name: user.name, email: user.email, company: user.company?.name ?? null },
      admins,
      records,
      total: records.reduce((s, r) => s + r.count, 0),
    };
  }

  async remove(id: string, dto: { targetUserId?: string; confirmEmail?: string }, requestingUser: any) {
    const { user, admins } = await this.load(id, requestingUser);
    if (String(dto.confirmEmail ?? '').trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Escribe el correo del usuario para confirmar la eliminación');
    }
    const target = dto.targetUserId ? admins.find((a) => a.id === dto.targetUserId) : admins[0];
    if (!target) throw new BadRequestException('Elige un administrador activo de la misma empresa para recibir los registros');

    let moved = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const c of await this.columns(tx)) {
        const t = ident(c.table), col = ident(c.col);
        if (DELETE_TABLES.has(c.table)) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE ${col} = $1`, id);
          continue;
        }
        // Columna única (una fila por usuario): si el administrador ya tiene la suya, la del eliminado se borra.
        if (c.unique) {
          await tx.$executeRawUnsafe(
            `DELETE FROM ${t} WHERE ${col} = $1 AND EXISTS (SELECT 1 FROM ${t} x WHERE x.${col} = $2)`, id, target.id,
          );
        }
        moved += await tx.$executeRawUnsafe(`UPDATE ${t} SET ${col} = $2 WHERE ${col} = $1`, id, target.id);
      }
      await tx.user.delete({ where: { id } });
    }, { timeout: 5 * 60 * 1000, maxWait: 30 * 1000 });

    this.activity.log({
      companyId: user.companyId,
      userId: requestingUser.id,
      actorName: requestingUser.name || requestingUser.email,
      module: 'Usuarios',
      action: 'EDITAR',
      entity: 'user',
      entityId: target.id,
      entityLabel: target.name,
      summary: `Usuario ${user.name} (${user.email}) eliminado: ${moved} registro(s) traspasados a ${target.name} (${target.email})`,
    });
    return { ok: true, moved, target };
  }
}
