"use client";

// Sección «Un panel para cada momento de tu día»: tres momentos en carrusel, con imágenes completas
// (fondo transparente, sin recortes) que avanzan solas.
import { useEffect, useState, type ReactNode } from "react";

const img = (k: string) => `/landing/domium/${k}.webp`;
const WRAP = "w-full px-4 sm:px-6 lg:px-12 2xl:px-20";
const MS = 6000;

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

const TABS = [
  { k: "laptop-panel", kind: "laptop", icon: "M3 5h18v11H3zM1 19h22", t: "En la oficina", h: "Todo tu negocio en una pantalla",
    p: "Ventas, ganancia neta y stock de Mercado Libre, Falabella, Paris, Ripley y Walmart en un solo panel.",
    pts: ["Ganancia real por venta", "Alertas de reclamos y preguntas", "Boleta emitida al vender"] },
  { k: "phone-app", kind: "phone", icon: "M7 2h10v20H7zM11 18h2", t: "En terreno", h: "Tu equipo trabaja desde el celular",
    p: "Repartidores, bodega y punto de venta usan el mismo panel desde el navegador, sin instalar nada.",
    pts: ["Rutas y entregas con foto", "Picking y packing paso a paso", "Cobro y boleta en el mostrador"] },
  { k: "laptop-equipo", kind: "laptop", icon: "M16 11a4 4 0 1 0-8 0M3 21a9 9 0 0 1 18 0", t: "Con tu equipo", h: "Cada persona ve lo que le toca",
    p: "Perfiles por rol: ventas, bodega, despacho o administración, con permisos por función.",
    pts: ["Perfiles y permisos por rol", "Registro de quién hizo qué", "Varios usuarios a la vez"] },
] as const;

// Avanza solo cada MS milisegundos; se detiene mientras el mouse está encima.
function useRotator() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => setI((x) => (x + 1) % TABS.length), MS);
    return () => window.clearTimeout(id);
  }, [paused, i]);
  return { i, setI, paused, hover: { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) } };
}

function Head() {
  return (
    <div className="gy-head">
      <p className="lp-eyebrow">Tu negocio, bajo control</p>
      <h2 className="lp-h2">Un panel para cada momento de tu día</h2>
    </div>
  );
}

/** Imágenes completas (sin recorte) que se cruzan con un fundido. */
function Stage({ i, className = "" }: { i: number; className?: string }) {
  return (
    <div className={`gy-stage ${className}`}>
      <div className="gy-glow" aria-hidden="true" />
      {TABS.map((t, n) => (
        <img key={t.k} src={img(t.k)} alt={t.h} className={`gy-img gy-img--${t.kind} ${n === i ? "is-on" : ""}`} />
      ))}
    </div>
  );
}

function Info({ i, children }: { i: number; children?: ReactNode }) {
  const t = TABS[i];
  return (
    <div className="gy-info" key={t.k}>
      <h3>{t.h}</h3>
      <ul>{t.pts.map((x) => <li key={x}><Check />{x}</li>)}</ul>
      {children}
    </div>
  );
}

/** D · Carrusel: imagen grande, flechas y puntos con nombre. */
function Carousel() {
  const r = useRotator();
  const go = (d: number) => r.setI((r.i + d + TABS.length) % TABS.length);
  return (
    <section className="gy gy-d" aria-label="Un panel para cada momento de tu día">
      <div className={WRAP} {...r.hover}>
        <Head />
        <div className="gy-d-body">
          <button type="button" className="gy-d-arrow gy-d-arrow--prev" aria-label="Anterior" onClick={() => go(-1)}>‹</button>
          <Stage i={r.i} className="gy-stage--wide" />
          <button type="button" className="gy-d-arrow gy-d-arrow--next" aria-label="Siguiente" onClick={() => go(1)}>›</button>
        </div>
        <div className="gy-d-dots" role="tablist" aria-label="Momentos del día">
          {TABS.map((t, n) => (
            <button key={t.k} type="button" role="tab" aria-selected={n === r.i} className={n === r.i ? "is-on" : ""} onClick={() => r.setI(n)}>
              <span className="gy-d-dot" aria-hidden="true">{n === r.i && !r.paused && <i key={r.i} />}</span>{t.t}
            </button>
          ))}
        </div>
        <div className="gy-d-caption"><Info i={r.i} /></div>
      </div>
    </section>
  );
}

export function Gallery() {
  return <Carousel />;
}
