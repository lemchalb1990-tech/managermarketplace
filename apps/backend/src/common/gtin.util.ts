// Códigos universales (GTIN/EAN/UPC) de ejemplo o inválidos que no deben enviarse a los
// marketplaces: Mercado Libre rechaza un mismo GTIN usado en categorías distintas, y estos
// códigos genéricos terminan copiados en cientos de productos (p. ej. 0012345678905).

// Ejemplos de manual que circulan como "código de relleno" (comparados sin ceros a la izquierda).
const SAMPLE_GTINS = new Set(['12345678905', '1234567890128', '4006381333931', '123456789012', '1234567890123', '5901234123457', '96385074']);

function checkDigitOk(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// true si el código sirve como GTIN real: 8, 12, 13 o 14 dígitos, dígito verificador correcto,
// y no es un código de ejemplo ni una repetición (00000000, 11111111...).
export function isRealGtin(value: unknown): boolean {
  const code = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  if (/^(\d)\1+$/.test(code)) return false;
  if (SAMPLE_GTINS.has(code.replace(/^0+/, ''))) return false;
  return checkDigitOk(code);
}

// Quita del atributo GTIN (puede traer varios valores separados por coma) los códigos que no
// son reales. Devuelve los atributos limpios y si se descartó algún código.
export function cleanGtinAttributes<T extends { id: string; value_name?: string | null }>(attrs: T[]): { attrs: T[]; removed: string[] } {
  const removed: string[] = [];
  const out: T[] = [];
  for (const a of attrs || []) {
    if (a?.id !== 'GTIN') { out.push(a); continue; }
    const values = String(a.value_name ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    const valid = values.filter((v) => isRealGtin(v));
    removed.push(...values.filter((v) => !isRealGtin(v)));
    if (valid.length) out.push({ ...a, value_name: valid.join(',') });
  }
  return { attrs: out, removed };
}
