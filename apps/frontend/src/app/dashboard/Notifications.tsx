'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from './AdminCompanyContext';

const POLL_MS = 25000;
const TOAST_DISMISS_MS = 10000;
const HISTORY_LIMIT = 30;
const SINCE_KEY = 'mp_notif_since';
const HISTORY_KEY = 'mp_notif_history';

export type NotifEvent = {
  key: string;
  type: 'sale' | 'question' | 'claim';
  title: string;
  subtitle: string;
  href: string;
  createdAt: string;
  read: boolean;
};

const TYPE_STYLE: Record<NotifEvent['type'], { icon: string; accent: string }> = {
  sale: { icon: '🛒', accent: 'var(--ok)' },
  question: { icon: '❓', accent: 'var(--info)' },
  claim: { icon: '⚠️', accent: 'var(--warn)' },
};

function loadHistory(): NotifEvent[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(history: NotifEvent[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT))); } catch {}
}

interface NotificationsCtx {
  history: NotifEvent[];
  unreadCount: number;
  markAllRead: () => void;
  toasts: NotifEvent[];
  dismissToast: (key: string) => void;
  go: (e: NotifEvent) => void;
}

const Ctx = createContext<NotificationsCtx | null>(null);

export function useNotifications(): NotificationsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications debe usarse dentro de <NotificationsProvider>');
  return ctx;
}

// Avisa (campanita + aviso emergente) de ventas nuevas de cualquier canal y preguntas/
// reclamos nuevos de Mercado Libre. El polling se guarda en localStorage (no se reinicia
// al recargar la página) y la campanita conserva el historial aunque los avisos
// emergentes ya se hayan cerrado solos.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isSuperAdmin, selectedCompanyId, companyId } = useAdminCompany();
  const [history, setHistory] = useState<NotifEvent[]>([]);
  const [toasts, setToasts] = useState<NotifEvent[]>([]);
  const shouldPoll = !isSuperAdmin || !!selectedCompanyId;

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;

    async function poll() {
      const token = getToken();
      if (!token) return;
      let since = '';
      try { since = localStorage.getItem(SINCE_KEY) || ''; } catch {}
      // Primera vez que se corre en este navegador: arranca desde ahora, no desde el
      // historial completo (si no, avisaría de todo lo que ya existía).
      if (!since) {
        since = new Date().toISOString();
        try { localStorage.setItem(SINCE_KEY, since); } catch {}
        return;
      }
      try {
        const res = await api.marketplace.notifications(token, since, companyId);
        if (cancelled) return;
        try { localStorage.setItem(SINCE_KEY, res.serverTime); } catch {}
        if (res.events.length) {
          const fresh: NotifEvent[] = res.events.map((e) => ({
            key: `${e.type}-${e.id}`, type: e.type, title: e.title, subtitle: e.subtitle, href: e.href,
            createdAt: e.createdAt, read: false,
          }));
          setHistory((prev) => {
            const seen = new Set(prev.map((p) => p.key));
            const merged = [...fresh.filter((f) => !seen.has(f.key)), ...prev].slice(0, HISTORY_LIMIT);
            saveHistory(merged);
            return merged;
          });
          setToasts((prev) => [...fresh, ...prev]);
        }
      } catch {
        // Silencioso: un fallo puntual de polling no debe interrumpir al usuario.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [shouldPoll, companyId]);

  function dismissToast(key: string) {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismissToast(t.key), TOAST_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);

  const markAllRead = useCallback(() => {
    setHistory((prev) => {
      const updated = prev.map((e) => ({ ...e, read: true }));
      saveHistory(updated);
      return updated;
    });
  }, []);

  const go = useCallback((e: NotifEvent) => {
    setHistory((prev) => {
      const updated = prev.map((h) => (h.key === e.key ? { ...h, read: true } : h));
      saveHistory(updated);
      return updated;
    });
    dismissToast(e.key);
    router.push(e.href);
  }, [router]);

  const unreadCount = history.filter((h) => !h.read).length;

  return (
    <Ctx.Provider value={{ history, unreadCount, markAllRead, toasts, dismissToast, go }}>
      {children}
    </Ctx.Provider>
  );
}

export function NotificationBell() {
  const { history, unreadCount, markAllRead, go } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 rounded-full hover:bg-white/10"
        aria-label="Notificaciones"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-white rounded-xl shadow-xl border border-gray-200 text-gray-900 z-[110] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold">Notificaciones</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                Marcar todo leído
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sin notificaciones todavía</p>
            ) : (
              history.map((e) => {
                const style = TYPE_STYLE[e.type];
                return (
                  <button
                    key={e.key}
                    onClick={() => { go(e); setOpen(false); }}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-gray-50 last:border-b-0 hover:bg-gray-50 ${e.read ? '' : 'bg-blue-50/40'}`}
                  >
                    <span className="text-base shrink-0 mt-0.5">{style.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-800">{e.title}</span>
                      <span className="block text-xs text-gray-500 truncate">{e.subtitle}</span>
                      <span className="block text-[11px] text-gray-400 mt-0.5">
                        {new Date(e.createdAt).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                    {!e.read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationToasts() {
  const { toasts, dismissToast, go } = useNotifications();
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(340px,calc(100vw-2rem))]">
      {toasts.map((t) => {
        const style = TYPE_STYLE[t.type];
        return (
          <div
            key={t.key}
            onClick={() => go(t)}
            className="ui-card cursor-pointer flex items-start gap-3 px-4 py-3 shadow-lg border-l-4 hover:shadow-xl transition-shadow"
            style={{ borderLeftColor: style.accent }}
            role="button"
          >
            <span className="text-lg shrink-0">{style.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text)]">{t.title}</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{t.subtitle}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismissToast(t.key); }}
              className="text-[var(--text-muted)] hover:text-[var(--text)] leading-none shrink-0"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
