import { SaleChannel } from '@prisma/client';

// Grupo de transportista/servicio para la consola de "Órdenes y envíos".
export type CarrierGroup = {
  key: string;
  label: string;
  defaultCutoff: string; // HH:MM, hora límite de despacho
};

export const CARRIER_GROUPS: Record<string, CarrierGroup> = {
  ml_flex: {
    key: 'ml_flex',
    label: 'Mercado Envíos Flex',
    defaultCutoff: '19:00',
  },
  ml_colecta: {
    key: 'ml_colecta',
    label: 'Mercado Envíos Colecta',
    defaultCutoff: '18:00',
  },
  ml_agencias: {
    key: 'ml_agencias',
    label: 'Mercado Envíos Agencias',
    defaultCutoff: '23:59',
  },
  falabella: {
    key: 'falabella',
    label: 'Envío Falabella',
    defaultCutoff: '18:00',
  },
  paris: { key: 'paris', label: 'Envío Paris', defaultCutoff: '17:00' },
  ripley: { key: 'ripley', label: 'Envío Ripley', defaultCutoff: '18:00' },
  lider: {
    key: 'lider',
    label: 'Envío Líder / Walmart',
    defaultCutoff: '15:00',
  },
  hites: { key: 'hites', label: 'Envío Hites', defaultCutoff: '18:00' },
  propio: {
    key: 'propio',
    label: 'Despacho propio / retiro',
    defaultCutoff: '20:00',
  },
  otro: { key: 'otro', label: 'Otros', defaultCutoff: '20:00' },
};

export const CARRIER_ORDER = [
  'ml_flex',
  'ml_colecta',
  'ml_agencias',
  'falabella',
  'paris',
  'ripley',
  'lider',
  'hites',
  'propio',
  'otro',
];

/** Deriva la clave de grupo de un pedido a partir de su venta / courier. */
export function carrierGroupKey(
  sale: { channel?: SaleChannel | null; shippingMethod?: string | null } | null,
  order: { courier?: string | null; fulfillmentType?: string | null },
): string {
  const method = (sale?.shippingMethod || order.courier || '').toLowerCase();
  const channel = sale?.channel;

  if (channel === SaleChannel.MERCADO_LIBRE) {
    if (/self_service|flex/.test(method)) return 'ml_flex';
    if (/drop_off|agenc/.test(method)) return 'ml_agencias';
    return 'ml_colecta';
  }
  if (channel === SaleChannel.FALABELLA) return 'falabella';
  if (channel === SaleChannel.PARIS) return 'paris';
  if (channel === SaleChannel.RIPLEY) return 'ripley';
  if (channel === SaleChannel.WALMART) return 'lider';
  if (channel === SaleChannel.HITES) return 'hites';
  if (
    !channel ||
    channel === SaleChannel.POS ||
    channel === SaleChannel.MANUAL ||
    channel === SaleChannel.ORDER_REQUEST
  ) {
    return 'propio';
  }
  return 'otro';
}

export function resolveCutoffs(
  companyCutoffs: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CARRIER_ORDER) out[k] = CARRIER_GROUPS[k].defaultCutoff;
  if (companyCutoffs && typeof companyCutoffs === 'object') {
    for (const [k, v] of Object.entries(
      companyCutoffs as Record<string, unknown>,
    )) {
      if (out[k] && typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v))
        out[k] = v;
    }
  }
  return out;
}

/** ¿La hora actual ya pasó el cutoff HH:MM de hoy? */
export function isOverdue(cutoff: string, now = new Date()): boolean {
  const [h, m] = cutoff.split(':').map(Number);
  const limit = new Date(now);
  limit.setHours(h, m, 0, 0);
  return now.getTime() > limit.getTime();
}
