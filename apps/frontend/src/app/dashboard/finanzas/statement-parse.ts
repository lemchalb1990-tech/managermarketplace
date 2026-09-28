// Interpretación de cartolas bancarias chilenas (cada banco usa columnas y formatos distintos).

export type ColumnMap = {
  headerRow: number;          // índice de la fila de encabezados (-1 = sin encabezados)
  date: number;
  description: number;
  amount: number;             // columna única con signo (−1 si se usan cargo/abono)
  debit: number;              // cargos (salidas)
  credit: number;             // abonos (entradas)
  reference: number;
  balance: number;
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Busca la fila de encabezados y adivina qué columna es cada cosa por su nombre.
export function guessColumns(rows: string[][]): ColumnMap {
  const map: ColumnMap = { headerRow: -1, date: -1, description: -1, amount: -1, debit: -1, credit: -1, reference: -1, balance: -1 };
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r].map((c) => norm(c || ''));
    const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
    const date = find(/^fecha/);
    if (date === -1) continue;
    map.headerRow = r;
    map.date = date;
    map.description = find(/descrip|glosa|detalle|concepto|movimiento/);
    map.debit = find(/cargo|debito|giro|egreso|salida/);
    map.credit = find(/abono|credito|deposito|ingreso|entrada/);
    map.amount = map.debit === -1 && map.credit === -1 ? find(/monto|importe|valor/) : -1;
    map.reference = find(/documento|n.? ?doc|referencia|operacion|serie/);
    map.balance = find(/saldo/);
    break;
  }
  return map;
}

// "1.234.567" / "-1.234" / "$ 12.000" / "(5.000)" / "1234,50" → número.
export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[()$\s-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    // El separador que aparece último es el decimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (/\.\d{3}(\.|$)/.test(s)) {
    s = s.replace(/\./g, ''); // puntos de miles
  }
  const n = Number(s);
  if (!isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

// dd/mm/yyyy, dd-mm-yyyy, dd/mm/yy, yyyy-mm-dd (o ISO) → "yyyy-mm-dd".
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mm = m[2].padStart(2, '0');
    const dd = m[1].padStart(2, '0');
    if (Number(mm) > 12) return null;
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

export type ParsedLine = { date: string; description: string; amount: number; reference?: string; balance?: number };

export function buildLines(rows: string[][], map: ColumnMap): { lines: ParsedLine[]; skipped: number } {
  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[map.date]);
    let amount: number | null = null;
    if (map.amount >= 0) amount = parseAmount(row[map.amount]);
    else {
      const debit = map.debit >= 0 ? parseAmount(row[map.debit]) : null;
      const credit = map.credit >= 0 ? parseAmount(row[map.credit]) : null;
      if (debit || credit) amount = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
    }
    if (!date || !amount) { skipped++; continue; }
    const balance = map.balance >= 0 ? parseAmount(row[map.balance]) : null;
    lines.push({
      date,
      description: (map.description >= 0 ? row[map.description] : '') || '(sin descripción)',
      amount,
      reference: map.reference >= 0 ? row[map.reference] || undefined : undefined,
      balance: balance ?? undefined,
    });
  }
  return { lines, skipped };
}
