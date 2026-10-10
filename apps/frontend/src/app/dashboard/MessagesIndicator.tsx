'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { onActivity } from '@/lib/activityBus';
import { useAdminCompany } from './AdminCompanyContext';

const POLL_MS = 60_000;

/** Ícono de mensajes junto a la campanita: conversaciones de Mercado Libre sin leer. */
export function MessagesIndicator() {
  const { companyId } = useAdminCompany();
  const [count, setCount] = useState(0);

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    api.marketplace.messages.unreadCount(t, companyId).then((r) => setCount(r.count)).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, POLL_MS);
    // Se actualiza al llegar un mensaje nuevo y al leer o marcar conversaciones en la bandeja.
    const off = onActivity(['message'], load);
    window.addEventListener('ml-messages-changed', load);
    return () => { clearTimeout(first); clearInterval(id); off(); window.removeEventListener('ml-messages-changed', load); };
  }, [load]);

  return (
    <Link href="/dashboard/mercadolibre/mensajes" className="relative rounded-full p-1.5 hover:bg-white/10"
      aria-label={count ? `${count} conversaciones sin leer` : 'Mensajes'} title={count ? `${count} conversación(es) sin leer` : 'Mensajes'}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
