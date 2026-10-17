"use client";

// Menú superior de la landing: franja de anuncio y barra transparente sobre la portada que se
// vuelve sólida al bajar, con la sección activa marcada y menú desplegable en el celular.
import { useEffect, useState } from "react";
import Link from "next/link";
import { DemoLink } from "./contact";

const LOGO_COLOR = "/landing/domium/domium-horizontal-color.svg";
const LOGO_WHITE = "/landing/domium/domium-horizontal-blanco.svg";
const LINKS = [
  ["#beneficios", "Beneficios"],
  ["#dashboard", "Dashboard"],
  ["#precios", "Precios"],
] as const;

function useScrolled(px = 24) {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > px);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [px]);
  return s;
}

// Sección visible, para marcar el enlace activo.
function useActiveSection() {
  const [id, setId] = useState("");
  useEffect(() => {
    const els = LINKS.map(([h]) => document.querySelector(h)).filter(Boolean) as Element[];
    const o = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setId("#" + e.target.id); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    els.forEach((el) => o.observe(el));
    return () => o.disconnect();
  }, []);
  return id;
}

/** Franja de anuncio sobre el menú. */
function Announce() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="tn-announce" id="tn-announce">
      <span>Conecta Mercado Libre, Falabella, Paris, Ripley y Walmart a una sola bodega.</span>
      <DemoLink kind="schedule" fallback="#cierre">Agenda una demo →</DemoLink>
      <button type="button" aria-label="Cerrar aviso" onClick={() => { setOpen(false); window.dispatchEvent(new Event("tn-announce")); }}>×</button>
    </div>
  );
}

// Menú fijo: queda bajo la franja y suben al tope cuando la franja sale o se cierra.
function useTopOffset() {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const on = () => {
      const el = document.getElementById("tn-announce");
      setTop(el ? Math.max(0, el.offsetHeight - window.scrollY) : 0);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    window.addEventListener("tn-announce", on);
    const id = window.setTimeout(on, 300);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); window.removeEventListener("tn-announce", on); window.clearTimeout(id); };
  }, []);
  return top;
}

function Burger({ open, onClick, light }: { open: boolean; onClick: () => void; light?: boolean }) {
  return (
    <button type="button" className={`tn-burger ${light ? "tn-burger--light" : ""}`} aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} onClick={onClick}>
      <span /><span /><span />
    </button>
  );
}

function MobilePanel({ open, close }: { open: boolean; close: () => void }) {
  return (
    <div className={`tn-mobile ${open ? "is-open" : ""}`}>
      {LINKS.map(([h, t]) => <a key={h} href={h} onClick={close}>{t}</a>)}
      <DemoLink onClick={close}>Solicita tu Demo</DemoLink>
      <Link href="/login" className="tn-cta" onClick={close}>Entrar al panel</Link>
    </div>
  );
}

/** D · Transparente sobre el hero, sólida al bajar, con la sección activa marcada. */
function NavD() {
  const scrolled = useScrolled(60);
  const top = useTopOffset();
  const active = useActiveSection();
  const [open, setOpen] = useState(false);
  return (
    <header className={`tn tn-d ${scrolled ? "is-scrolled" : ""}`} style={{ top: `calc(env(safe-area-inset-top, 0px) + ${top}px)` }}>
      <nav className="tn-in" aria-label="Principal">
        <a href="#inicio" className="tn-logo"><img src={scrolled ? LOGO_COLOR : LOGO_WHITE} alt="Domium" /></a>
        <div className="tn-links">
          {LINKS.map(([h, t]) => <a key={h} href={h} className={active === h ? "is-active" : ""}>{t}</a>)}
        </div>
        <div className="tn-actions">
          <DemoLink className="tn-ghost">Solicita tu Demo</DemoLink>
          <Link href="/login" className="tn-btn">Entrar al panel</Link>
          <Burger open={open} onClick={() => setOpen(!open)} light={!scrolled} />
        </div>
      </nav>
      <MobilePanel open={open} close={() => setOpen(false)} />
    </header>
  );
}

export function TopNav() {
  return <><Announce /><NavD /></>;
}
