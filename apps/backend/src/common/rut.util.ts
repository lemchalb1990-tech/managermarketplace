// Normaliza un RUT chileno al formato que esperan los proveedores de facturación
// (SII / Facto / OpenFactura / Bsale): sin puntos ni espacios, con guion antes del
// dígito verificador y la K en mayúscula. Ej: "12.345.678-k" → "12345678-K".
// Devuelve el valor tal cual (recortado) si no se puede interpretar como RUT.
export function normalizeRut(rut?: string | null): string {
  if (!rut) return '';
  const clean = rut.replace(/[.\s]/g, '').replace(/-+/g, '-').toUpperCase().trim();
  const compact = clean.replace(/-/g, '');
  // Debe quedar cuerpo numérico + 1 dígito verificador (0-9 o K).
  if (!/^\d{7,9}[0-9K]$/.test(compact)) return clean;
  const body = compact.slice(0, -1);
  const dv = compact.slice(-1);
  return `${body}-${dv}`;
}
