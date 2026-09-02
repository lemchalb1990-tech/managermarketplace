import type { ReactNode } from "react";
import Link from "next/link";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { ModulesExplorer, HowItWorks } from "@/components/landing/interactive";
import { Spotlight, Tilt, Magnetic, CountUp, Words } from "@/components/landing/effects";

const salesChannels = [
  "mercadolibre", "falabella", "paris", "ripley", "hites", "walmart",
  "shopify", "woocommerce", "jumpseller",
] as const;
const billingChannels = ["openfactura", "facto", "bsale", "defontana", "nubox", "siigo"] as const;

const EASE = "cubic-bezier(0.32,0.72,0,1)";

/* ── Mocks visuales (mini-versiones reales del producto) ───────────────────── */

function ShipMock() {
  const rows = [
    { l: "Mercado Envíos · Colecta", n: 12, w: "78%", c: "var(--ok)" },
    { l: "Envío Falabella", n: 7, w: "48%", c: "var(--brand)" },
    { l: "Envío Ripley", n: 2, w: "22%", c: "var(--warn)" },
    { l: "Despacho propio", n: 10, w: "62%", c: "var(--info)" },
  ];
  return (
    <div className="rounded-[1.6rem] bg-white/5 p-2 ring-1 ring-white/10">
      <div className="rounded-[calc(1.6rem-0.5rem)] bg-[var(--surface)] p-5 text-[var(--text)] shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--text-2)]">Por despachar hoy</p>
          <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--brand-ink)]">31</span>
        </div>
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.l} className="flex items-center gap-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2">
              <span className="flex-1 truncate text-[0.78rem]">{r.l}</span>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border-soft)]">
                <span className="block h-full rounded-full" style={{ width: r.w, background: r.c }} />
              </span>
              <span className="w-5 text-right font-mono text-[0.72rem] text-[var(--text-2)]">{r.n}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[["56%", "Picking"], ["40%", "Packing"], ["28", "Empacados"]].map(([v, k]) => (
            <div key={k} className="rounded-lg bg-[var(--surface-soft)] px-2.5 py-2">
              <p className="text-[0.95rem] font-bold tracking-tight">{v}</p>
              <p className="text-[0.62rem] text-[var(--text-muted)]">{k}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelsMock() {
  const rows = [
    { name: "Mercado Libre", acc: "MI TIENDA.CL", prod: 237, ok: true },
    { name: "Falabella", acc: "Seller Center", prod: 184, ok: true },
    { name: "Paris", acc: "Cencosud", prod: 96, ok: true },
    { name: "Líder / Walmart", acc: "Marketplace", prod: 41, ok: false },
  ];
  return (
    <div className="ui-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3.5">
        <p className="text-sm font-semibold">Mis canales</p>
        <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
          Sincronizado 14:57
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-[var(--border-soft)]">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-5 py-3 font-medium">{r.name}</td>
              <td className="px-2 py-3 text-xs text-[var(--text-muted)]">{r.acc}</td>
              <td className="px-2 py-3 text-right font-mono text-xs text-[var(--text-2)]">{r.prod} prod.</td>
              <td className="px-5 py-3 text-right">
                <span className={`ui-badge ${r.ok ? "ui-badge--ok" : "ui-badge--warn"}`}>
                  {r.ok ? "Activo" : "Revisar"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockSyncMock() {
  return (
    <div className="ui-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--text-2)]">Polera oversize negra</p>
        <span className="ui-badge ui-badge--info">Venta ML #40213</span>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--surface-soft)] px-3 py-3">
        <span className="font-mono text-lg font-bold">32</span>
        <Icon d={ICONS.arrow} size={16} />
        <span className="font-mono text-lg font-bold text-[var(--brand-ink)]">31</span>
        <span className="ml-auto text-[0.66rem] text-[var(--text-muted)]">menos 1 en Bodega Centro</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Mercado Libre", "Falabella", "Paris", "Tienda web"].map((c) => (
          <span key={c} className="ui-badge ui-badge--ok">
            <Icon d={ICONS.check} size={11} /> {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function LogoChip({ node }: { node: ReactNode }) {
  return (
    <span className="group/logo flex h-16 w-[132px] shrink-0 items-center justify-center px-2 transition-transform duration-300 hover:-translate-y-0.5">
      <span className="h-11 w-[74px] opacity-80 grayscale-[0.35] transition duration-300 group-hover/logo:opacity-100 group-hover/logo:grayscale-0 [&>svg]:h-full [&>svg]:w-full [&>svg]:rounded-[9px]">
        {node}
      </span>
    </span>
  );
}

function LogosMarquee() {
  const loop = [...salesChannels, ...salesChannels];
  return (
    <div className="marquee-mask group overflow-hidden">
      <div className="flex w-max gap-7 py-1 animate-marquee group-hover:[animation-play-state:paused]">
        {loop.map((k, i) => (
          <LogoChip key={`${k}-${i}`} node={Logos[k]} />
        ))}
      </div>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────────────── */

export default function Home() {
  const year = new Date().getFullYear();
  return (
    <div className="ui-grain min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[var(--page-bg)] text-[var(--text)]">
      {/* Nav flotante */}
      <header className="ui-enter sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] py-2.5 pl-5 pr-2.5 shadow-[var(--shadow-sm)] backdrop-blur-xl">
          <div className="flex items-center gap-2.5 text-[0.9rem] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)] text-sm font-bold text-[#35301f]">M</span>
            Admin Marketplace
          </div>
          <Magnetic strength={0.25}>
            <Link href="/login" style={{ transitionTimingFunction: EASE }}
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--text)] py-1.5 pl-4 pr-1.5 text-sm font-medium text-[var(--page-bg)] transition-transform duration-300 active:scale-[0.98]">
              Entrar al panel
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 group-hover:translate-x-0.5">
                <Icon d={ICONS.arrow} size={16} />
              </span>
            </Link>
          </Magnetic>
        </div>
      </header>

      {/* Hero */}
      <Spotlight className="ui-dots overflow-hidden bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 pb-24 pt-20 sm:pb-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <span className="ui-enter ui-eyebrow bg-white/10 text-[var(--brand)]" style={{ ["--d" as string]: "80ms" }}>Operación omnicanal</span>
            <h1 className="font-serif mt-6 text-[2.6rem] leading-[1.06] sm:text-[3.3rem]">
              <Words text="Tus ventas y tu" />{" "}
              <em className="text-[var(--brand)]">bodega</em>,{" "}
              <Words text="en un solo panel." />
            </h1>
            <p className="ui-enter mt-6 max-w-md text-[1.05rem] leading-relaxed text-white/65" style={{ ["--d" as string]: "260ms" }}>
              Conecta tus marketplaces, sincroniza el stock y despacha a tiempo.
              La boleta se emite sin cambiar de sistema.
            </p>
            <div className="ui-enter mt-10 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "360ms" }}>
              <Magnetic>
                <Link href="/login" style={{ transitionTimingFunction: EASE }}
                  className="group inline-flex items-center gap-2 rounded-full bg-[var(--brand)] py-3 pl-6 pr-3 font-medium text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.98]">
                  Entrar al panel
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-[1px]">
                    <Icon d={ICONS.arrow} />
                  </span>
                </Link>
              </Magnetic>
              <a href="#modulos" className="rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/5">
                Ver los módulos
              </a>
            </div>
          </div>

          <div className="ui-enter-panel hidden lg:block" style={{ ["--d" as string]: "420ms" }} aria-hidden="true">
            <Tilt className="ui-halo">
              <ShipMock />
            </Tilt>
          </div>
        </div>
      </Spotlight>

      {/* Cifras */}
      <section className="border-b border-[var(--border)] bg-[var(--surface)] py-16">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 sm:grid-cols-3">
          {[
            { v: <CountUp to={9} />, l: "canales de venta conectados" },
            { v: <CountUp to={6} />, l: "proveedores de facturación" },
            { v: "En vivo", l: "el stock se ajusta con cada venta" },
          ].map((s, i) => (
            <div key={i} className="border-l-2 border-[var(--brand)] pl-4">
              <p className="font-serif text-[2.4rem] leading-none text-[var(--text)]">{s.v}</p>
              <p className="mt-2 text-[0.9rem] text-[var(--text-2)]">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Integraciones — bento */}
      <section className="border-b border-[var(--border)] bg-[var(--surface-soft)] py-28">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="ui-reveal font-serif max-w-2xl text-[1.9rem] leading-tight sm:text-[2.4rem]">
            Stock, precios y documentos, siempre al día
          </h2>

          <div className="ui-reveal mt-10 grid grid-cols-1 gap-4 md:grid-cols-6">
            {/* Canales conectados */}
            <div className="md:col-span-4 [&>*]:h-full">
              <ChannelsMock />
            </div>

            {/* Titular tintado */}
            <div className="relative flex flex-col justify-center overflow-hidden rounded-[1.6rem] bg-[var(--brand-soft)] p-7 md:col-span-2">
              <div className="ui-hatch absolute inset-x-0 bottom-0 h-16 opacity-40" aria-hidden="true" />
              <p className="relative text-[1.05rem] font-semibold leading-snug">
                Cada venta descuenta de la bodega correcta.
              </p>
              <p className="relative mt-2 text-[0.85rem] text-[var(--text-2)]">
                Y el stock vuelve a publicarse en el resto de los canales.
              </p>
            </div>

            {/* Detalle de sincronización */}
            <div className="md:col-span-4 [&>*]:h-full">
              <StockSyncMock />
            </div>

            {/* Sin sobreventa */}
            <div className="flex flex-col justify-center rounded-[1.6rem] border border-[var(--border)] bg-[var(--surface)] p-7 md:col-span-2">
              <p className="font-mono text-[0.7rem] tracking-wide text-[var(--brand-ink)]">SIN SOBREVENTA</p>
              <p className="mt-2.5 text-[0.88rem] leading-relaxed text-[var(--text-2)]">
                Un inventario para todas tus bodegas. Sin planillas paralelas ni
                vender lo que ya no tienes.
              </p>
            </div>
          </div>

          <div className="ui-reveal mt-14 space-y-6">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Funciona con lo que ya usas</p>
            <LogosMarquee />
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4 pt-2">
              {billingChannels.map((k) => (
                <LogoChip key={k} node={BillingLogos[k]} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Módulos */}
      <section id="modulos" className="py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="ui-reveal max-w-2xl">
            <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Módulos</span>
            <h2 className="font-serif mt-4 text-[1.9rem] leading-tight sm:text-[2.4rem]">
              Un módulo para cada parte de la operación
            </h2>
            <p className="mt-3 text-[0.95rem] text-[var(--text-2)]">
              Abre cada módulo para ver cómo se ve por dentro.
            </p>
          </div>

          <ModulesExplorer />
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="border-y border-[var(--border)] bg-[var(--surface-soft)] py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="ui-reveal max-w-2xl">
            <h2 className="font-serif text-[1.9rem] leading-tight sm:text-[2.4rem]">
              De conectar los canales a emitir la boleta
            </h2>
          </div>

          <HowItWorks />
        </div>
      </section>

      {/* CTA */}
      <Spotlight className="ui-dots bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-24 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-serif max-w-md text-[1.9rem] leading-tight">
            Empieza a operar desde un solo panel
          </h2>
          <Magnetic>
            <Link href="/login" style={{ transitionTimingFunction: EASE }}
              className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--brand)] py-3 pl-6 pr-3 font-medium text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.98]">
              Entrar al panel
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1">
                <Icon d={ICONS.arrow} />
              </span>
            </Link>
          </Magnetic>
        </div>
      </Spotlight>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-12">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)] text-xs font-bold text-[#35301f]">M</span>
              Admin Marketplace
            </div>
            <p className="mt-3 text-xs text-[var(--text-muted)]">Operación omnicanal para vendedores.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Producto</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-2)]">
              <li><a href="#modulos" className="hover:text-[var(--brand-ink)]">Módulos</a></li>
              <li><a href="#modulos" className="hover:text-[var(--brand-ink)]">Canales</a></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Acceso</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-2)]">
              <li><Link href="/login" className="hover:text-[var(--brand-ink)]">Entrar al panel</Link></li>
            </ul>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl px-6 text-xs text-[var(--text-muted)]">© {year} Admin Marketplace</p>
      </footer>
    </div>
  );
}
