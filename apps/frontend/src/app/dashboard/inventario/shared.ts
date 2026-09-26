import { useEffect, useState } from 'react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import type { TransferStatus } from '@/lib/api';

export type WarehouseOption = { id: string; name: string; active: boolean };

export type InventoryContext = {
  companyId?: string;
  warehouses: WarehouseOption[];
  perms: { adjust: boolean; transfer: boolean; receive: boolean };
  reloadWarehouses: () => Promise<void>;
  goTo: (tab: 'disponibilidad' | 'historial' | 'traspasos' | 'cuadratura', extra?: Record<string, string | undefined>) => void;
  params: ReadonlyURLSearchParams;
  setQuery: (next: Record<string, string | undefined>, replace?: boolean) => void;
};

export const fmtQty = (n: number | null | undefined) => (n ?? 0).toLocaleString('es-CL');
export const fmtMoney = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);

export function fmtDateTime(iso: string | null | undefined, tz: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CL', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
  IN_TRANSIT: { label: 'En tránsito', cls: 'bg-amber-100 text-amber-800' },
  RECEIVED: { label: 'Recibido', cls: 'bg-green-100 text-green-700' },
  RECEIVED_WITH_DIFF: { label: 'Recibido con diferencia', cls: 'bg-orange-100 text-orange-800' },
  CANCELLED: { label: 'Anulado', cls: 'bg-red-50 text-red-600' },
};

export const MOVEMENT_TYPES: Array<{ value: string; label: string; cls: string }> = [
  { value: 'SALE', label: 'Venta', cls: 'bg-blue-50 text-blue-700' },
  { value: 'PURCHASE', label: 'Compra', cls: 'bg-emerald-50 text-emerald-700' },
  { value: 'TRANSFER_OUT', label: 'Traspaso (salida)', cls: 'bg-amber-50 text-amber-800' },
  { value: 'TRANSFER_IN', label: 'Traspaso (entrada)', cls: 'bg-amber-50 text-amber-800' },
  { value: 'RETURN', label: 'Devolución', cls: 'bg-violet-50 text-violet-700' },
  { value: 'ADJUSTMENT', label: 'Ajuste', cls: 'bg-gray-100 text-gray-700' },
  { value: 'INITIAL', label: 'Saldo inicial', cls: 'bg-gray-100 text-gray-500' },
];
export const movementTypeCls = (t: string) => MOVEMENT_TYPES.find((m) => m.value === t)?.cls ?? 'bg-gray-100 text-gray-600';

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
