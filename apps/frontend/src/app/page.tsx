import type { ReactNode } from "react";
import Link from "next/link";
import { Anton, Inter } from "next/font/google";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { ModulesExplorer } from "@/components/landing/interactive";

// Tipografías propias de la landing (estilo editorial): condensada para titulares
// y grotesca neutra para el texto. El panel sigue con Hanken Grotesk.
const display = Anton({ variable: "--font-lp-display", subsets: ["latin"], weight: "400", display: "swap" });
const sans = Inter({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap" });

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
    <div className="rounded-[32px] bg-[var(--surface)] p-6 text-[var(--text)]">
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

const WRAP = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";

export default async function Home() {
  const logoMap = await getPlatformLogoMap();
  return (
    <div className={`lp ${display.variable} ${sans.variable} min-h-[100dvh] w-full max-w-full overflow-x-hidden`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
        Saltar al contenido
      </a>

      {/* Barra superior: logo, píldora de navegación y acceso */}
      <header>
        <nav className={`${WRAP} flex h-24 items-center justify-between gap-4 sm:h-32`} aria-label="Principal">
          <Link href="/" className="flex items-center gap-2 text-[1rem] font-medium tracking-[-0.02em]">
            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-black text-[0.85rem] font-semibold text-white">M</span>
            <span className="hidden sm:inline">Admin Marketplace</span>
          </Link>
          <div className="hidden items-center gap-6 rounded-[48px] bg-white px-7 py-3.5 text-[15px] font-medium text-[#444] md:flex">
            <a href="#dia-a-dia" className="transition-colors hover:text-black">Día a día</a>
            <a href="#canales" className="transition-colors hover:text-black">Canales</a>
            <a href="#modulos" className="transition-colors hover:text-black">Módulos</a>
          </div>
          <Link href="/login" className="lp-btn lp-btn--dark !px-5 !py-3.5 text-[15px]">
            Iniciar sesión
          </Link>
        </nav>
      </header>

      <main id="contenido">
        {/* Hero */}
        <section className={`${WRAP} grid gap-12 pb-20 pt-6 sm:pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-16`}>
          <div>
            <span className="lp-tag lp-mono ui-enter">
              <span className="h-1.5 w-1.5 rounded-full bg-black" />
              Mercado Libre · Falabella · Paris · Ripley · Walmart
            </span>
            <h1 className="lp-display ui-enter mt-6 text-[clamp(3rem,10.5vw,130px)]" style={{ ["--d" as string]: "80ms" }}>
              Un solo stock para todos tus canales
            </h1>
            <p className="ui-enter mt-8 max-w-[34rem] text-pretty text-[18px] leading-[1.33] text-[#444]" style={{ ["--d" as string]: "160ms" }}>
              Vendes en uno y se descuenta en todos. Los pedidos del día llegan juntos,
              ordenados por hora de corte, y la boleta sale en el mismo paso.
            </p>
            <div className="ui-enter mt-9 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "240ms" }}>
              <Link href="/login" className="lp-btn lp-btn--dark">
                Entrar al panel
                <Icon d={ICONS.arrow} size={18} />
              </Link>
              <a href="#modulos" className="lp-btn lp-btn--ghost">Ver cómo se ve por dentro</a>
            </div>
          </div>

          <div className="ui-enter-panel relative hidden lg:block" style={{ ["--d" as string]: "260ms" }} aria-hidden="true">
            <ShipMock />
            <div className="absolute -bottom-10 -left-10 w-64 rotate-[-2.5deg] rounded-[24px] bg-[#d1ffca] p-5">
              <p className="lp-mono text-black/60">Venta Falabella #88213</p>
              <p className="mt-1 text-[16px] font-medium leading-tight">Stock actualizado en 4 canales</p>
            </div>
          </div>
        </section>

        {/* Logos sobre bloque negro con borde superior en arco */}
        <section className="rounded-t-[32px] bg-black text-white sm:rounded-t-[64px]">
          <div className={`${WRAP} py-12`}>
            <p className="lp-mono mb-6 text-[#979797]">Marketplaces y tiendas que puedes conectar</p>
            <div className="rounded-[24px] bg-[#f3f3f3] px-2 py-3">
              <LogosMarquee logoMap={logoMap} />
            </div>
          </div>
        </section>

        {/* Antes / ahora */}
        <section id="dia-a-dia" className="bg-black pb-20">
          <div className={WRAP}>
            <div className="rounded-[32px] bg-white p-6 sm:rounded-[64px] sm:p-14">
              <span className="lp-tag lp-mono">01 · Día a día</span>
              <h2 className="lp-display ui-reveal mt-6 max-w-3xl text-[clamp(3rem,7vw,80px)]">
                Lo que deja de pasarte
              </h2>
              <div className="lp-mono mt-12 hidden grid-cols-[3rem_1fr_1fr] gap-8 pb-3 text-[#979797] md:grid">
                <span />
                <p>Hoy</p>
                <p className="text-black">Con el panel</p>
              </div>
              <ol className="divide-y divide-[#e5e5e5] border-y border-[#e5e5e5]">
                {BEFORE_AFTER.map(([before, after], i) => (
                  <li key={i} className="ui-reveal grid gap-3 py-6 md:grid-cols-[3rem_1fr_1fr] md:gap-8">
                    <span className="lp-mono text-[#979797]">{String(i + 1).padStart(2, "0")}</span>
                    <p className="text-[16px] leading-[1.4] text-[#979797]">
                      <span className="lp-mono mr-2 md:hidden">Hoy:</span>
                      {before}
                    </p>
                    <p className="text-[16px] font-medium leading-[1.4] text-black">
                      <span className="lp-mono mr-2 rounded-full bg-[#d1ffca] px-2 py-0.5 md:hidden">Con el panel</span>
                      {after}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Canales — bento */}
        <section id="canales" className="py-20">
          <div className={WRAP}>
            <div className="ui-reveal flex flex-wrap items-end justify-between gap-6">
              <div>
                <span className="lp-tag lp-mono">02 · Canales</span>
                <h2 className="lp-display mt-6 max-w-3xl text-[clamp(3rem,7vw,80px)]">
                  Stock, precios y documentos al día
                </h2>
              </div>
              <p className="max-w-xs text-[16px] leading-[1.33] text-[#444]">
                Conectas cada cuenta una vez con su API. Lo demás corre solo.
              </p>
            </div>

            <div className="ui-reveal mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-4 [&>*]:h-full">
                <ChannelsMock />
              </div>
              <div className="md:col-span-2 [&>*]:h-full">
                <NetMock />
              </div>
              <div className="md:col-span-3 [&>*]:h-full">
                <StockSyncMock />
              </div>
              <div className="flex flex-col justify-end rounded-[32px] bg-black p-6 text-white md:col-span-3 sm:p-8">
                <p className="lp-heading text-[28px]">Un inventario para todas tus bodegas</p>
                <p className="mt-3 max-w-sm text-[16px] leading-[1.33] text-[#979797]">
                  Cada venta descuenta de la bodega correcta, sin planillas paralelas ni vender lo que ya no tienes.
                </p>
              </div>
            </div>

            <div className="ui-reveal mt-4 rounded-[32px] bg-white p-6 sm:p-8">
              <p className="lp-mono text-[#979797]">Proveedores de facturación electrónica</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-4">
                {billingChannels.map((k) => (
                  <LogoChip key={k} node={resolveLogoNode(logoMap, k, BillingLogos[k])} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Módulos */}
        <section id="modulos" className="pb-20">
          <div className={WRAP}>
            <div className="rounded-[32px] bg-white p-6 sm:rounded-[64px] sm:p-14">
              <div className="ui-reveal max-w-3xl">
                <span className="lp-tag lp-mono">03 · Módulos</span>
                <h2 className="lp-display mt-6 text-[clamp(3rem,7vw,80px)]">
                  Del pedido a la puerta del cliente
                </h2>
                <p className="mt-5 text-[16px] text-[#444]">
                  Estas son pantallas reales del panel, con datos de ejemplo.
                </p>
              </div>

              <ModulesExplorer />
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="rounded-t-[32px] bg-black text-white sm:rounded-t-[64px]">
          <div className={`${WRAP} flex flex-col gap-8 py-20 sm:flex-row sm:items-end sm:justify-between`}>
            <div>
              <h2 className="lp-display text-[clamp(3rem,8vw,80px)]">¿Ya tienes cuenta?</h2>
              <p className="mt-4 text-[16px] text-[#979797]">Entra con tu correo y sigue donde quedaste.</p>
            </div>
            <Link href="/login" className="lp-btn lp-btn--light shrink-0 self-start sm:self-auto">
              Iniciar sesión
              <Icon d={ICONS.arrow} size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="bg-black text-[#979797]">
        <div className={`${WRAP} lp-mono flex flex-wrap items-center justify-between gap-4 border-t border-white/10 py-8`}>
          <span>Creado por OnDataSolution</span>
          <div className="flex gap-5">
            <a href="#canales" className="transition-colors hover:text-white">Canales</a>
            <a href="#modulos" className="transition-colors hover:text-white">Módulos</a>
            <Link href="/login" className="transition-colors hover:text-white">Iniciar sesión</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
