import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable, switchMap, tap, catchError, throwError } from 'rxjs';
import { ActivityService } from './activity.service';
import { buildSummary, classifyRequest } from './activity-routes';

// Registra en el historial de actividad toda acción que cambia datos (crear, editar, eliminar,
// publicar, importar...), con el antes/después de la entidad cuando aplica, y los inicios de
// sesión (exitosos y fallidos). Corre después de la autenticación: req.user ya está cargado.
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private activity: ActivityService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api/, '');
    const ip = String(req.headers?.['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null;

    // Inicio de sesión (no hay usuario aún).
    if (req.method === 'POST' && path === '/auth/login') {
      const email = String(req.body?.email || '').trim();
      return next.handle().pipe(
        tap((res: any) => {
          const u = res?.user;
          if (u) this.activity.logLogin(true, email, ip, { id: u.id, name: u.name, companyId: u.companyId ?? null }).catch(() => {});
        }),
        catchError((err) => {
          if (email) this.activity.logLogin(false, email, ip).catch(() => {});
          return throwError(() => err);
        }),
      );
    }

    const user = req.user;
    if (!user) return next.handle();
    const info = classifyRequest(req.method, path);
    if (!info) return next.handle();

    return from(this.activity.snapshot(info.entity, info.entityId)).pipe(
      switchMap((before) =>
        next.handle().pipe(
          tap((res: any) => {
            this.record(user, req, info, before, res, ip).catch(() => {});
          }),
        ),
      ),
    );
  }

  private async record(user: any, req: any, info: ReturnType<typeof classifyRequest> & {}, before: any, res: any, ip: string | null) {
    // Después de la acción: estado nuevo para el detalle de cambios.
    const after = info.action !== 'ELIMINAR' && before ? await this.activity.snapshot(info.entity, info.entityId) : null;
    const changes = this.activity.diff(info.entity, before?.data ?? null, after?.data ?? null);

    // Entidad recién creada: etiqueta desde la respuesta.
    let label = before?.label ?? null;
    if (!label && res && typeof res === 'object' && !Array.isArray(res)) {
      label = res.sku ? `${res.sku}${res.name ? ` — ${res.name}` : ''}` : res.name || res.email || res.externalId || null;
    }
    const bulk = Array.isArray(req.body?.ids) ? req.body.ids.length : Array.isArray(req.body?.productIds) ? req.body.productIds.length : Array.isArray(req.body?.saleIds) ? req.body.saleIds.length : 0;
    const hint = [info.hint, bulk ? `${bulk} registro(s)` : null].filter(Boolean).join(', ') || null;

    const companyId = before?.companyId ?? after?.companyId ?? user.companyId ?? req.query?.companyId ?? req.body?.companyId ?? null;
    this.activity.log({
      companyId,
      userId: user.id,
      actorName: user.name || user.email,
      module: info.module,
      action: info.action,
      entity: info.entity,
      entityId: info.entityId,
      entityLabel: label,
      summary: buildSummary(info.action, { entity: info.entity, label, hint, module: info.module }),
      changes,
      ip,
      href: info.action === 'ELIMINAR' ? null : (after?.href ?? before?.href ?? null),
    });
  }
}
