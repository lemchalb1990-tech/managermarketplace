'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { startLoginSplash, loadLoginSplashChannels } from '@/lib/loginSplash';
import {
  initInstallApp, useInstallApp, installAvailable, openInstallSheet, closeInstallSheet,
  promptInstall, shouldAutoOffer, isStandalone, getInstallAppState,
} from '@/lib/installApp';

// App instalable («Guiada»): desde la segunda visita en el celular sube una hoja con los
// beneficios y «Instalar app»; en iPhone muestra los 3 pasos (allí no hay botón de instalar).
// Abierta como app, al entrar se muestra la pantalla de carga de marca con los canales.
// Vive en el layout raíz para no perder el aviso de instalación del navegador.
export function InstallAppHost() {
  const pathname = usePathname();
  const s = useInstallApp();
  const inPanel = pathname?.startsWith('/dashboard') ?? false;

  useEffect(() => { initInstallApp(); }, []);

  // Abierta desde la pantalla de inicio: telón de marca mientras carga el panel (una vez por apertura).
  useEffect(() => {
    if (!inPanel || !isStandalone()) return;
    try {
      if (sessionStorage.getItem('mp_app_launch')) return;
      sessionStorage.setItem('mp_app_launch', '1');
    } catch { return; }
    const token = getToken();
    const user = getUser();
    if (!token || !user) return;
    startLoginSplash(user.name || '');
    loadLoginSplashChannels(token, user);
  }, [inPanel]);

  // Ofrecerla sola: unos segundos después de entrar al panel (el aviso de Chrome llega tarde).
  useEffect(() => {
    if (!inPanel) return;
    const t = setTimeout(() => {
      if (installAvailable(getInstallAppState()) && shouldAutoOffer()) openInstallSheet();
    }, 3000);
    return () => clearTimeout(t);
  }, [inPanel]);

  if (!inPanel || !s.sheetOpen) return null;
  return <InstallSheet ios={s.ios && !s.canPrompt} />;
}

function AppIcon({ size = 44 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/app/icon-192.png" alt="" width={size} height={size} className="rounded-xl shadow-sm border border-[var(--border)] shrink-0" />
  );
}

function InstallSheet({ ios }: { ios: boolean }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeInstallSheet(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function install() {
    setBusy(true);
    await promptInstall().catch(() => false);
    setBusy(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-[#02093a]/40" onClick={() => closeInstallSheet()} />
      <div role="dialog" aria-modal="true" aria-labelledby="install-title"
        className="ui-pop fixed z-[61] inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[380px] bg-[var(--surface)] text-[var(--text)] rounded-t-2xl sm:rounded-2xl border border-[var(--border)] shadow-[0_-10px_30px_rgba(2,9,58,0.25)] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] sm:pt-5 flex flex-col gap-4">
        <div className="sm:hidden mx-auto h-1 w-9 rounded-full bg-[var(--border)]" />
        <div className="flex items-center gap-3">
          <AppIcon />
          <div className="min-w-0">
            <p id="install-title" className="text-[15px] font-bold leading-tight">{ios ? 'Instala en tu iPhone' : 'Lleva el panel en tu teléfono'}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{ios ? '3 pasos, una sola vez' : 'Gratis · sin tiendas · se actualiza solo'}</p>
          </div>
        </div>

        {ios ? (
          <ol className="flex flex-col gap-2.5 text-[13px] text-[var(--text-2)]">
            <Step n={1}>Toca <Key><ShareIcon /> Compartir</Key> en la barra del navegador</Step>
            <Step n={2}>Elige <Key>＋ Agregar a inicio</Key></Step>
            <Step n={3}>Toca <Key>Agregar</Key> arriba a la derecha</Step>
          </ol>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px] text-[var(--text-2)]">
            <Benefit icon="⚡">Abre directo, a pantalla completa</Benefit>
            <Benefit icon="📷">Escanea códigos con la cámara</Benefit>
            <Benefit icon="🔄">Siempre al día: se actualiza sola, sin descargar nada</Benefit>
          </ul>
        )}

        <div className="flex flex-col gap-2">
          {!ios && (
            <button onClick={install} disabled={busy} className="ui-btn-brand w-full py-2.5 disabled:opacity-60">
              {busy ? 'Abriendo…' : 'Instalar app'}
            </button>
          )}
          <button onClick={() => closeInstallSheet()} className="ui-btn-secondary w-full py-2.5">
            {ios ? 'Entendido' : 'Ahora no'}
          </button>
        </div>
      </div>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="w-6 h-6 rounded-full bg-[var(--navy)] text-white text-xs font-bold grid place-items-center shrink-0">{n}</span>
      <span className="flex flex-wrap items-center gap-1">{children}</span>
    </li>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 border border-[var(--border)] bg-[var(--page-bg)] rounded-md px-1.5 py-px font-semibold text-[var(--text)]">{children}</span>;
}

function Benefit({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="w-7 h-7 rounded-lg bg-[var(--brand-light)] grid place-items-center text-sm shrink-0" aria-hidden="true">{icon}</span>
      {children}
    </li>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0a84ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
