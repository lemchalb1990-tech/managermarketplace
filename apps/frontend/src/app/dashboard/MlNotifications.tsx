'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from './AdminCompanyContext';

const POLL_MS = 25000;
const AUTO_DISMISS_MS = 10000;

type ToastEvent = {
  key: string;
  type: 'sale' | 'question' | 'claim';
  title: string;
  subtitle: string;
  href: string;
};

const TYPE_STYLE: Record<ToastEvent['type'], { icon: string; accent: string }> = {
  sale: { icon: '🛒', accent: 'var(--ok)' },
  question: { icon: '❓', accent: 'var(--info)' },
  claim: { icon: '⚠️', accent: 'var(--warn)' },
};

// Avisa en vivo (polling cada 25s) de ventas, preguntas y reclamos nuevos de Mercado
// Libre — un aviso emergente abajo a la derecha que, al hacer clic, lleva al detalle.
export default function MlNotifications() {
  const router = useRouter();
  const { isSuperAdmin, selectedCompanyId, companyId } = useAdminCompany();
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const sinceRef = useRef<string>(new Date().toISOString());
  const shouldPoll = !isSuperAdmin || !!selectedCompanyId;

  useEffect(() => {
    if (!shouldPoll) return;
    // Al cambiar de empresa (o al montar), la línea de tiempo arranca de nuevo desde
    // ahora — no queremos avisar de todo el historial que ya existía.
    sinceRef.current = new Date().toISOString();

    let cancelled = false;
    async function poll() {
      const token = getToken();
      if (!token) return;
      try {
        const res = await api.marketplace.notifications(token, sinceRef.current, companyId);
        if (cancelled) return;
        sinceRef.current = res.serverTime;
        if (res.events.length) {
          setToasts((prev) => [
            ...res.events.map((e) => ({ key: `${e.type}-${e.id}`, type: e.type, title: e.title, subtitle: e.subtitle, href: e.href })),
            ...prev,
          ]);
        }
      } catch {
        // Silencioso: un fallo puntual de polling no debe interrumpir al usuario.
      }
    }

    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [shouldPoll, companyId]);

  function dismiss(key: string) {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.key), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(340px,calc(100vw-2rem))]">
      {toasts.map((t) => {
        const style = TYPE_STYLE[t.type];
        return (
          <div
            key={t.key}
            onClick={() => { router.push(t.href); dismiss(t.key); }}
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
              onClick={(e) => { e.stopPropagation(); dismiss(t.key); }}
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
