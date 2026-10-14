'use client';

import { useSyncExternalStore } from 'react';

// App instalable (PWA). Guarda el aviso de instalación de Chrome/Android para usarlo cuando
// el usuario toca «Instalar app», sabe si es iPhone (allí se instala a mano desde Compartir) y
// si el panel ya está abierto como app. El estado vive en el módulo para que la hoja de
// instalación y el menú de usuario lo compartan.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type InstallAppState = {
  // Chrome/Edge/Samsung ofrecen instalar con un botón.
  canPrompt: boolean;
  // iPhone/iPad: se instala desde Compartir → Agregar a inicio.
  ios: boolean;
  // Ya abierto como app (pantalla de inicio).
  standalone: boolean;
  sheetOpen: boolean;
};

const SERVER: InstallAppState = { canPrompt: false, ios: false, standalone: false, sheetOpen: false };
let state = SERVER;
let deferred: InstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();

const DISMISSED_KEY = 'mp_app_dismissed_at';
const INSTALLED_KEY = 'mp_app_installed';
const VISITS_KEY = 'mp_app_visits';
const DISMISS_DAYS = 30;

function set(patch: Partial<InstallAppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function store(fn: () => void) {
  try { fn(); } catch { /* sin almacenamiento (modo privado): se sigue sin recordar */ }
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// Se llama una vez en el cliente (layout raíz) para no perder el aviso de Chrome, que llega
// una sola vez al cargar la página.
export function initInstallApp() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  state = { ...state, ios, standalone: isStandalone() };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    store(() => localStorage.setItem(INSTALLED_KEY, '1'));
    set({ canPrompt: false, sheetOpen: false });
  });
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useInstallApp(): InstallAppState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

// Lectura puntual fuera del render (p. ej. dentro de un temporizador).
export function getInstallAppState() { return state; }

// Se puede ofrecer instalar: no está abierto como app y el navegador lo permite (o es iPhone).
export function installAvailable(s: InstallAppState) {
  return !s.standalone && (s.canPrompt || s.ios);
}

export function openInstallSheet() { set({ sheetOpen: true }); }

export function closeInstallSheet(remember = true) {
  if (remember) store(() => localStorage.setItem(DISMISSED_KEY, String(Date.now())));
  set({ sheetOpen: false });
}

// Muestra el aviso del navegador (Android/Chrome). Devuelve true si el usuario aceptó.
export async function promptInstall() {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === 'accepted') store(() => localStorage.setItem(INSTALLED_KEY, '1'));
  set({ canPrompt: false, sheetOpen: false });
  return outcome === 'accepted';
}

// Cuenta una visita al panel por sesión del navegador y dice si toca mostrar la hoja sola:
// desde la segunda visita, en celular, sin haberla cerrado en los últimos 30 días.
export function shouldAutoOffer(): boolean {
  let offer = false;
  store(() => {
    if (!sessionStorage.getItem('mp_app_visit')) {
      sessionStorage.setItem('mp_app_visit', '1');
      localStorage.setItem(VISITS_KEY, String(Number(localStorage.getItem(VISITS_KEY) || 0) + 1));
    }
    if (sessionStorage.getItem('mp_app_offered')) return;
    const visits = Number(localStorage.getItem(VISITS_KEY) || 0);
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) || 0);
    const recentlyDismissed = dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 86_400_000;
    const phone = window.matchMedia('(max-width: 767px)').matches;
    offer = visits >= 2 && phone && !recentlyDismissed && !localStorage.getItem(INSTALLED_KEY);
    if (offer) sessionStorage.setItem('mp_app_offered', '1');
  });
  return offer;
}
