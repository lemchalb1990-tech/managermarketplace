// Estado de una orden de Walmart, Ripley, Paris o Falabella normalizado para reflejarlo en la
// Orden interna. Cada adaptador traduce los estados propios del marketplace (por línea o por
// unidad) a estos cuatro, y `combineLineStatuses` decide el estado de la orden completa.
import { Prisma } from '@prisma/client';

export type ChannelOrderStatus = 'PENDING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface ChannelOrderState {
  status: ChannelOrderStatus | null; // null = estado no reconocido: solo queda en el historial
  label: string;                     // estado tal como lo informa el marketplace (en español)
  courier?: string | null;
  trackingCode?: string | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

// Venta recién creada por la importación automática, para que ChannelOrdersService cree su
// Orden y descuente stock dentro de la misma transacción.
export interface CreatedChannelSale {
  sale: { id: string; companyId: string; items: { id: string; productId: string; quantity: number }[] };
  externalId: string;
  state: ChannelOrderState;
  // Productos cuya línea viene cancelada en el marketplace: no descuentan stock.
  cancelledProductIds: string[];
  customer: { name?: string | null; phone?: string | null; address?: string | null; commune?: string | null; region?: string | null };
}

export type OnSaleCreated = (tx: Prisma.TransactionClient, created: CreatedChannelSale) => Promise<void>;

// Una orden con líneas en distintos estados avanza al paso que alcanzaron TODAS sus líneas
// activas; las canceladas no cuentan, salvo que lo estén todas.
export function combineLineStatuses(statuses: (ChannelOrderStatus | null)[]): ChannelOrderStatus | null {
  if (!statuses.length) return null;
  const active = statuses.filter((s) => s !== 'CANCELLED');
  if (!active.length) return 'CANCELLED';
  if (active.every((s) => s === 'DELIVERED')) return 'DELIVERED';
  if (active.every((s) => s === 'SHIPPED' || s === 'DELIVERED')) return 'SHIPPED';
  return 'PENDING';
}

// Etiqueta de la orden completa a partir de las etiquetas de sus líneas (sin repetir).
export function joinLabels(labels: string[]): string {
  return Array.from(new Set(labels.filter(Boolean))).join(' / ') || 'Sin estado';
}
