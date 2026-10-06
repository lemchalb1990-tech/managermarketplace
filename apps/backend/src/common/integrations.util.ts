import { ServiceUnavailableException } from '@nestjs/common';

// Interruptor general para copias de prueba del sistema (p. ej. un servidor nuevo con los datos
// reales copiados): con INTEGRATIONS_DISABLED=true el backend no llama a marketplaces,
// facturadores ni correo. Evita vender, facturar o sincronizar stock dos veces, y que el servidor
// de prueba renueve los tokens de Mercado Libre (eso desconectaría al servidor en producción).
export function integrationsDisabled(): boolean {
  return /^(1|true|yes|si|sí)$/i.test(String(process.env.INTEGRATIONS_DISABLED || '').trim());
}

export function assertIntegrationsEnabled(): void {
  if (integrationsDisabled()) {
    throw new ServiceUnavailableException(
      'Integraciones desactivadas en este servidor (copia de prueba): no se conecta con marketplaces, facturadores ni correo.',
    );
  }
}

// Bloqueo central de salidas HTTP: con el interruptor activo, `fetch` solo puede ir a Supabase
// (base y fotos) y a localhost. Cubre todos los adaptadores aunque llamen a la plataforma por
// caminos que no pasan por assertIntegrationsEnabled.
export function installOutboundGuard(): void {
  if (!integrationsDisabled()) return;
  const original = globalThis.fetch;
  const allowed = (host: string) =>
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  globalThis.fetch = ((input: any, init?: any) => {
    let host = '';
    try {
      host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname;
    } catch { /* URL relativa: se deja pasar */ }
    if (host && !allowed(host)) {
      return Promise.reject(new Error(`Integraciones desactivadas en este servidor (copia de prueba): llamada bloqueada a ${host}`));
    }
    return original(input, init);
  }) as typeof fetch;
  console.log('[integraciones] DESACTIVADAS: solo se permiten llamadas a Supabase y localhost.');
}
