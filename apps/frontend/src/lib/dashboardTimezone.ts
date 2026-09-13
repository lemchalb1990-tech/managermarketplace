'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export const DEFAULT_TIMEZONE = 'America/Santiago';

// Caché a nivel de módulo: la zona horaria del dashboard es global (la define el Super
// Admin en Configuración) y no cambia entre páginas de una misma sesión.
let cache: string | null = null;
let inflight: Promise<string> | null = null;

function fetchTimezone(): Promise<string> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.public.timezone()
    .then((r) => {
      cache = r.timezone || DEFAULT_TIMEZONE;
      return cache;
    })
    .catch(() => DEFAULT_TIMEZONE)
    .finally(() => { inflight = null; });
  return inflight;
}

// Se llama tras guardar un nuevo horario en Configuración, para que el resto de páginas
// ya montadas dejen de usar el valor viejo en caché.
export function invalidateDashboardTimezoneCache() {
  cache = null;
}

export function useDashboardTimezone(): string {
  const [tz, setTz] = useState<string>(cache || DEFAULT_TIMEZONE);
  useEffect(() => {
    let mounted = true;
    fetchTimezone().then((t) => { if (mounted) setTz(t); });
    return () => { mounted = false; };
  }, []);
  return tz;
}

// Día calendario (YYYY-MM-DD) tal como se ve en tz para el instante dado — para no usar
// el huso horario del navegador de quien mira el dashboard al armar links de "hoy".
export function dateKeyInTz(tz: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
