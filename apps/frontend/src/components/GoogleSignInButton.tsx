'use client';

import { useEffect, useRef, useState } from 'react';

// Botón oficial "Continuar con Google" (Google Identity Services). Entrega la credencial (ID token)
// que el backend verifica en /auth/google.
type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: string }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('No se pudo cargar Google')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function GoogleSignInButton({ clientId, onCredential, text = 'continue_with' }: {
  clientId: string; onCredential: (credential: string) => void; text?: 'continue_with' | 'signup_with' | 'signin_with';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  const [failed, setFailed] = useState(false);
  useEffect(() => { cb.current = onCredential; }, [onCredential]);

  useEffect(() => {
    let alive = true;
    loadScript().then(() => {
      const gid = window.google?.accounts?.id;
      if (!alive || !ref.current || !gid) return;
      gid.initialize({
        client_id: clientId,
        callback: (r: { credential?: string }) => { if (r?.credential) cb.current(r.credential); },
        ux_mode: 'popup',
      });
      ref.current.innerHTML = '';
      gid.renderButton(ref.current, {
        theme: 'outline', size: 'large', shape: 'rectangular', text, logo_alignment: 'center', locale: 'es',
        width: Math.min(400, ref.current.offsetWidth || 336),
      });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [clientId, text]);

  if (failed) return <p className="text-center text-xs text-[#757575]">No se pudo cargar el ingreso con Google. Revisa tu conexión o usa tu correo y contraseña.</p>;
  return <div ref={ref} className="flex min-h-[44px] w-full justify-center" />;
}
