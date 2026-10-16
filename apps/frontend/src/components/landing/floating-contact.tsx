"use client";

import { useEffect, useState } from "react";
import { useContact, scheduleHref, trialHref, contactHref } from "./contact";

const DISMISS_KEY = "lp_cta_bar_closed";
const ext = (h: string) => (h.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});

function WhatsAppIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

// Botón flotante de WhatsApp (toda la página) y, al pasar el inicio, un aviso abajo con
// «Agenda con un ejecutivo» y «Solicita tu prueba demo». El aviso se puede cerrar (por sesión)
// y se oculta al llegar al cierre de la página, que ya tiene ese llamado.
export function FloatingContact({ heroId, endId, signupEnabled }: { heroId: string; endId: string; signupEnabled: boolean }) {
  const c = useContact();
  const [pastHero, setPastHero] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [closed, setClosed] = useState(true);

  useEffect(() => {
    try { setClosed(sessionStorage.getItem(DISMISS_KEY) === "1"); } catch { setClosed(false); }
    const hero = document.getElementById(heroId);
    const end = document.getElementById(endId);
    const observers: IntersectionObserver[] = [];
    if (hero) {
      // Pasó el inicio cuando el hero ya no se ve y quedó arriba (no al cargar más abajo del todo).
      const o = new IntersectionObserver(([e]) => setPastHero(!e.isIntersecting && e.boundingClientRect.top < 0));
      o.observe(hero);
      observers.push(o);
    }
    if (end) {
      const o = new IntersectionObserver(([e]) => setAtEnd(e.isIntersecting));
      o.observe(end);
      observers.push(o);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, [heroId, endId]);

  const whatsapp = c?.whatsapp ? contactHref(c) : null;
  const schedule = scheduleHref(c);
  const trial = signupEnabled ? "/login?registro=1" : trialHref(c);
  const showBar = pastHero && !atEnd && !closed && !!(schedule || trial);

  function close() {
    setClosed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* sin almacenamiento */ }
  }

  return (
    <>
      <div
        role="region"
        aria-label="Agenda una reunión o solicita tu prueba"
        aria-hidden={!showBar}
        className={`lp-cta-bar fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6 sm:pb-5 ${showBar ? "lp-cta-bar--in" : ""}`}
      >
        <div className="relative mx-auto flex max-w-5xl flex-col gap-3 rounded-2xl bg-[#02093a] px-4 py-3.5 text-white shadow-[0_12px_40px_rgba(2,9,58,0.35)] sm:flex-row sm:items-center sm:gap-5 sm:px-6">
          <p className="flex-1 pr-9 text-[15px] leading-snug sm:pr-0">
            <span className="font-semibold">¿Te ayudamos a empezar?</span>{" "}
            <span className="text-white/75">Agenda con un ejecutivo y solicita tu prueba demo.</span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            {schedule && (
              <a href={schedule} {...ext(schedule)} tabIndex={showBar ? 0 : -1} className="lp-btn lp-btn--light">Agenda con un ejecutivo</a>
            )}
            {trial && (
              <a href={trial} {...ext(trial)} tabIndex={showBar ? 0 : -1} className="lp-btn bg-[#0075de] text-white hover:bg-[#0062ba]">Solicita tu prueba demo</a>
            )}
          </div>
          <button type="button" onClick={close} tabIndex={showBar ? 0 : -1} aria-label="Cerrar aviso"
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white sm:static sm:order-last">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {whatsapp && (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Escríbenos por WhatsApp"
          title="Escríbenos por WhatsApp"
          className={`lp-wa fixed right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-[#25d366] text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:bg-[#1ebe5b] sm:right-6 ${showBar ? "bottom-[150px] sm:bottom-28" : "bottom-4 sm:bottom-6"}`}
        >
          <WhatsAppIcon />
        </a>
      )}
    </>
  );
}
