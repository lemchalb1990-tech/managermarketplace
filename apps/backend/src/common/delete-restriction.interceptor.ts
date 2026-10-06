import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { Observable } from 'rxjs';
import { cannotDelete } from './permissions';

// Bloquea cualquier acción de eliminar para usuarios cuyo perfil tiene la restricción
// "No puede eliminar registros": todo DELETE y las acciones de eliminar que van por POST
// (eliminar en lote, quitar publicaciones, unificar productos o ventas duplicadas).
// Corre después de la autenticación (los interceptores van después de los guards), así que
// req.user ya trae el perfil de acceso.
const DESTRUCTIVE_POST = /\/(bulk\/delete(-listings)?|bulk-delete|delete-listings|bulk\/merge|merge-duplicate)\/?$/;

@Injectable()
export class DeleteRestrictionInterceptor implements NestInterceptor {
  constructor(private activity: ActivityService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (user) {
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      const destructive = req.method === 'DELETE' || (req.method === 'POST' && DESTRUCTIVE_POST.test(path));
      if (destructive && cannotDelete(user)) {
        this.activity.log({
          companyId: user.companyId ?? null, userId: user.id, actorName: user.name || user.email,
          module: 'Seguridad', action: 'BLOQUEADO', summary: `Intentó eliminar y su perfil no lo permite (${req.method} ${path.replace(/^\/api/, '')})`,
          ip: String(req.headers?.['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null,
        });
        throw new ForbiddenException('Tu perfil no permite eliminar registros. Pide a un administrador que lo haga.');
      }
    }
    return next.handle();
  }
}
