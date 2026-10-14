'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type SubscriptionUsage } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useContact, supportHref } from '@/components/landing/contact';
import { useAdminCompany } from './AdminCompanyContext';

// Menú de usuario de la barra superior ("Cuenta y empresa"): cabecera azul marino con la
// cuenta, la empresa, su plan, los días de prueba y el uso de productos; accesos grandes
// según el rol. En celular sube desde abajo como hoja.

const ICONS: Record<string, ReactNode> = {
  company: <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3" />,
  users: <path d="M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3 2.2 3.5 5" />,
  plan: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  lock: <path d="M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM8 11V7a4 4 0 0 1 8 0v4" />,
  help: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />,
  out: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />,
};

function Icon({ k, className = 'w-[18px] h-[18px]' }: { k: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      {ICONS[k]}
    </svg>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

type Tile = { key: string; icon: string; title: string; hint: string; href?: string; onClick?: () => void };

type MenuUser = { name?: string; email?: string; role?: string; company?: { name?: string; planName?: string | null } | null };

export function UserMenu({ user, roleLabel, onLogout }: { user: MenuUser; roleLabel: string; onLogout: () => void }) {
  const pathname = usePathname();
  const { isSuperAdmin, selectedCompanyId, companies } = useAdminCompany();
  const contact = useContact();
  // Ruta en la que se abrió: al navegar a otra página el menú queda cerrado solo.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((cur) => ((typeof v === 'function' ? v(cur === pathname) : v) ? pathname : null));
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [resetMsg, setResetMsg] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const name: string = user.name || user.email || '';
  const isAdmin = user.role === 'COMPANY_ADMIN' || (isSuperAdmin && !!selectedCompanyId);
  const companyName: string = isSuperAdmin
    ? (companies.find((c) => c.id === selectedCompanyId)?.name ?? '')
    : (user.company?.name ?? '');

  // Cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plan y uso: se piden al abrir (solo administradores; el servidor no lo entrega a otros roles).
  useEffect(() => {
    const token = getToken();
    if (!open || !isAdmin || !token) return;
    let alive = true;
    api.subscription.usage(token, isSuperAdmin ? selectedCompanyId : undefined)
      .then((u) => {
        if (!alive) return;
        setUsage(u);
        setTrialDays(u.plan?.isTrial && u.trialEndsAt ? Math.ceil((new Date(u.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, isAdmin, isSuperAdmin, selectedCompanyId]);

  async function sendPasswordLink() {
    setResetMsg('Enviando…');
    try {
      await api.auth.forgotPassword(user.email || '');
      setResetMsg(`Te enviamos a ${user.email} un enlace para cambiar tu contraseña.`);
    } catch (err) {
      setResetMsg((err as Error).message || 'No se pudo enviar el enlace. Inténtalo de nuevo.');
    }
  }

  const plan = usage?.plan;
  const planName: string | null = plan?.name ?? user.company?.planName ?? null;
  const products = usage?.usage.products;
  const productsPct = products?.limit ? Math.min(100, Math.round((products.used / products.limit) * 100)) : 0;
  const people = usage?.usage.users;

  const tiles: Tile[] = [
    ...(isAdmin ? [
      { key: 'company', icon: 'company', title: 'Mi empresa', hint: 'Datos y configuración', href: '/dashboard/settings' },
      { key: 'users', icon: 'users', title: 'Usuarios', hint: people ? `${people.used} persona${people.used === 1 ? '' : 's'} en tu equipo` : 'Tu equipo y permisos', href: '/dashboard/users' },
      { key: 'plan', icon: 'plan', title: 'Plan y uso', hint: plan?.isTrial ? 'Elige tu plan' : 'Límites y consumo', href: '/dashboard/uso' },
    ] : []),
    { key: 'lock', icon: 'lock', title: 'Contraseña', hint: 'Te enviamos un enlace', onClick: sendPasswordLink },
  ];
  const help = supportHref(contact, companyName);
  const tileCls = 'flex flex-col items-start gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2 py-1 rounded-[10px] hover:bg-white/10 transition-colors"
        aria-label="Menú de usuario"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="relative w-[34px] h-[34px] rounded-full bg-white/25 text-white text-xs font-bold grid place-items-center shrink-0">
          {initials(name)}
          <span className="absolute -right-px -bottom-px w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[var(--topbar-bg)]" />
        </span>
        <span className="text-sm font-medium hidden sm:inline max-w-[140px] truncate">{user.name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          {/* Fondo oscuro solo en celular (hoja inferior). */}
          <div className="sm:hidden fixed inset-0 z-40 bg-[#02093a]/40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="ui-pop fixed sm:absolute inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 z-50 sm:w-[320px] max-h-[85dvh] overflow-y-auto bg-[var(--surface)] text-[var(--text)] text-left rounded-t-2xl sm:rounded-[14px] border border-[var(--border)] shadow-[0_16px_40px_-8px_rgba(2,9,58,0.28),0_2px_6px_rgba(2,9,58,0.08)] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="sm:hidden mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--border)]" />

            {/* Cabecera: cuenta y empresa */}
            <div className="m-2 sm:m-0 rounded-xl sm:rounded-none sm:rounded-t-[13px] bg-gradient-to-br from-[#02093a] to-[#0b1d5c] text-white px-4 pt-4 pb-4 flex flex-col gap-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="relative w-11 h-11 rounded-full bg-white text-[#02093a] text-[15px] font-bold grid place-items-center shrink-0">
                  {initials(name)}
                  <span className="absolute -right-px -bottom-px w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#02093a]" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{user.name}</p>
                  <p className="text-xs text-white/70 truncate">{user.email}</p>
                  <span className="inline-flex mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/15">{roleLabel}</span>
                </div>
              </div>

              {companyName && (
                <div className="rounded-[10px] bg-white/[0.08] border border-white/[0.12] px-3 py-2.5 flex flex-col gap-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{companyName}</span>
                    {trialDays != null && (
                      <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${trialDays > 0 ? 'bg-[#ffd78a] text-[#4a2d00]' : 'bg-[#fdecea] text-[#b42318]'}`}>
                        {trialDays > 0 ? `Prueba: ${trialDays} día${trialDays === 1 ? '' : 's'}` : 'Prueba vencida'}
                      </span>
                    )}
                  </div>
                  {planName && (
                    <div className="flex items-center justify-between gap-2 text-xs text-white/70">
                      <span className="truncate">Plan {planName}{products ? ' · productos' : ''}</span>
                      {products && (
                        <span className="shrink-0 tabular-nums">
                          {products.limit == null ? 'Ilimitados' : `${products.used.toLocaleString('es-CL')} de ${products.limit.toLocaleString('es-CL')}`}
                        </span>
                      )}
                    </div>
                  )}
                  {products?.limit != null && (
                    <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                      <div className={`h-full rounded-full ${productsPct >= 90 ? 'bg-[#ff8a7a]' : 'bg-[#62aef0]'}`} style={{ width: `${productsPct}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Accesos según el rol */}
            <div className="grid grid-cols-2 gap-2 p-3">
              {tiles.map((t, i) => {
                const span = tiles.length % 2 === 1 && i === tiles.length - 1 ? 'col-span-2' : '';
                const body = (
                  <>
                    <Icon k={t.icon} className="w-[18px] h-[18px] text-[var(--brand)]" />
                    <span>{t.title}</span>
                    <span className="text-[11px] font-normal text-[var(--text-muted)]">{t.hint}</span>
                  </>
                );
                return t.href
                  ? <Link key={t.key} href={t.href} role="menuitem" className={`${tileCls} ${span}`}>{body}</Link>
                  : <button key={t.key} type="button" role="menuitem" onClick={t.onClick} className={`${tileCls} ${span}`}>{body}</button>;
              })}
              {resetMsg && <p className="col-span-2 rounded-lg bg-[var(--brand-light)] px-3 py-2 text-xs text-[var(--brand-ink)]">{resetMsg}</p>}
            </div>

            <div className="border-t border-[var(--border)] py-1">
              {help && (
                <a href={help} target="_blank" rel="noopener noreferrer" role="menuitem"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--surface-soft)]">
                  <Icon k="help" className="w-[18px] h-[18px] text-[var(--text-muted)]" />Ayuda y soporte
                </a>
              )}
              <button type="button" role="menuitem" onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                <Icon k="out" />Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
