// Capas decorativas de la landing Domium: orbes, flecha de la marca, foto del equipo y ola.
import type { CSSProperties } from "react";

const IMG = "/landing/domium/";

/** Flecha de la marca como forma decorativa. */
function Swoosh({ style, className = "", src = "domium-icono-blanco.svg" }: { style?: CSSProperties; className?: string; src?: string }) {
  return <img aria-hidden="true" alt="" src={IMG + src} className={`deco-swoosh ${className}`} style={style} />;
}

/** Portada: foto del equipo, franja diagonal verde, orbes y flecha gigante. */
export function HeroDeco() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="deco-hero-photo" style={{ backgroundImage: `url(${IMG}oficina-limpia.jpg)` }} />
      <div className="deco-diag" />
      <div className="deco-orb deco-orb--turq" />
      <div className="deco-orb deco-orb--lime" />
      <Swoosh className="deco-hero-swoosh" />
    </div>
  );
}

/** Fondo para secciones claras: puntos, flecha tenue y un orbe. */
export function LightDeco() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="deco-dots" />
      <Swoosh className="deco-light-swoosh" src="domium-icono-azul.svg" />
      <div className="deco-orb deco-orb--soft" />
    </div>
  );
}

/** Fondo para secciones oscuras: foto de equipo teñida y flecha. */
export function DarkDeco() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="deco-dark-photo" style={{ backgroundImage: `url(${IMG}equipo.jpg)` }} />
      <Swoosh className="deco-dark-swoosh" />
      <div className="deco-orb deco-orb--turq deco-orb--low" />
    </div>
  );
}

/** Ola que separa dos franjas. */
export function Wave({ fill }: { fill: string }) {
  return (
    <div aria-hidden="true" className="deco-wave">
      <svg viewBox="0 0 1440 70" preserveAspectRatio="none"><path d="M0 40 C 240 80 480 0 720 30 C 960 60 1200 10 1440 36 L1440 70 L0 70 Z" style={{ fill }} /></svg>
    </div>
  );
}
