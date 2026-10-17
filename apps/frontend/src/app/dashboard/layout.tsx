'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser, clearSession, saveSession } from '@/lib/auth';
import { api } from '@/lib/api';
import { hasModule } from '@/lib/modules';
import { navGroups, visibleNavGroups } from './navConfig';
import { can } from '@/lib/permissions';
import { MessagesIndicator } from './MessagesIndicator';
import { AssistantWidget } from './AssistantWidget';
import { AdminCompanyProvider } from './AdminCompanyContext';
import { CompanyGate, HeaderCompanyPicker } from './CompanyGate';
import { NotificationsProvider, NotificationBell, NotificationToasts, SoundEnableBanner } from './Notifications';
import { DialogProvider } from './ConfirmDialog';
import { UserMenu } from './UserMenu';
import { SidebarNav } from './SidebarNav';
import { finishLoginSplash } from '@/lib/loginSplash';
import { restoreOriginSession } from '@/lib/simulation';

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Admin empresa',
  CATALOG_MANAGER: 'Gestor catálogo',
  VENDEDOR: 'Vendedor',
  DESPACHADOR: 'Despachador',
  ORDER_MANAGER: 'Admin. Pedidos',
};

function matches(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

// Activo = el ítem del menú que mejor calza con la ruta (el más específico): en
// /dashboard/orders/escanear se marca "Escanear", no también "Órdenes".
function isActive(pathname: string, href: string) {
  if (!matches(pathname, href)) return false;
  return !navGroups.some((g) => g.items.some((it) => it.href.length > href.length && matches(pathname, it.href)));
}

// Iconos por sección (stroke, 16px). currentColor hereda el color del titular.
const ICON_PATHS: Record<string, string> = {
  inicio: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  ventas: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  canales: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7',
  catalogo: 'M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 12h6',
  fabricacion: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  finanzas: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  operacion: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Zm0 8 2 2 4-4',
  repartidores: 'M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  colaboradores: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.13a4 4 0 0 1 0 7.75',
  admin: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.61.76 1.03 1.4 1.09H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
};

function GroupIcon({ k }: { k: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={ICON_PATHS[k] ?? ICON_PATHS.canales} />
    </svg>
  );
}

const OPEN_KEY = 'mp_nav_open';
const COLLAPSE_KEY = 'mp_nav_collapsed';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Acordeón de un solo grupo abierto a la vez: se guarda su key (o null si no hay
  // ninguno abierto), no un mapa de booleanos por grupo.
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(OPEN_KEY) || null; } catch { return null; }
  });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  }

  const activeGroupKey = useMemo(() => {
    const g = navGroups.find((grp) => grp.items.some((it) => isActive(pathname, it.href)));
    return g?.key ?? null;
  }, [pathname]);

  useEffect(() => {
    const token = getToken();
    const u = getUser();
    if (!token || !u) {
      finishLoginSplash();
      router.push('/login');
      return;
    }
    setUser(u);
    // Refresca la sesión guardada (plan, módulos y permisos pueden haber cambiado desde el login).
    api.me(token)
      .then((me) => {
        if (!me?.id) return;
        const fresh = { ...u, ...me };
        saveSession(token, fresh);
        setUser(fresh);
      })
      .catch(() => {})
      // Ya cargó la sesión: el telón del inicio de sesión (si viene del login) se retira.
      .finally(finishLoginSplash);
  }, [router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Al navegar, el grupo de la ruta actual pasa a ser el único abierto (cierra
  // cualquier otro que hubiera quedado abierto).
  useEffect(() => {
    if (activeGroupKey) {
      setOpenGroup(activeGroupKey);
      try { localStorage.setItem(OPEN_KEY, activeGroupKey); } catch { /* ignore */ }
    }
  }, [activeGroupKey]);

  function toggleGroup(key: string) {
    setOpenGroup((s) => {
      const next = s === key ? null : key;
      try {
        if (next) localStorage.setItem(OPEN_KEY, next);
        else localStorage.removeItem(OPEN_KEY);
      } catch { /* ignore */ }
      return next;
    });
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  // Salir de «Probar permisos»: vuelve a la sesión del Super Admin (recarga completa para que
  // ningún contexto conserve datos del perfil simulado).
  async function exitSimulation() {
    await api.simulation.stop(getToken()!).catch(() => {});
    if (restoreOriginSession()) window.location.href = '/dashboard/probar-permisos';
    else { clearSession(); window.location.href = '/login'; }
  }

  const visibleGroups = useMemo(() => (user ? visibleNavGroups(user) : []), [user]);

  if (!user) return null;

  const roleLabel = roleLabels[user.role as string] ?? user.role;

  const sidebarContent = (rail: boolean | undefined, hotkey: boolean) => (
    <>
      <div className="md:hidden h-[var(--topbar-h)] px-4 flex items-center justify-between shrink-0 border-b border-[var(--border-soft)]">
        <span className="flex items-center gap-2 font-bold text-[var(--text)] text-base tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[var(--navy)] text-[0.7rem] font-bold text-white">M</span>
          Domium
        </span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>

      <SidebarNav
        groups={visibleGroups}
        userId={String(user.id ?? user.email ?? '')}
        openGroup={openGroup}
        activeGroupKey={activeGroupKey}
        onToggleGroup={toggleGroup}
        isActive={(href) => isActive(pathname, href)}
        icon={(k) => <GroupIcon k={k} />}
        rail={rail}
        onExpand={rail ? toggleCollapsed : undefined}
        onToggleRail={rail !== undefined ? toggleCollapsed : undefined}
        hotkey={hotkey}
      />

    </>
  );

  const MenuIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );

  return (
    <DialogProvider>
    <AdminCompanyProvider>
      <NotificationsProvider>
        <div className="ui-dashboard h-dvh flex overflow-hidden bg-[var(--page-bg)]">
          {/* Sidebar desktop: alto fijo (viewport), colapsable */}
          <aside
            className={`hidden md:flex md:shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex-col overflow-hidden transition-[width] duration-200 ${
              collapsed ? 'md:w-[var(--side-w-collapsed)]' : 'md:w-[var(--side-w)]'
            }`}
          >
            {sidebarContent(collapsed, true)}
          </aside>

          {/* Drawer mobile */}
          {sidebarOpen && (
            <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setSidebarOpen(false)} />
          )}
          <aside
            className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 max-w-[80vw] bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-transform duration-200 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {sidebarContent(undefined, false)}
          </aside>

          <div className="flex-1 flex flex-col min-w-0 h-dvh">
            {user.simulation && (
              <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-1.5 text-sm text-amber-950 shrink-0">
                <span className="min-w-0 flex-1">
                  <strong>Estás viendo como:</strong>{' '}
                  {user.simulation.mode === 'user'
                    ? <>{user.simulation.userName}{user.simulation.profileName ? ` (${user.simulation.profileName})` : ''}</>
                    : <>perfil «{user.simulation.profileName}»</>}
                  {' — '}{user.simulation.companyName}
                  <span className="ml-2 text-xs font-medium opacity-80">Solo lectura: ningún cambio se guarda</span>
                </span>
                <button type="button" onClick={exitSimulation} className="rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-white hover:bg-black">
                  Salir de la simulación
                </button>
              </div>
            )}
            <header className="flex items-center gap-3 px-4 h-[var(--topbar-h)] bg-[var(--topbar-bg)] text-[var(--topbar-fg)] shrink-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1 -ml-1"
                aria-label="Abrir menú"
              >
                {MenuIcon}
              </button>
              <button
                onClick={toggleCollapsed}
                className="hidden md:inline-flex p-1 -ml-1 hover:opacity-80"
                aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
              >
                {MenuIcon}
              </button>
              <span className="flex flex-1 min-w-0 items-center gap-2 font-bold tracking-tight">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-white text-[0.8rem] font-bold text-[var(--navy)]">M</span>
                <span className="truncate">Domium</span>
              </span>
              <HeaderCompanyPicker />
              {can(user, 'ml.mensajes', ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR']) && hasModule(user, 'ecommerce') && <MessagesIndicator />}
              <NotificationBell />

              <UserMenu user={user} roleLabel={roleLabel} onLogout={logout} />
            </header>
            {/* Columna: el contenido ocupa el alto libre y el pie queda siempre abajo, aunque la página tenga pocos datos. */}
            <main className="flex-1 flex flex-col overflow-y-auto px-4 pt-3 pb-4 sm:px-6 sm:pt-4 sm:pb-6 lg:px-8 lg:pt-5 lg:pb-8 min-w-0">
              <div className="flex-1 min-w-0">
                <CompanyGate>{children}</CompanyGate>
              </div>
              <footer className="shrink-0 mt-4 pt-2 -mb-2 sm:-mb-3 lg:-mb-4 border-t border-[var(--border-soft)] text-center text-xs text-[var(--text-muted)]">
                © {new Date().getFullYear()} AdminMarket de OnDataSolution
              </footer>
            </main>
          </div>
        </div>
        <NotificationToasts />
        <SoundEnableBanner />
        <AssistantWidget user={user} />
      </NotificationsProvider>
    </AdminCompanyProvider>
    </DialogProvider>
  );
}
