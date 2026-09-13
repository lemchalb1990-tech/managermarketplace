export const DEFAULT_TIMEZONE = 'America/Santiago';

/** Offset (en minutos) entre UTC y timeZone en el instante dado. Positivo = timeZone adelante de UTC. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUTC - date.getTime()) / 60000;
}

/** Año/mes/día tal como se ven en timeZone para el instante dado. */
function dateKeyInTz(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Día calendario (YYYY-MM-DD) tal como se ve en timeZone para el instante dado. */
export function dateKeyStringInTz(date: Date, timeZone: string): string {
  const { year, month, day } = dateKeyInTz(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Desplaza una clave YYYY-MM-DD por N días (aritmética de calendario, no de instantes). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Medianoche del día calendario (en timeZone) que contiene `ref` (o ahora), como instante UTC real.
 * dateStr opcional en formato YYYY-MM-DD para pedir el inicio de ese día calendario específico.
 */
export function startOfDayInTz(timeZone: string, dateStr?: string): Date {
  const ref = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  const { year, month, day } = dateKeyInTz(ref, timeZone);
  const offset = tzOffsetMinutes(ref, timeZone);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset * 60000);
}

export function endOfDayInTz(timeZone: string, dateStr?: string): Date {
  return new Date(startOfDayInTz(timeZone, dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Hora/minuto actual tal como se ven en timeZone. */
export function nowHourMinuteInTz(timeZone: string, now = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute') };
}

/** ¿La hora actual (en timeZone) ya pasó el cutoff HH:MM? */
export function isOverdueInTz(cutoff: string, timeZone: string, now = new Date()): boolean {
  const [h, m] = cutoff.split(':').map(Number);
  const { hour, minute } = nowHourMinuteInTz(timeZone, now);
  return hour * 60 + minute > h * 60 + m;
}
