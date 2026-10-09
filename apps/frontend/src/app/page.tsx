import type { ReactNode } from "react";
import Link from "next/link";
import { Inter, Source_Serif_4 } from "next/font/google";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { ModulesExplorer } from "@/components/landing/interactive";

// Tipografías propias de la landing: sans neutra para todo y una serif editorial
// para las bajadas de sección. El panel sigue con Hanken Grotesk.
const sans = Inter({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap" });
const serif = Source_Serif_4({ variable: "--font-lp-serif", subsets: ["latin"], weight: "400", display: "swap" });

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
    <div className="rounded-[12px] bg-[var(--surface)] p-5 text-[var(--text)]">
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

/* ── Versión móvil ────────────────────────────────────────────────────────── */

// Teléfono dibujado con CSS: la ruta del repartidor tal como se ve en "Mis rutas".
function PhoneMock() {
  const stops = [
    { a: "Av. Providencia 1208", c: "Entregado", ok: true },
    { a: "Los Leones 455, depto 1102", c: "Entregado", ok: true },
    { a: "Manuel Montt 2310", c: "En camino" },
    { a: "Eliodoro Yáñez 1890", c: "Pendiente" },
  ];
  return (
    <div className="lp-shot mx-auto w-[260px] rounded-[40px] bg-[#111] p-2.5">
      <div className="overflow-hidden rounded-[32px] bg-[#f6f5f4]">
        <div className="flex items-center justify-between px-6 pb-2 pt-3 text-[11px] font-semibold">
          <span>9:41</span>
          <span className="h-4 w-16 rounded-full bg-[#111]" />
          <span>5G</span>
        </div>
        <div className="px-4 pb-5">
          <p className="text-[11px] text-[#757575]">Ruta de hoy · 8 paradas</p>
          <p className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em]">Hola, Andrea</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white p-3 text-[11px]" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/5">
              <span className="block h-full w-1/2 rounded-full bg-[#0075de]" />
            </span>
            <span className="font-mono text-[#615d59]">4 / 8</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {stops.map((s) => (
              <div key={s.a} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-[11px]" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.ok ? "bg-[#15803d]" : s.c === "En camino" ? "bg-[#ffb110]" : "bg-black/15"}`} />
                <span className="flex-1 truncate">{s.a}</span>
                <span className="text-[#757575]">{s.c}</span>
              </div>
            ))}
          </div>
          <span className="mt-3 block rounded-lg bg-[#0075de] py-2.5 text-center text-[12px] font-medium text-white">
            Marcar entregado y foto
          </span>
        </div>
      </div>
    </div>
  );
}

const MOBILE_POINTS = [
  ["Repartidores", "Ven su ruta del día, marcan cada entrega y suben la foto de respaldo."],
  ["Bodega", "Picking y packing desde el teléfono: cada pedido con sus productos y su avance."],
  ["Punto de venta", "Cobras y emites la boleta desde el celular o la tablet del mostrador."],
  ["Tú", "Revisas ventas, stock y reclamos de Mercado Libre desde donde estés."],
] as const;

/* ── Beneficios ───────────────────────────────────────────────────────────── */

const BENEFITS = [
  { t: "Nunca vendes lo que no tienes", b: "Cada venta descuenta de la bodega correcta y el stock nuevo se publica en todos tus canales.", bg: "#ffb110", fg: "#000" },
  { t: "Pedidos en una sola lista", b: "Agrupados por transportista y hora de corte. Los atrasados salen en rojo.", bg: "#ffffff", fg: "#000", icon: ICONS.orders },
  { t: "Boleta y factura automáticas", b: "Con tu proveedor de facturación, en el mismo paso de la venta.", bg: "#ffffff", fg: "#000", icon: ICONS.doc },
  { t: "Ganancia real por venta", b: "Neto sin IVA, menos comisión, envío y costo del producto.", bg: "#62aef0", fg: "#000" },
  { t: "Fotos revisadas con IA", b: "Antes de publicar en Mercado Libre, la IA revisa que cada foto coincida con el título.", bg: "#ffffff", fg: "#000", icon: ICONS.scan },
  { t: "Reclamos sin perder plazos", b: "Los reclamos de Mercado Libre con su fecha límite y la respuesta desde el panel.", bg: "#02093a", fg: "#fff" },
] as const;

/* ── Página ───────────────────────────────────────────────────────────────── */

const WRAP = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";
const MARK_COLORS = ["#097fe8", "#f64932", "#ffb110", "#62aef0"];

export default async function Home() {
  const logoMap = await getPlatformLogoMap();
  const heroMarks = salesChannels.slice(0, 7);
  return (
    <div className={`lp ${sans.variable} ${serif.variable} min-h-[100dvh] w-full max-w-full overflow-x-hidden`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
        Saltar al contenido
      </a>

      {/* Barra superior fija */}
      <header className="sticky top-0 z-40 bg-[#f6f5f4]/90 backdrop-blur-md [box-shadow:0_0.7px_1.46px_rgba(0,0,0,0.015),0_3px_9px_rgba(0,0,0,0.03)]">
        <nav className={`${WRAP} flex h-16 items-center justify-between gap-4`} aria-label="Principal">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-black text-[0.8rem] font-bold text-white">M</span>
            Admin Marketplace
          </Link>
          <div className="hidden items-center text-[15px] font-medium md:flex">
            <a href="#beneficios" className="lp-nav-link">Beneficios</a>
            <a href="#canales" className="lp-nav-link">Canales</a>
            <a href="#movil" className="lp-nav-link">Versión móvil</a>
            <a href="#modulos" className="lp-nav-link">Módulos</a>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/login" className="lp-btn lp-btn--text hidden sm:inline-flex">Iniciar sesión</Link>
            <Link href="/login" className="lp-btn lp-btn--primary">Entrar al panel</Link>
          </div>
        </nav>
      </header>

      <main id="contenido">
        {/* Hero centrado */}
        <section className={`${WRAP} pb-20 pt-14 text-center sm:pt-20`}>
          <div className="ui-enter flex flex-wrap justify-center gap-2.5" aria-hidden="true">
            {heroMarks.map((k, i) => (
              <span key={k} className="lp-mark" style={{ color: MARK_COLORS[i % MARK_COLORS.length] }}>
                <span className="h-7 w-7 overflow-hidden rounded-full [&>*]:h-full [&>*]:w-full">
                  {resolveLogoNode(logoMap, k, Logos[k])}
                </span>
              </span>
            ))}
          </div>
          <h1 className="lp-display ui-enter mx-auto mt-8 max-w-[15ch] text-balance text-[clamp(2.6rem,7vw,72px)]" style={{ ["--d" as string]: "80ms" }}>
            Un solo stock para <span className="lp-pill">vender</span> en todos tus canales
          </h1>
          <p className="lp-serif ui-enter mx-auto mt-6 max-w-[36rem] text-pretty text-[18px] leading-[1.56] text-[#615d59]" style={{ ["--d" as string]: "160ms" }}>
            Mercado Libre, Falabella, Paris, Ripley y Walmart conectados a tu bodega.
            Vendes en uno y se descuenta en todos; la boleta sale en el mismo paso.
          </p>
          <div className="ui-enter mt-8 flex flex-wrap justify-center gap-2" style={{ ["--d" as string]: "240ms" }}>
            <Link href="/login" className="lp-btn lp-btn--primary">
              Entrar al panel <Icon d={ICONS.arrow} size={16} />
            </Link>
            <a href="#beneficios" className="lp-btn lp-btn--soft">Ver beneficios</a>
          </div>

          <div className="ui-enter-panel relative mx-auto mt-14 max-w-[860px] text-left" style={{ ["--d" as string]: "300ms" }} aria-hidden="true">
            <div className="grid gap-4 rounded-[12px] bg-[#ffb110] p-4 sm:p-8 md:grid-cols-[1.15fr_0.85fr]">
              <div className="lp-shot rounded-[12px] [&>*]:h-full"><ShipMock /></div>
              <div className="hidden flex-col gap-4 md:flex">
                <div className="lp-shot rounded-[12px]"><StockSyncMock /></div>
                <div className="lp-shot rounded-[12px]"><NetMock /></div>
              </div>
            </div>
          </div>
        </section>

        {/* Muro de logos */}
        <section className="border-y border-black/[0.06] bg-white py-10">
          <div className={WRAP}>
            <p className="mb-5 text-center text-[14px] text-[#757575]">Marketplaces y tiendas que puedes conectar</p>
            <LogosMarquee logoMap={logoMap} />
          </div>
        </section>

        {/* Beneficios */}
        <section id="beneficios" className="py-20">
          <div className={WRAP}>
            <div className="ui-reveal mx-auto max-w-2xl text-center">
              <h2 className="lp-display text-[clamp(2.2rem,5vw,54px)]">Lo que ganas desde el primer día</h2>
              <p className="lp-serif mt-4 text-[18px] leading-[1.56] text-[#615d59]">
                Menos planillas, menos Seller Center abiertos y menos ventas que no puedes cumplir.
              </p>
            </div>
            <div className="ui-reveal mt-12 grid gap-4 md:grid-cols-3">
              {BENEFITS.map((b, i) => (
                <div key={b.t}
                  className={`flex flex-col rounded-[12px] p-6 ${b.bg === "#ffffff" ? "border border-black/[0.08]" : ""} ${i === 0 ? "md:col-span-2" : ""}`}
                  style={{ background: b.bg, color: b.fg }}>
                  {"icon" in b && b.icon ? (
                    <span className="mb-6 grid h-10 w-10 place-items-center rounded-full bg-[#e6f3fe] text-[#0075de]">
                      <Icon d={b.icon} size={20} />
                    </span>
                  ) : (
                    <span className="lp-tag mb-6 self-start bg-white/80 text-black">0{i + 1}</span>
                  )}
                  <p className={`font-bold tracking-[-0.011em] ${i === 0 ? "text-[28px] leading-[1.15] sm:text-[34px]" : "text-[22px] leading-[1.27]"}`}>{b.t}</p>
                  <p className={`mt-2 text-[16px] leading-[1.5] ${b.fg === "#fff" ? "text-white/70" : b.bg === "#ffffff" ? "text-[#615d59]" : "text-black/70"}`}>{b.b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Antes / ahora */}
        <section className="pb-20">
          <div className={WRAP}>
            <div className="lp-card p-6 sm:p-10">
              <h2 className="lp-display ui-reveal max-w-2xl text-[clamp(2rem,4.5vw,48px)]">
                Lo que deja de pasarte en el día a día
              </h2>
              <div className="mt-10 hidden grid-cols-2 gap-10 pb-3 text-[13px] font-medium text-[#757575] md:grid">
                <p>Hoy</p>
                <p className="text-[#0075de]">Con el panel</p>
              </div>
              <ol className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
                {BEFORE_AFTER.map(([before, after], i) => (
                  <li key={i} className="ui-reveal grid gap-3 py-6 md:grid-cols-2 md:gap-10">
                    <p className="text-[16px] leading-[1.5] text-[#757575]">
                      <span className="mr-2 font-medium md:hidden">Hoy:</span>
                      {before}
                    </p>
                    <p className="text-[16px] leading-[1.5]">
                      <span className="mr-2 font-medium text-[#0075de] md:hidden">Con el panel:</span>
                      {after}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Canales: texto a la izquierda, bloque de color a la derecha */}
        <section id="canales" className="pb-20">
          <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]`}>
            <div className="ui-reveal">
              <span className="lp-tag bg-[#e6f3fe] text-[#0075de]">Canales</span>
              <h2 className="lp-display mt-4 text-[clamp(2.2rem,5vw,54px)]">Stock, precios y documentos al día en cada canal</h2>
              <p className="lp-serif mt-4 text-[18px] leading-[1.56] text-[#615d59]">
                Conectas cada cuenta una vez con su API. Lo demás corre solo.
              </p>
              <p className="mt-8 text-[14px] text-[#757575]">Proveedores de facturación electrónica</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
                {billingChannels.map((k) => (
                  <LogoChip key={k} node={resolveLogoNode(logoMap, k, BillingLogos[k])} />
                ))}
              </div>
            </div>
            <div className="ui-reveal rounded-[12px] bg-[#62aef0] p-4 sm:p-8">
              <div className="lp-shot rounded-[12px]"><ChannelsMock /></div>
            </div>
          </div>
        </section>

        {/* Versión móvil: bloque de color a la izquierda, texto a la derecha */}
        <section id="movil" className="pb-20">
          <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[1fr_1fr]`}>
            <div className="ui-reveal order-2 rounded-[12px] bg-[#f64932] px-4 py-10 lg:order-1" aria-hidden="true">
              <PhoneMock />
            </div>
            <div className="ui-reveal order-1 lg:order-2">
              <span className="lp-tag bg-[#f6d5b8] text-black">Versión móvil</span>
              <h2 className="lp-display mt-4 text-[clamp(2.2rem,5vw,54px)]">Tu equipo trabaja desde el celular</h2>
              <p className="lp-serif mt-4 text-[18px] leading-[1.56] text-[#615d59]">
                El panel se adapta al teléfono, sin instalar nada: se abre en el navegador con el mismo usuario.
              </p>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {MOBILE_POINTS.map(([t, b]) => (
                  <li key={t} className="lp-card p-5">
                    <p className="text-[16px] font-semibold">{t}</p>
                    <p className="mt-1 text-[14px] leading-[1.43] text-[#615d59]">{b}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Módulos */}
        <section id="modulos" className="pb-20">
          <div className={WRAP}>
            <div className="lp-card p-6 sm:p-10">
              <div className="ui-reveal max-w-2xl">
                <h2 className="lp-display text-[clamp(2.2rem,5vw,54px)]">Desde que entra el pedido hasta que llega al cliente</h2>
                <p className="lp-serif mt-4 text-[18px] leading-[1.56] text-[#615d59]">
                  Estas son pantallas reales del panel, con datos de ejemplo.
                </p>
              </div>
              <ModulesExplorer />
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="pb-20">
          <div className={WRAP}>
            <div className="flex flex-col gap-8 rounded-[12px] bg-[#02093a] p-8 text-white sm:flex-row sm:items-end sm:justify-between sm:p-12">
              <div>
                <h2 className="lp-display text-[clamp(2rem,4.5vw,48px)]">¿Ya tienes cuenta?</h2>
                <p className="lp-serif mt-3 text-[18px] text-white/70">Entra con tu correo y sigue donde quedaste.</p>
              </div>
              <Link href="/login" className="lp-btn lp-btn--primary shrink-0 self-start sm:self-auto">
                Iniciar sesión <Icon d={ICONS.arrow} size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.06]">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 py-8 text-[13px] text-[#757575]`}>
          <span>Creado por OnDataSolution</span>
          <div className="flex gap-5">
            <a href="#beneficios" className="hover:text-black">Beneficios</a>
            <a href="#canales" className="hover:text-black">Canales</a>
            <a href="#movil" className="hover:text-black">Versión móvil</a>
            <Link href="/login" className="hover:text-black">Iniciar sesión</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
