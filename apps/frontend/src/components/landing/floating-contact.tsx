"use client";

import { useEffect, useRef, useState } from "react";
import { useContact, scheduleHref, trialHref, contactHref } from "./contact";

const DISMISS_KEY = "lp_wa_dialog_closed";
const ext = (h: string) => (h.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});

function WhatsAppIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

// Botón flotante de WhatsApp con ondas y, al pasar el inicio, un diálogo tipo chat de WhatsApp
// sobre el botón: «Agenda con un ejecutivo y solicita tu prueba demo», con las tres salidas
// (WhatsApp, agenda y prueba). Se abre solo una vez por sesión; el botón lo abre y lo cierra.
export function FloatingContact({ heroId, signupEnabled }: { heroId: string; signupEnabled: boolean }) {
  const c = useContact();
  const [open, setOpen] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { /* sin almacenamiento */ }
    autoOpened.current = dismissed;
    const hero = document.getElementById(heroId);
    if (!hero) return;
    // Al pasar el inicio (el hero ya no se ve y quedó arriba) el diálogo se abre una sola vez.
    const o = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting && e.boundingClientRect.top < 0 && !autoOpened.current) {
        autoOpened.current = true;
        setOpen(true);
      }
    });
    o.observe(hero);
    return () => o.disconnect();
  }, [heroId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const whatsapp = c?.whatsapp ? contactHref(c) : null;
  const schedule = scheduleHref(c);
  const trial = signupEnabled ? "/login?registro=1" : trialHref(c);
  if (!whatsapp && !schedule && !trial) return null;

  function close() {
    setOpen(false);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* sin almacenamiento */ }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      <div
        id="lp-wa-dialog"
        role="dialog"
        aria-label="Habla con Admin Marketplace"
        aria-hidden={!open}
        className={`lp-wa-dialog w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(0,0,0,0.22)] ${open ? "lp-wa-dialog--in" : ""}`}
      >
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[15px] font-bold text-[#075e54]">M</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">Admin Marketplace</p>
            <p className="text-[12px] text-white/80">Ejecutivo comercial</p>
          </div>
          <button type="button" onClick={close} tabIndex={open ? 0 : -1} aria-label="Cerrar"
            className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="lp-wa-chat space-y-2 px-4 py-4">
          <div className="lp-wa-bubble max-w-[85%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[14px] leading-snug text-[#111b21] shadow-sm">
            ¡Hola! ¿Te ayudamos a empezar?
          </div>
          <div className="lp-wa-bubble max-w-[85%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[14px] leading-snug text-[#111b21] shadow-sm">
            Agenda con un ejecutivo y solicita tu prueba demo. Te mostramos el panel con tus canales.
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-4">
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" tabIndex={open ? 0 : -1}
              className="flex items-center justify-center gap-2 rounded-full bg-[#25d366] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#1ebe5b]">
              <WhatsAppIcon size={18} /> Escríbenos por WhatsApp
            </a>
          )}
          <div className="grid grid-cols-2 gap-2">
            {schedule && (
              <a href={schedule} {...ext(schedule)} tabIndex={open ? 0 : -1}
                className={`rounded-full border border-[#02093a]/15 px-3 py-2 text-center text-[13px] font-semibold text-[#02093a] hover:bg-[#02093a]/5 ${trial ? "" : "col-span-2"}`}>
                Agenda con un ejecutivo
              </a>
            )}
            {trial && (
              <a href={trial} {...ext(trial)} tabIndex={open ? 0 : -1}
                className={`rounded-full bg-[#02093a] px-3 py-2 text-center text-[13px] font-semibold text-white hover:bg-[#0b1d5c] ${schedule ? "" : "col-span-2"}`}>
                Solicita tu prueba demo
              </a>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="lp-wa-dialog"
        aria-label={open ? "Cerrar el chat" : "Habla con nosotros por WhatsApp"}
        className="lp-wa relative grid h-14 w-14 place-items-center rounded-full bg-[#25d366] text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:bg-[#1ebe5b]"
      >
        {!open && <><span className="lp-wa-wave" aria-hidden="true" /><span className="lp-wa-wave lp-wa-wave--2" aria-hidden="true" /></>}
        {open
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          : <WhatsAppIcon />}
      </button>
    </div>
  );
}
