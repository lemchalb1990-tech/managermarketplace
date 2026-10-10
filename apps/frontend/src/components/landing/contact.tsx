"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Contact = { whatsapp: string | null; email: string | null; scheduleUrl: string | null };

// Se pide una sola vez por página (lo usan el inicio, precios y el cierre).
let contactPromise: Promise<Contact> | null = null;
function loadContact(): Promise<Contact> {
  if (!contactPromise) {
    contactPromise = api.public.contact().catch(() => ({ whatsapp: null, email: null, scheduleUrl: null }));
  }
  return contactPromise;
}

export function useContact(): Contact | null {
  const [c, setC] = useState<Contact | null>(null);
  useEffect(() => {
    let alive = true;
    loadContact().then((v) => { if (alive) setC(v); });
    return () => { alive = false; };
  }, []);
  return c;
}

const wa = (num: string, text: string) => `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
const mail = (to: string, subject: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}`;

/** Link para agendar: la agenda configurada; si no hay, WhatsApp o correo. */
export function scheduleHref(c: Contact | null): string | null {
  if (!c) return null;
  if (c.scheduleUrl) return c.scheduleUrl;
  if (c.whatsapp) return wa(c.whatsapp, "Hola, quiero agendar una reunión con un ejecutivo de Admin Marketplace.");
  if (c.email) return mail(c.email, "Agendar reunión con un ejecutivo");
  return null;
}

/** Link de contacto: WhatsApp; si no hay, correo; si no, la agenda. */
export function contactHref(c: Contact | null): string | null {
  if (!c) return null;
  if (c.whatsapp) return wa(c.whatsapp, "Hola, quiero más información sobre Admin Marketplace.");
  if (c.email) return mail(c.email, "Quiero más información sobre Admin Marketplace");
  return c.scheduleUrl;
}

/** Botones "Agenda con un ejecutivo" y "Contáctanos" (se ocultan si no hay datos de contacto). */
export function ContactButtons({ dark = false, size = "lg" }: { dark?: boolean; size?: "md" | "lg" }) {
  const c = useContact();
  const schedule = scheduleHref(c);
  const contact = contactHref(c);
  const lg = size === "lg" ? "lp-btn--lg" : "";
  const outline = dark
    ? "bg-white/10 text-white hover:bg-white/20"
    : "lp-btn--soft";
  const border = dark ? { border: "1px solid rgba(255,255,255,0.18)" } : undefined;
  const ext = (h: string) => (h.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});
  return (
    <>
      {schedule && (
        <a href={schedule} {...ext(schedule)} className={`lp-btn ${lg} ${outline}`} style={border}>
          Agenda con un ejecutivo
        </a>
      )}
      {contact && contact !== schedule && (
        <a href={contact} {...ext(contact)} className={`lp-btn ${lg} ${dark ? "text-white/85 hover:text-white underline-offset-4 hover:underline" : "lp-btn--text"}`}>
          Contáctanos
        </a>
      )}
    </>
  );
}
