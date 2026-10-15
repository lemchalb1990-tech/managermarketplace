// Lectura de celdas de la carga masiva de productos (Super Admin). Funciones puras para poder
// probarlas sin base de datos.

// Texto de una celda de ExcelJS: valores simples, texto enriquecido, hipervínculos y fórmulas.
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as any;
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text ?? '').join('').trim();
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
    if (v.error !== undefined) return '';
    return '';
  }
  return String(value).trim();
}

// Número escrito a mano o con formato chileno: «12.990», «$ 12.990», «12990,5», «1.234,50».
// null = celda vacía; NaN = no es un número.
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let s = cellText(value).replace(/\$|\s/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

// Sí/No, Si, S, 1, true, Activo… null = vacío; undefined = no se entiende.
export function parseYesNo(value: unknown): boolean | null | undefined {
  const s = normalizeText(cellText(value));
  if (!s) return null;
  if (['si', 's', '1', 'true', 'verdadero', 'activo', 'x'].includes(s)) return true;
  if (['no', 'n', '0', 'false', 'falso', 'inactivo'].includes(s)) return false;
  return undefined;
}

// Minúsculas, sin tildes ni espacios repetidos, sin el «*» de campo obligatorio.
export function normalizeText(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Hasta 2 decimales y dentro de Decimal(10,2).
export function isValidMoney(n: number): boolean {
  return n >= 0 && n < 100_000_000 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}
