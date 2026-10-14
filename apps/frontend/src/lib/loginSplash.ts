'use client';

import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api';

// Telón de carga al iniciar sesión. Vive en el layout raíz (no se desmonta al pasar de
// /login a /dashboard): el login lo abre al ingresar bien y el panel lo cierra cuando
// terminó de cargar la sesión. Así no queda la pantalla en blanco entre ambas páginas.
export type LoginSplashState = {
  active: boolean;
  name: string;
  // Centro del botón "Ingresar" (el telón se abre desde ahí); null = centro de pantalla.
  origin: { x: number; y: number } | null;
  // Canales de la empresa (keys de logo: mercadolibre, falabella…); null = aún cargando,
  // [] = no se pudieron saber (se muestran los canales principales de la plataforma).
  channels: string[] | null;
  done: boolean;
  startedAt: number;
};

const IDLE: LoginSplashState = { active: false, name: '', origin: null, channels: null, done: false, startedAt: 0 };
let state = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<LoginSplashState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useLoginSplash(): LoginSplashState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}

export function startLoginSplash(name: string, originEl?: HTMLElement | null) {
  const r = originEl?.getBoundingClientRect();
  set({
    active: true,
    name: (name || '').trim().split(/\s+/)[0] || '',
    origin: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
    channels: null,
    done: false,
    startedAt: Date.now(),
  });
}

// El panel ya cargó la sesión: el telón termina su animación y se retira solo.
export function finishLoginSplash() {
  if (state.active && !state.done) set({ done: true });
}

export function resetLoginSplash() {
  set(IDLE);
}

// Solo los roles que pueden listar conexiones; el resto ve los canales principales.
const CHANNEL_ROLES = ['COMPANY_ADMIN', 'CATALOG_MANAGER'];

export async function loadLoginSplashChannels(token: string, user: { role?: string } | null) {
  if (!CHANNEL_ROLES.includes(user?.role ?? '')) { set({ channels: [] }); return; }
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500));
  const fetchAll = Promise.all([
    api.connections.list(token).catch(() => []),
    api.marketplace.connections(token).catch(() => []),
  ]).then(([conns, ml]) => {
    const keys = (conns as { marketplace?: string }[]).map((c) => String(c.marketplace || '').toLowerCase().replace('mercado_libre', 'mercadolibre'));
    if (ml.length) keys.unshift('mercadolibre');
    return [...new Set(keys.filter(Boolean))];
  });
  const keys = await Promise.race([fetchAll, timeout]);
  if (state.active) set({ channels: keys ?? [] });
}
