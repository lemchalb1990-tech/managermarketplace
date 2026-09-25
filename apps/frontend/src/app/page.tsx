import type { ReactNode } from "react";
import Link from "next/link";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { ModulesExplorer } from "@/components/landing/interactive";

const salesChannels = [
  "mercadolibre", "falabella", "paris", "ripley", "hites", "walmart",
  "shopify", "woocommerce", "jumpseller",
] as const;
const billingChannels = ["openfactura", "facto", "bsale", "defontana", "nubox", "siigo"] as const;

/* ── Mocks visuales (mini-versiones reales del producto) ───────────────────── */

function ShipMock() {
  const rows = [
    { l: "Mercado Envíos · Colecta", n: 12, cut: "corte 16:00", w: "78%", c: "var(--ok)" },
    { l: "Envío Falabella", n: 7, cut: "2 atrasados", bad: true, w: "48%", c: "var(--brand)" },
    { l: "Envío Ripley", n: 2, cut: "corte 18:00", w: "22%", c: "var(--warn)" },
    { l: "Despacho propio", n: 10, cut: "sin corte", w: "62%", c: "var(--info)" },
  ];
  return (
    <div className="rounded-2xl bg-[var(--surface)] p-5 text-[var(--text)] shadow-[0_24px_60px_-12px_rgba(20,16,6,0.55)]">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">Por despachar hoy</p>
        <p className="font-mono text-xs text-[var(--text-muted)]">jue 25 sep · 31 pedidos</p>
      </div>
      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <div key={r.l} className="rounded-lg bg-[var(--surface-soft)] px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="flex-1 truncate text-[0.8rem]">{r.l}</span>
              <span className={`text-[0.66rem] ${r.bad ? "font-semibold text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{r.cut}</span>
              <span className="w-5 text-right font-mono text-[0.75rem] text-[var(--text-2)]">{r.n}</span>
            </div>
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[var(--border-soft)]">
              <span className="block h-full rounded-full" style={{ width: r.w, background: r.c }} />
            </span>
          </div>
        ))}
      </div>
      <button type="button" tabIndex={-1} className="ui-btn-brand mt-4 w-full text-xs">Imprimir 21 etiquetas</button>
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

// Desglose real de una venta importada (mismo formato que el modal de importación).
function NetMock() {
  const rows: Array<[string, string, boolean?]> = [
    ["Precio sin IVA", "$43.689"],
    ["Envío a cargo tuyo", "−$2.517", true],
    ["Comisión (12%)", "−$6.239", true],
    ["Costo del producto", "−$10.000", true],
  ];
  return (
    <div className="ui-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--text-2)]">Mesa de bar Circle · Walmart</p>
        <span className="font-mono text-[0.66rem] text-[var(--text-muted)]">PO 2777001234</span>
      </div>
      <div className="mt-3 space-y-1 text-[0.8rem]">
        {rows.map(([k, v, neg]) => (
          <div key={k} className="flex justify-between">
            <span className="text-[var(--text-2)]">{k}</span>
            <span className={`font-mono ${neg ? "text-[var(--danger)]" : ""}`}>{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-[var(--border-soft)] pt-2 text-[0.9rem] font-semibold">
        <span>Ganancia</span>
        <span className="font-mono text-[var(--ok)]">$24.933</span>
      </div>
    </div>
  );
}

function LogoChip({ node }: { node: ReactNode }) {
  return (
    <span className="group/logo flex h-16 w-[132px] shrink-0 items-center justify-center px-2">
      <span className="h-11 w-[74px] opacity-75 grayscale-[0.5] transition duration-300 group-hover/logo:opacity-100 group-hover/logo:grayscale-0 [&>svg]:h-full [&>svg]:w-full [&>svg]:rounded-[9px]">
        {node}
      </span>
    </span>
  );
}

type LogoMap = Record<string, { logoUrl: string | null } | undefined>;

function resolveLogoNode(map: LogoMap, key: string, fallback: ReactNode): ReactNode {
  const url = map[key]?.logoUrl;
  return url ? <img src={url} alt={key} className="h-full w-full object-contain" /> : fallback;
}

function LogosMarquee({ logoMap }: { logoMap: LogoMap }) {
  const loop = [...salesChannels, ...salesChannels];
  return (
    <div className="marquee-mask group overflow-hidden">
      <div className="flex w-max gap-7 py-1 animate-marquee group-hover:[animation-play-state:paused]">
        {loop.map((k, i) => (
          <LogoChip key={`${k}-${i}`} node={resolveLogoNode(logoMap, k, Logos[k])} />
        ))}
      </div>
    </div>
  );
}

// Se pide en el servidor (no requiere sesión): así el logo personalizado de cada
// plataforma se ve también en la landing pública, antes de iniciar sesión.
async function getPlatformLogoMap(): Promise<LogoMap> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${base}/api/public/platform-logos`, { next: { revalidate: 300 } });
    if (!res.ok) return {};
    const rows = await res.json() as Array<{ platform: string; logoUrl: string | null }>;
    const map: LogoMap = {};
    rows.forEach((r) => { map[r.platform] = r; });
    return map;
  } catch {
    return {};
  }
}

/* ── Contenido ─────────────────────────────────────────────────────────────── */

const BEFORE_AFTER: Array<[string, string]> = [
  [
    "Vendes en Falabella y corres a bajar el stock en Mercado Libre, Paris y Ripley antes de que alguien compre lo que ya no tienes.",
    "La venta descuenta de la bodega que corresponde y el stock nuevo se publica solo en el resto de los canales.",
  ],
  [
    "Los pedidos del día están repartidos en cuatro Seller Center y te enteras del atrasado cuando llega el reclamo.",
    "Todos los pedidos en una lista, agrupados por transportista y ordenados por hora de corte. Los atrasados salen en rojo.",
  ],
  [
    "Copias los datos de cada venta a otro sistema para emitir la boleta.",
    "La boleta o factura sale en el mismo paso, con tu proveedor: OpenFactura, Facto, Bsale, Nubox y otros.",
  ],
  [
    "El marketplace te muestra el total, pero no sabes cuánto te quedó después de comisión, envío e IVA.",
    "Cada venta importada trae el neto sin IVA y la ganancia contra el costo del producto.",
  ],
];

/* ── Página ───────────────────────────────────────────────────────────────── */

export default async function Home() {
  const year = new Date().getFullYear();
  const logoMap = await getPlatformLogoMap();
  return (
    <div className="ui-grain min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[var(--page-bg)] text-[var(--text)]">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--surface)] focus:px-3 focus:py-2 focus:text-sm">
        Saltar al contenido
      </a>

      {/* Barra superior */}
      <header className="border-b border-white/10 bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6" aria-label="Principal">
          <Link href="/" className="flex items-center gap-2 text-[0.95rem] font-bold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-[var(--brand)] text-[0.8rem] font-extrabold text-[#35301f]">M</span>
            Admin Marketplace
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <a href="#canales" className="hidden text-white/65 transition-colors hover:text-white sm:inline">Canales</a>
            <a href="#modulos" className="hidden text-white/65 transition-colors hover:text-white sm:inline">Módulos</a>
            <Link href="/login" className="rounded-md bg-white/10 px-3 py-1.5 font-medium transition-colors hover:bg-white/15 active:translate-y-px">
              Iniciar sesión
            </Link>
          </div>
        </nav>
      </header>

      <main id="contenido">
        {/* Hero */}
        <section className="ui-dots overflow-hidden bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
          <div className="mx-auto grid max-w-6xl gap-14 px-6 pb-24 pt-16 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pb-28">
            <div>
              <h1 className="ui-enter text-balance text-[2.5rem] font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-[3.4rem]">
                Un solo stock para Mercado Libre, Falabella, Paris, Ripley y Walmart.
              </h1>
              <p className="ui-enter mt-6 max-w-[34rem] text-pretty text-[1.08rem] leading-relaxed text-white/65" style={{ ["--d" as string]: "120ms" }}>
                Vendes en uno y se descuenta en todos. Los pedidos del día llegan juntos,
                ordenados por hora de corte, y la boleta sale en el mismo paso.
              </p>
              <div className="ui-enter mt-9 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ ["--d" as string]: "220ms" }}>
                <Link href="/login"
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-5 py-3 font-semibold text-[#35301f] transition-[background-color,transform] duration-200 hover:bg-[var(--brand-dark)] active:translate-y-px">
                  Entrar al panel
                  <Icon d={ICONS.arrow} size={18} />
                </Link>
                <a href="#modulos" className="text-sm font-medium text-white/70 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60">
                  Ver cómo se ve por dentro
                </a>
              </div>
              <p className="ui-enter mt-12 text-[0.8rem] text-white/45" style={{ ["--d" as string]: "300ms" }}>
                Hecho en Chile para vendedores con bodega propia · boleta y factura electrónica SII
              </p>
            </div>

            <div className="ui-enter-panel relative hidden lg:block" style={{ ["--d" as string]: "260ms" }} aria-hidden="true">
              <ShipMock />
              <div className="absolute -bottom-16 -left-10 w-60 rotate-[-2.5deg]">
                <div className="rounded-xl bg-[var(--surface)] p-3.5 text-[var(--text)] shadow-[0_18px_40px_-10px_rgba(20,16,6,0.5)]">
                  <p className="text-[0.66rem] text-[var(--text-muted)]">Venta Falabella #88213</p>
                  <p className="mt-1 text-[0.8rem] font-semibold">Stock actualizado en 4 canales</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Antes / ahora */}
        <section className="border-b border-[var(--border)] bg-[var(--surface)] py-24">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="ui-reveal max-w-2xl text-[1.9rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[2.3rem]">
              Lo que deja de pasarte en el día a día
            </h2>
            <div className="mt-12 hidden grid-cols-2 gap-10 pb-3 text-[0.78rem] font-semibold text-[var(--text-muted)] md:grid">
              <p>Hoy</p>
              <p className="text-[var(--brand-ink)]">Con el panel</p>
            </div>
            <ol className="divide-y divide-[var(--border-soft)] border-y border-[var(--border-soft)]">
              {BEFORE_AFTER.map(([before, after], i) => (
                <li key={i} className="ui-reveal grid gap-3 py-6 md:grid-cols-2 md:gap-10">
                  <p className="text-[0.95rem] leading-relaxed text-[var(--text-muted)]">
                    <span className="mr-2 font-semibold text-[var(--text-muted)] md:hidden">Hoy:</span>
                    {before}
                  </p>
                  <p className="text-[0.95rem] leading-relaxed text-[var(--text)]">
                    <span className="mr-2 font-semibold text-[var(--brand-ink)] md:hidden">Con el panel:</span>
                    {after}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Canales — bento */}
        <section id="canales" className="border-b border-[var(--border)] bg-[var(--surface-soft)] py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="ui-reveal flex flex-wrap items-end justify-between gap-4">
              <h2 className="max-w-xl text-balance text-[1.9rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[2.3rem]">
                Stock, precios y documentos al día en cada canal
              </h2>
              <p className="max-w-xs text-[0.9rem] text-[var(--text-2)]">
                Conectas cada cuenta una vez con su API. Lo demás corre solo.
              </p>
            </div>

            <div className="ui-reveal mt-10 grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-4 [&>*]:h-full">
                <ChannelsMock />
              </div>
              <div className="md:col-span-2 [&>*]:h-full">
                <NetMock />
              </div>
              <div className="md:col-span-3 [&>*]:h-full">
                <StockSyncMock />
              </div>
              <div className="flex flex-col justify-end rounded-2xl bg-[var(--brand-soft)] p-6 md:col-span-3">
                <p className="text-[1.05rem] font-semibold leading-snug">
                  Un inventario para todas tus bodegas.
                </p>
                <p className="mt-1.5 max-w-sm text-[0.88rem] leading-relaxed text-[var(--text-2)]">
                  Cada venta descuenta de la bodega correcta, sin planillas paralelas ni vender lo que ya no tienes.
                </p>
              </div>
            </div>

            <div className="ui-reveal mt-16 space-y-5">
              <p className="text-[0.85rem] font-medium text-[var(--text-2)]">Marketplaces y tiendas que puedes conectar</p>
              <LogosMarquee logoMap={logoMap} />
              <p className="pt-4 text-[0.85rem] font-medium text-[var(--text-2)]">Proveedores de facturación electrónica</p>
              <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
                {billingChannels.map((k) => (
                  <LogoChip key={k} node={resolveLogoNode(logoMap, k, BillingLogos[k])} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Módulos */}
        <section id="modulos" className="py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="ui-reveal max-w-xl">
              <h2 className="text-balance text-[1.9rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[2.3rem]">
                Desde que entra el pedido hasta que llega al cliente
              </h2>
              <p className="mt-3 text-[0.95rem] text-[var(--text-2)]">
                Estas son pantallas reales del panel, con datos de ejemplo.
              </p>
            </div>

            <ModulesExplorer />
          </div>
        </section>

        {/* Cierre */}
        <section className="border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-20 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-[1.6rem] font-extrabold leading-tight tracking-[-0.03em]">¿Ya tienes cuenta?</h2>
              <p className="mt-2 text-[0.95rem] text-[var(--text-2)]">Entra con tu correo y sigue donde quedaste.</p>
            </div>
            <Link href="/login"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--text)] px-5 py-3 font-semibold text-[var(--page-bg)] transition-transform duration-200 active:translate-y-px">
              Iniciar sesión
              <Icon d={ICONS.arrow} size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-[var(--text-muted)]">
          <span>© {year} Admin Marketplace</span>
          <div className="flex gap-5">
            <a href="#canales" className="hover:text-[var(--text)]">Canales</a>
            <a href="#modulos" className="hover:text-[var(--text)]">Módulos</a>
            <Link href="/login" className="hover:text-[var(--text)]">Iniciar sesión</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
