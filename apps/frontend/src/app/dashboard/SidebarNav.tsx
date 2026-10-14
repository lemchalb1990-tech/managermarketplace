'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { onActivity } from '@/lib/activityBus';
import { useAdminCompany } from './AdminCompanyContext';

// Menú de módulos ("Acordeón mejorado"): buscador (Ctrl K), sección Fijados, contadores de
// pendientes y grupos desplegables con línea guía. Contraído queda como riel de íconos.

export type SideItem = { href: string; label: string };
export type SideGroup = { key: string; label: string; items: SideItem[] };

// ---- Contadores de pendientes (compartidos entre el menú de escritorio y el del celular) ----
const POLL_MS = 60_000;
let countsCache: { key: string; at: number; p: Promise<Record<string, number>> } | null = null;
function fetchCounts(companyId: string | undefined, force = false) {
  const token = getToken();
  if (!token) return Promise.resolve({});
  const key = companyId ?? '';
  if (!force && countsCache && countsCache.key === key && Date.now() - countsCache.at < POLL_MS / 2) return countsCache.p;
  const p = api.companyAccount.navCounts(token, companyId).catch(() => ({}));
  countsCache = { key, at: Date.now(), p };
  return p;
}

function useNavCounts(): Record<string, number> {
  const { companyId } = useAdminCompany();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const load = (force = false) => fetchCounts(companyId, force).then((c) => { if (alive) setCounts(c); });
    const first = setTimeout(() => load(), 0);
    const id = setInterval(() => load(), POLL_MS);
    const off = onActivity(['sale', 'question', 'claim', 'message'], () => load(true));
    const onMsg = () => load(true);
    window.addEventListener('ml-messages-changed', onMsg);
    return () => { alive = false; clearTimeout(first); clearInterval(id); off(); window.removeEventListener('ml-messages-changed', onMsg); };
  }, [companyId]);
  return counts;
}

// ---- Fijados: por usuario, en este navegador ----
const PINS_EVENT = 'mp-nav-pins';
function usePins(userId: string): [string[], (href: string) => void] {
  const key = `mp_nav_pins:${userId}`;
  const read = useCallback((): string[] => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }, [key]);
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setPins(read());
    const t = setTimeout(sync, 0);
    window.addEventListener(PINS_EVENT, sync);
    return () => { clearTimeout(t); window.removeEventListener(PINS_EVENT, sync); };
  }, [read]);
  const toggle = useCallback((href: string) => {
    const cur = read();
    const next = cur.includes(href) ? cur.filter((h) => h !== href) : [...cur, href];
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new Event(PINS_EVENT));
  }, [key, read]);
  return [pins, toggle];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Count({ n, small = false }: { n?: number; small?: boolean }) {
  if (!n) return null;
  return (
    <span className={`shrink-0 inline-grid place-items-center rounded-full bg-red-500 text-white font-bold tabular-nums ${
      small ? 'min-w-[16px] h-4 px-1 text-[10px]' : 'min-w-[20px] h-5 px-1.5 text-[11px]'}`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function Svg({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const SEARCH = 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5';
const STAR = 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z';
const CHEV = 'M9 6l6 6-6 6';
const COLLAPSE = 'M15 6l-6 6 6 6M20 4v16';
const EXPAND = 'M9 6l6 6-6 6M4 4v16';

export function SidebarNav({
  groups, userId, openGroup, activeGroupKey, onToggleGroup, isActive, icon,
  rail = false, onExpand, onToggleRail, hotkey = false,
}: {
  groups: SideGroup[];
  userId: string;
  openGroup: string | null;
  activeGroupKey: string | null;
  onToggleGroup: (key: string) => void;
  isActive: (href: string) => boolean;
  icon: (key: string) => ReactNode;
  // Riel de íconos (menú contraído en escritorio).
  rail?: boolean;
  onExpand?: () => void;
  onToggleRail?: () => void;
  // Ctrl K / ⌘K enfoca el buscador (solo una instancia lo escucha).
  hotkey?: boolean;
}) {
  const router = useRouter();
  const counts = useNavCounts();
  const [pins, togglePin] = usePins(userId);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems = useMemo(() => groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label || '' }))), [groups]);
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    return allItems.filter((it) => norm(it.label).includes(q) || norm(it.group).includes(q));
  }, [query, allItems]);
  const pinned = pins.map((h) => allItems.find((it) => it.href === h)).filter((x): x is (typeof allItems)[number] => !!x);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (rail) onExpand?.();
        setTimeout(() => inputRef.current?.focus(), rail ? 220 : 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, rail, onExpand]);

  function goFirst() {
    if (results[0]) { router.push(results[0].href); setQuery(''); inputRef.current?.blur(); }
  }

  // Ítem con su contador y la estrella para fijarlo (visible al pasar el mouse o si ya está fijado).
  const itemRow = (it: SideItem, extra?: ReactNode) => {
    const active = isActive(it.href);
    const isPinned = pins.includes(it.href);
    return (
      <div key={it.href} className={`group/it flex items-center rounded-lg transition-colors ${
        active ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]'}`}>
        <Link href={it.href} onClick={() => setQuery('')}
          className={`flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 py-1.5 text-[14px] ${active ? 'font-semibold' : 'font-medium'}`}>
          <span className="flex-1 min-w-0 truncate">{it.label}{extra}</span>
          <Count n={counts[it.href]} />
        </Link>
        <button type="button" onClick={() => togglePin(it.href)}
          aria-label={isPinned ? `Quitar ${it.label} de Fijados` : `Fijar ${it.label}`}
          title={isPinned ? 'Quitar de Fijados' : 'Fijar arriba'}
          className={`grid place-items-center w-6 h-6 mr-1 shrink-0 rounded-md transition-opacity hover:bg-black/5 ${
            isPinned ? 'text-amber-500 opacity-100' : 'text-[var(--text-muted)] opacity-0 group-hover/it:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-40'}`}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
        </button>
      </div>
    );
  };

  // ---- Riel de íconos ----
  if (rail) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1 min-h-0">
          <button type="button" onClick={() => { onExpand?.(); setTimeout(() => inputRef.current?.focus(), 220); }}
            title="Buscar módulo (Ctrl K)" aria-label="Buscar módulo"
            className="grid place-items-center w-11 h-10 rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
            <Svg d={SEARCH} className="w-[18px] h-[18px]" />
          </button>
          {groups.map((g) => {
            const total = g.items.reduce((a, it) => a + (counts[it.href] ?? 0), 0);
            const active = g.key === activeGroupKey || (!g.label && isActive(g.items[0]?.href));
            const single = !g.label;
            const cls = `relative grid place-items-center w-11 h-10 rounded-lg transition-colors ${
              active ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]'}`;
            const badge = total > 0 && <span className="absolute top-0.5 right-0.5"><Count n={total} small /></span>;
            return single ? (
              <Link key={g.key} href={g.items[0].href} title={g.items[0].label} aria-label={g.items[0].label} className={cls}>{icon('inicio')}{badge}</Link>
            ) : (
              <button key={g.key} type="button" title={g.label} aria-label={g.label} className={cls}
                onClick={() => { onExpand?.(); if (openGroup !== g.key) onToggleGroup(g.key); }}>
                {icon(g.key)}{badge}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-[var(--border-soft)] p-2 flex justify-center">
          <button type="button" onClick={onToggleRail} title="Expandir menú" aria-label="Expandir menú"
            className="grid place-items-center w-11 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
            <Svg d={EXPAND} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Buscador de módulos */}
      <div className="px-2.5 pt-2.5 pb-1.5 shrink-0">
        <label className="flex items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[var(--text-muted)] focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand-soft)]">
          <Svg d={SEARCH} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goFirst(); if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
            placeholder="Buscar módulo…" aria-label="Buscar módulo"
            className="flex-1 min-w-0 bg-transparent text-[13.5px] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none" />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="Borrar búsqueda" className="text-xs hover:text-[var(--text)]">✕</button>
          ) : hotkey && (
            <kbd className="hidden md:inline text-[10.5px] font-sans border border-[var(--border)] rounded px-1 bg-[var(--surface)]">Ctrl K</kbd>
          )}
        </label>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {query.trim() ? (
          results.length ? (
            <div className="flex flex-col gap-0.5 pt-1">
              {results.map((it) => itemRow(it, it.group && <span className="ml-1.5 text-[11.5px] font-normal text-[var(--text-muted)]">· {it.group}</span>))}
            </div>
          ) : (
            <p className="px-3 py-6 text-center text-[13px] text-[var(--text-muted)]">Ningún módulo se llama «{query.trim()}».</p>
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="pb-1.5 mb-1 border-b border-[var(--border-soft)]">
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Fijados</p>
                <div className="flex flex-col gap-0.5">{pinned.map((it) => itemRow(it))}</div>
              </div>
            )}
            {groups.map((g) => {
              // Grupo sin nombre (Inicio): link directo con ícono.
              if (!g.label) {
                const item = g.items[0];
                const active = item && isActive(item.href);
                return (
                  <Link key={g.key} href={item.href}
                    className={`flex items-center gap-2.5 px-2.5 py-2 my-0.5 rounded-lg text-[14.5px] font-semibold transition-colors ${
                      active ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]'}`}>
                    {icon('inicio')}
                    <span>{item.label}</span>
                  </Link>
                );
              }
              const open = openGroup === g.key;
              const hasActive = g.key === activeGroupKey;
              const total = g.items.reduce((a, it) => a + (counts[it.href] ?? 0), 0);
              return (
                <div key={g.key}>
                  <button type="button" onClick={() => onToggleGroup(g.key)} aria-expanded={open}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 my-0.5 rounded-lg text-left transition-colors hover:bg-[var(--surface-soft)] ${
                      open || hasActive ? 'text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}>
                    {icon(g.key)}
                    <span className={`flex-1 min-w-0 truncate text-[14.5px] ${open || hasActive ? 'font-bold' : 'font-semibold'}`}>{g.label}</span>
                    {!open && <Count n={total} />}
                    <Svg d={CHEV} className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  {open && (
                    <div className="relative flex flex-col gap-0.5 pl-[26px] pb-1.5 before:absolute before:left-[17px] before:top-1 before:bottom-2.5 before:w-px before:bg-[var(--border)]">
                      {g.items.map((it) => itemRow(it))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      {onToggleRail && (
        <div className="hidden md:block border-t border-[var(--border-soft)] p-2 shrink-0">
          <button type="button" onClick={onToggleRail}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
            <Svg d={COLLAPSE} />Contraer menú
          </button>
        </div>
      )}
    </div>
  );
}
