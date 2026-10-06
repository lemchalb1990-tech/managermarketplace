import { CallHandler, ExecutionContext, Global, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { from, Observable, switchMap } from 'rxjs';
import { StorageService } from './storage.service';

// Cambia en cada respuesta JSON los enlaces de archivos privados (fotos de despacho/entrega,
// adjuntos de finanzas) por links firmados que vencen en 1 hora. Sin Supabase no hace nada.
@Injectable()
export class StorageInterceptor implements NestInterceptor {
  constructor(private storage: StorageService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.storage.remote) return next.handle();
    return next.handle().pipe(switchMap((body) => from(this.storage.signDeep(body))));
  }
}

@Global()
@Module({
  providers: [StorageService, { provide: APP_INTERCEPTOR, useClass: StorageInterceptor }],
  exports: [StorageService],
})
export class StorageModule {}
