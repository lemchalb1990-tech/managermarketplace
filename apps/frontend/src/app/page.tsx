import type { ReactNode } from "react";
import Link from "next/link";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { ModulesExplorer, HowItWorks } from "@/components/landing/interactive";

const salesChannels = [
  "mercadolibre", "falabella", "paris", "ripley", "hites", "walmart",
  "shopify", "woocommerce", "jumpseller",
] as const;
const billingChannels = ["openfactura", "facto", "bsale", "defontana", "nubox", "siigo"] as const;

const EASE = "cubic-bezier(0.32,0.72,0,1)";

/* ── Mocks visuales (representan el producto real) ─────────────────────────── */

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
            <div key={k} className="rounded-lg border border-[var(--border-soft)] px-2.5 py-2">
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
        <span className="text-xs text-[var(--text-muted)]">Sincronizado 14:57</span>
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

function LogoChip({ node }: { node: ReactNode }) {
  return (
    <span className="flex h-12 w-[88px] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
      <span className="h-8 w-[52px] [&>svg]:h-full [&>svg]:w-full">{node}</span>
    </span>
  );
}

function LogosCarousel({
  items,
  reverse = false,
}: {
  items: readonly string[];
  reverse?: boolean;
}) {
  const map = reverse ? BillingLogos : Logos;
  const loop = [...items, ...items];
  return (
    <div className="marquee-mask group overflow-hidden">
      <div
        className={`flex w-max gap-3 py-1 ${reverse ? "animate-marquee-reverse" : "animate-marquee"} group-hover:[animation-play-state:paused]`}
      >
        {loop.map((k, i) => (
          <LogoChip key={`${k}-${i}`} node={map[k]} />
        ))}
      </div>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────────────── */

export default function Home() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-[100dvh] bg-[var(--page-bg)] text-[var(--text)]">
      {/* Nav */}
      <header className="ui-enter border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5 text-[0.95rem] font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] font-bold text-[#35301f]">M</span>
            Admin Marketplace
          </div>
          <Link href="/login" style={{ transitionTimingFunction: EASE }}
            className="group inline-flex items-center gap-2 rounded-full bg-[var(--text)] py-2 pl-4 pr-2 text-sm font-medium text-[var(--page-bg)] transition-transform duration-300 active:scale-[0.98]">
            Entrar
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 group-hover:translate-x-0.5">
              <Icon d={ICONS.arrow} size={16} />
            </span>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="ui-dots overflow-hidden bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-24 sm:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <span className="ui-enter ui-eyebrow bg-white/10 text-[var(--brand)]" style={{ ["--d" as string]: "80ms" }}>Operación omnicanal</span>
            <h1 className="ui-enter font-serif mt-6 text-[2.5rem] leading-[1.08] tracking-[-0.02em] sm:text-[3.3rem]" style={{ ["--d" as string]: "160ms" }}>
              Todas tus ventas y toda tu bodega en un solo lugar.
            </h1>
            <p className="ui-enter mt-6 max-w-xl text-[1.05rem] leading-relaxed text-white/65" style={{ ["--d" as string]: "260ms" }}>
              Conecta Mercado Libre, Falabella, Paris y más. Sincroniza stock, prepara los
              pedidos con escáner, despacha a tiempo y emite tus boletas — sin saltar entre
              sistemas.
            </p>
            <div className="ui-enter mt-10 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "360ms" }}>
              <Link href="/login" style={{ transitionTimingFunction: EASE }}
                className="group inline-flex items-center gap-2 rounded-full bg-[var(--brand)] py-3 pl-6 pr-3 font-medium text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.98]">
                Entrar al panel
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-[1px]">
                  <Icon d={ICONS.arrow} />
                </span>
              </Link>
              <a href="#modulos" className="rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/5">
                Ver los módulos
              </a>
            </div>
            <p className="ui-enter mt-12 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/35" style={{ ["--d" as string]: "460ms" }}>
              9 canales de venta · 6 proveedores de facturación · stock en tiempo real
            </p>
          </div>

          <div className="ui-enter-panel hidden lg:block" style={{ ["--d" as string]: "420ms" }} aria-hidden="true">
            <ShipMock />
          </div>
        </div>
      </section>

      {/* Integraciones */}
      <section className="border-b border-[var(--border)] bg-[var(--surface)] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="ui-reveal">
              <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Integraciones</span>
              <h2 className="font-serif mt-4 text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
                Se conecta con lo que ya usas
              </h2>
              <p className="mt-3 max-w-md text-[0.95rem] text-[var(--text-2)]">
                Stock, precios, órdenes y documentos tributarios se mantienen al día entre tu
                catálogo y cada canal. Ves el estado de cada conexión de un vistazo.
              </p>
            </div>
            <div className="ui-reveal">
              <ChannelsMock />
            </div>
          </div>

          <div className="ui-reveal mt-14 space-y-5">
            <div>
              <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Canales de venta</p>
              <LogosCarousel items={salesChannels} />
            </div>
            <div>
              <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Facturación electrónica</p>
              <LogosCarousel items={billingChannels} reverse />
            </div>
          </div>
        </div>
      </section>

      {/* Módulos */}
      <section id="modulos" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="ui-reveal max-w-2xl">
            <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Módulos</span>
            <h2 className="font-serif mt-4 text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
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
      <section className="border-y border-[var(--border)] bg-[var(--surface-soft)] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="ui-reveal max-w-2xl">
            <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Cómo funciona</span>
            <h2 className="font-serif mt-4 text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
              De conectar los canales a emitir la boleta
            </h2>
          </div>

          <HowItWorks />
        </div>
      </section>

      {/* CTA */}
      <section className="ui-dots bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-serif max-w-md text-[1.8rem] leading-tight tracking-[-0.02em]">
            Empieza a operar desde un solo panel
          </h2>
          <Link href="/login" style={{ transitionTimingFunction: EASE }}
            className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--brand)] py-3 pl-6 pr-3 font-medium text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.98]">
            Iniciar sesión
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1">
              <Icon d={ICONS.arrow} />
            </span>
          </Link>
        </div>
      </section>

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
              <li><Link href="/login" className="hover:text-[var(--brand-ink)]">Iniciar sesión</Link></li>
            </ul>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl px-6 text-xs text-[var(--text-muted)]">© {year} Admin Marketplace</p>
      </footer>
    </div>
  );
}
