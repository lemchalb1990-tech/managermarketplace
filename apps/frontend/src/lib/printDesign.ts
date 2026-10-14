// Diseño de documentos impresos (editor por bloques). Cada documento (comprobante de venta,
// orden de trabajo) tiene su lista de bloques en orden; el mismo diseño sirve para ticket
// 80 mm, 58 mm y hoja carta (en carta cada bloque va en su zona). Se guarda por empresa en
// Company.printLayouts; sin guardar se usa el diseño predeterminado.

export type PrintDoc = 'SALE' | 'WORK_ORDER';
export type BlockAlign = 'left' | 'center' | 'right';
export type BlockSize = 'S' | 'M' | 'L' | 'XL';
export type BlockSep = 'dash' | 'solid' | 'double';
export type BlockZone = 'izq' | 'der' | 'cuerpo' | 'pie';

export interface PrintBlock {
  id: string;
  on: boolean;
  align: BlockAlign;
  size: BlockSize;
  bold: boolean;
  space: number;
  zone: BlockZone;
  sep?: BlockSep;
  text?: string;
}

// Bordes del ticket (mm): lateral = espacio a cada lado; vertical = arriba y abajo.
export type TicketFormat = 'TICKET' | 'TICKET_58';
export interface TicketMargins { side: number; vertical: number }
export type PrintMargins = Partial<Record<TicketFormat, TicketMargins>>;

export type PrintLayouts = Partial<Record<PrintDoc, PrintBlock[]>> & { margins?: PrintMargins };

// Predeterminado: área imprimible típica (72 mm en papel de 80 y 48 mm en papel de 58).
export const DEFAULT_MARGINS: Record<TicketFormat, TicketMargins> = {
  TICKET: { side: 4, vertical: 2 },
  TICKET_58: { side: 5, vertical: 2 },
};
export const PAPER_MM: Record<TicketFormat, number> = { TICKET: 80, TICKET_58: 58 };

export function resolveMargins(saved: PrintLayouts | null | undefined): Record<TicketFormat, TicketMargins> {
  return {
    TICKET: { ...DEFAULT_MARGINS.TICKET, ...(saved?.margins?.TICKET ?? {}) },
    TICKET_58: { ...DEFAULT_MARGINS.TICKET_58, ...(saved?.margins?.TICKET_58 ?? {}) },
  };
}

export const PRINT_DOC_LABEL: Record<PrintDoc, string> = {
  SALE: 'Comprobante de venta',
  WORK_ORDER: 'Orden de trabajo',
};

export const SIZE_FACTOR: Record<BlockSize, number> = { S: 0.85, M: 1, L: 1.2, XL: 1.5 };

// Nombre de cada bloque en el editor (los separadores se numeran: sep1, sep2…).
export const BLOCK_LABEL: Record<string, string> = {
  logo: 'Logo',
  nombre: 'Nombre de la empresa',
  empresa: 'Razón social y RUT',
  direccion: 'Dirección y teléfono',
  titulo: 'Título y número',
  estado: 'Estado de la orden',
  datos: 'Fecha, hora, vendedor y pago',
  cliente: 'Cliente',
  productos: 'Productos',
  total: 'Total',
  documentos: 'Boleta o factura emitida',
  notas: 'Notas',
  firmas: 'Firmas',
  mensaje: 'Mensaje personalizado',
  leyenda: 'Leyenda «no válido como boleta»',
  codigo: 'Código de barras',
};
export const blockLabel = (id: string) => (id.startsWith('sep') ? 'Separador' : BLOCK_LABEL[id] || id);

const b = (id: string, zone: BlockZone, o: Partial<PrintBlock> = {}): PrintBlock => ({
  id, on: true, align: 'left', size: 'M', bold: false, space: 0, zone, ...o,
});
const sep = (id: string, space = 6): PrintBlock => b(id, 'cuerpo', { sep: 'dash', space });

// Predeterminados: el diseño aprobado para AltiroShopping (sin giro).
export const DEFAULT_LAYOUTS: Record<PrintDoc, PrintBlock[]> = {
  SALE: [
    b('logo', 'izq', { align: 'center', space: 0 }),
    b('nombre', 'izq', { align: 'center', size: 'L', bold: true }),
    b('empresa', 'izq', { align: 'center' }),
    b('direccion', 'izq', { align: 'center' }),
    sep('sep1'),
    b('titulo', 'der', { align: 'center', bold: true }),
    b('datos', 'der', { space: 4 }),
    sep('sep2'),
    b('cliente', 'cuerpo'),
    b('productos', 'cuerpo', { space: 4 }),
    sep('sep3'),
    b('total', 'cuerpo', { align: 'right', size: 'L', bold: true }),
    b('documentos', 'cuerpo', { space: 4 }),
    b('notas', 'cuerpo', { space: 6 }),
    b('mensaje', 'pie', { align: 'center', space: 10, text: '¡Gracias por tu compra!' }),
    b('leyenda', 'pie', { align: 'center', size: 'S', space: 4 }),
    b('codigo', 'pie', { align: 'center', space: 10 }),
  ],
  WORK_ORDER: [
    b('logo', 'izq', { align: 'center', space: 0 }),
    b('nombre', 'izq', { align: 'center', size: 'L', bold: true }),
    b('empresa', 'izq', { align: 'center' }),
    b('direccion', 'izq', { align: 'center' }),
    sep('sep1'),
    b('titulo', 'der', { align: 'center', bold: true }),
    b('datos', 'der', { space: 4 }),
    sep('sep2'),
    b('estado', 'cuerpo'),
    b('cliente', 'cuerpo'),
    sep('sep3'),
    b('productos', 'cuerpo', { space: 4 }),
    sep('sep4'),
    b('total', 'cuerpo', { align: 'right', size: 'L', bold: true }),
    b('notas', 'cuerpo', { space: 6 }),
    b('firmas', 'pie', { space: 24, on: true }),
    b('mensaje', 'pie', { align: 'center', space: 10, on: false, text: '' }),
    b('leyenda', 'pie', { align: 'center', size: 'S', space: 10 }),
  ],
};

export function defaultLayout(doc: PrintDoc): PrintBlock[] {
  return DEFAULT_LAYOUTS[doc].map((x) => ({ ...x }));
}

// Une lo guardado con el predeterminado: descarta bloques desconocidos y agrega al final de su
// zona los que falten (p. ej. un bloque nuevo agregado después de que la empresa guardó).
export function resolveLayout(saved: PrintLayouts | null | undefined, doc: PrintDoc): PrintBlock[] {
  const base = defaultLayout(doc);
  const list = saved?.[doc];
  if (!Array.isArray(list) || !list.length) return base;
  const known = new Map(base.map((x) => [x.id, x]));
  const out: PrintBlock[] = [];
  for (const s of list) {
    const d = known.get(s.id);
    if (!d) continue;
    out.push({ ...d, ...s, sep: d.sep ? (s.sep ?? d.sep) : undefined });
    known.delete(s.id);
  }
  for (const missing of known.values()) out.push(missing);
  return out;
}
