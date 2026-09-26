'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { can } from '@/lib/permissions';
import { useAdminCompany } from '../AdminCompanyContext';
import { AvailabilityTab } from './AvailabilityTab';
import { MovementsTab } from './MovementsTab';
import { TransfersTab } from './TransfersTab';
import { ReconciliationTab } from './ReconciliationTab';
import type { InventoryContext, WarehouseOption } from './shared';

type Tab = 'disponibilidad' | 'historial' | 'traspasos' | 'cuadratura';
const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'];

export default function InventoryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { selectedCompanyId } = useAdminCompany();
  const [user, setUser] = useState<any>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

  const tab = (params.get('tab') as Tab) || 'disponibilidad';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;
  const blocked = isSuperAdmin && !selectedCompanyId;

  // Permisos al día desde el servidor (el usuario guardado al iniciar sesión puede no traer
  // los permisos nuevos de inventario y traspasos).
  useEffect(() => {
    const stored = getUser();
    setUser(stored);
    const token = getToken();
    if (!token) return;
    api.me(token).then((fresh) => setUser((u: any) => ({ ...u, ...fresh }))).catch(() => {});
  }, []);

  const loadWarehouses = useCallback(async () => {
    const token = getToken();
    if (!token || blocked || !user) return;
    const list = await api.warehouses.list(token, companyId).catch(() => []);
    setWarehouses(list.map((w: any) => ({ id: w.id, name: w.name, active: w.active })));
  }, [blocked, companyId, user]);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);

  const setQuery = useCallback((next: Record<string, string | undefined>, replace = false) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v); else q.delete(k);
    }
    const url = `/dashboard/inventario?${q}`;
    if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }, [params, router]);

  const perms = {
    adjust: can(user, 'inventory.adjust', ADMIN_ROLES),
    transfer: can(user, 'transfers', ADMIN_ROLES),
    receive: can(user, 'transfers.receive', ADMIN_ROLES) || can(user, 'transfers', ADMIN_ROLES),
  };

  const ctx: InventoryContext = {
    companyId, warehouses, perms, reloadWarehouses: loadWarehouses,
    goTo: (t, extra) => setQuery({ tab: t === 'disponibilidad' ? undefined : t, productId: undefined, warehouseId: undefined, transferId: undefined, ...extra }),
    params, setQuery,
  };

  const tabs: Array<{ key: Tab; label: string; show: boolean }> = [
    { key: 'disponibilidad', label: 'Disponibilidad por bodega', show: true },
    { key: 'historial', label: 'Historial de productos', show: true },
    { key: 'traspasos', label: 'Traspasos', show: true },
    { key: 'cuadratura', label: 'Cuadratura', show: perms.adjust },
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[1.375rem] font-bold text-gray-900">Inventario</h1>
        <p className="text-gray-500 text-xs mt-0.5">
          Stock por bodega, historial de cada movimiento y traspasos con recepción.
        </p>
      </div>

      {blocked ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-gray-400 text-sm">
          Selecciona una empresa arriba para ver su inventario.
        </div>
      ) : !user ? null : (
        <>
          <div className="flex items-center border-b border-gray-200 mb-5 overflow-x-auto">
            {tabs.filter((t) => t.show).map((t) => (
              <button key={t.key} onClick={() => ctx.goTo(t.key)}
                className={`py-2.5 px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'disponibilidad' && <AvailabilityTab ctx={ctx} />}
          {tab === 'historial' && <MovementsTab ctx={ctx} />}
          {tab === 'traspasos' && <TransfersTab ctx={ctx} />}
          {tab === 'cuadratura' && perms.adjust && <ReconciliationTab ctx={ctx} />}
        </>
      )}
    </div>
  );
}
