'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useLoginSplash, resetLoginSplash, type LoginSplashState } from '@/lib/loginSplash';
import { usePlatformLogos, resolvePlatformLogo } from '@/lib/platformLogos';
import { connectorOnLanding, connectorStatus } from '@/lib/connectors';
import { Logos } from '@/app/dashboard/ecommerce/components/logos';

// Tiempo mínimo a la vista para que la animación se alcance a leer, y tope por si el
// panel nunca avisa que cargó (p. ej. redirige de vuelta al login).
const MIN_MS = 1700;
const MAX_MS = 10000;
const MAX_CHANNELS = 8;
const FALLBACK = ['mercadolibre', 'falabella', 'paris', 'ripley', 'walmart'];

// Se monta una sola vez en el layout raíz; solo dibuja algo mientras el telón está activo.
export function LoginSplashHost() {
  const s = useLoginSplash();
  if (!s.active) return null;
  return <Splash key={s.startedAt} s={s} />;
}

function Splash({ s }: { s: LoginSplashState }) {
  const logoMap = usePlatformLogos();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(0);
  const [progress, setProgress] = useState(6);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const messages = [
    s.name ? `Hola de nuevo, ${s.name}` : 'Hola de nuevo',
    'Cargando tu empresa y permisos',
    'Conectando con tus canales',
    'Preparando tu panel',
  ];

  // Abre el telón en el cuadro siguiente para que la transición de clip-path corra.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Mensajes rotativos y barra que avanza hacia 90% mientras se espera al panel.
  useEffect(() => {
    if (ready) return;
    const m = setInterval(() => setMsg((i) => Math.min(i + 1, messages.length - 1)), 750);
    const p = setInterval(() => setProgress((v) => v + (90 - v) * 0.09), 120);
    return () => { clearInterval(m); clearInterval(p); };
  }, [ready, messages.length]);

  // Cierre: espera a que el panel avise (o al tope), respeta el mínimo y se retira.
  useEffect(() => {
    const elapsed = Date.now() - s.startedAt;
    const wait = s.done ? Math.max(0, MIN_MS - elapsed) : MAX_MS - elapsed;
    const t = setTimeout(() => setReady(true), Math.max(0, wait));
    return () => clearTimeout(t);
  }, [s.done, s.startedAt]);

  useEffect(() => {
    if (!ready) return;
    const a = setTimeout(() => setLeaving(true), 500);
    const b = setTimeout(() => resetLoginSplash(), 1000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [ready]);

  const known = (s.channels ?? []).filter((k) => Logos[k]);
  const channels = s.channels === null ? [] : (known.length ? known : FALLBACK.filter((k) => connectorStatus(logoMap, k) === 'AVAILABLE' && connectorOnLanding(logoMap, k))).slice(0, MAX_CHANNELS);
  const origin = s.origin ? `${s.origin.x}px ${s.origin.y}px` : '50% 50%';

  return (
    <div
      className={`ls-curtain ${open ? 'is-open' : ''} ${leaving ? 'is-leaving' : ''}`}
      style={{ '--ls-origin': origin } as CSSProperties}
      role="status"
      aria-live="polite"
    >
      <div className="ls-orbit">
        <div className="ls-ring" />
        <div className="ls-mark">M</div>
        {channels.map((k, i) => (
          <div key={k} className="ls-slot" style={{ '--ls-a': `${(360 / channels.length) * i - 90}deg` } as CSSProperties}>
            <span className="ls-ch" style={{ animationDelay: `${120 + i * 160}ms` }}>
              <span className="h-full w-full overflow-hidden rounded-full [&>*]:h-full [&>*]:w-full [&>img]:object-cover [&>img]:rounded-full [&>svg]:scale-[1.7]">
                {resolvePlatformLogo(logoMap, k, Logos[k], k, 'login')}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p key={ready ? 'ok' : msg} className="ls-msg">{ready ? 'Todo listo' : messages[msg]}</p>
      <div className="ls-bar"><i style={{ width: `${ready ? 100 : progress}%` }} /></div>
    </div>
  );
}
