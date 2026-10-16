import type { EmailBlock } from '@/lib/api';

// Variables de los correos a clientes. En el editor se muestran con su nombre legible
// ([Nombre del cliente]) y se guardan como {{customerName}}, que es lo que entiende el servidor.
export const EMAIL_VARS = [
  { key: 'customerName', label: 'Nombre del cliente' },
  { key: 'orderId', label: 'N° de pedido' },
  { key: 'companyName', label: 'Nombre de la tienda' },
  { key: 'total', label: 'Total' },
  { key: 'address', label: 'Dirección de entrega' },
  { key: 'date', label: 'Fecha' },
] as const;

export function toDisplay(text: string): string {
  return String(text ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = EMAIL_VARS.find((x) => x.key === k);
    return v ? `[${v.label}]` : m;
  });
}

export function toRaw(text: string): string {
  return EMAIL_VARS.reduce((acc, v) => acc.split(`[${v.label}]`).join(`{{${v.key}}}`), String(text ?? ''));
}

function mapTexts(b: EmailBlock, fn: (s: string) => string): EmailBlock {
  switch (b.type) {
    case 'title': case 'text': return { ...b, text: fn(b.text) };
    case 'note': return { ...b, text: fn(b.text) };
    case 'button': return { ...b, label: fn(b.label) };
    default: return { ...b };
  }
}

export const blocksToDisplay = (blocks: EmailBlock[]) => blocks.map((b) => mapTexts(b, toDisplay));
export const blocksToRaw = (blocks: EmailBlock[]) => blocks.map((b) => mapTexts(b, toRaw));

export const BLOCK_META: Record<EmailBlock['type'], { label: string; icon: string; hint: string }> = {
  title: { label: 'Título', icon: 'T', hint: 'Frase principal del correo' },
  text: { label: 'Texto', icon: '¶', hint: 'Párrafo de texto' },
  note: { label: 'Recuadro destacado', icon: '💬', hint: 'Mensaje resaltado en color' },
  items: { label: 'Detalle de productos', icon: '🧾', hint: 'Se completa solo con los productos' },
  total: { label: 'Total', icon: '$', hint: 'Se completa solo con el total' },
  delivery: { label: 'Entrega o retiro', icon: '🚚', hint: 'Dirección de entrega o aviso de retiro' },
  button: { label: 'Botón', icon: '🔘', hint: 'Botón con enlace' },
  image: { label: 'Imagen', icon: '🖼️', hint: 'Imagen desde un enlace' },
  divider: { label: 'Separador', icon: '—', hint: 'Línea divisoria' },
};

export function newBlock(type: EmailBlock['type']): EmailBlock {
  switch (type) {
    case 'title': return { type, text: 'Nuevo título' };
    case 'text': return { type, text: '' };
    case 'note': return { type, text: '', tone: 'info' };
    case 'button': return { type, label: 'Ver más', url: 'https://' };
    case 'image': return { type, url: '', alt: '' };
    default: return { type };
  }
}
