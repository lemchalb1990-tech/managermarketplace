import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { ModulesExplorer } from "@/components/landing/interactive";
import { Pricing, DEFAULT_PLANS, type PublicPlan } from "@/components/landing/pricing";
import { DashboardReplica } from "@/components/landing/dashboard-replica";
import { HeroScene } from "@/components/landing/hero-scene";
import {
  Toast, TOAST_ICONS, StockMini, ProfitMini, ClaimMini,
  PublishMini, DirectSaleMini, QuoteMini, InvoiceMini, LabelMini, QuestionsMini,
  ALERTS, PRODUCT_IMG,
} from "@/components/landing/visuals";

// Tipografía propia de la landing: una sola sans para todo. El panel sigue con Hanken Grotesk.
const sans = Inter({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap" });

const salesChannels = [
  "mercadolibre", "falabella", "paris", "ripley", "hites", "walmart",
  "shopify", "woocommerce", "jumpseller",
] as const;
const billingChannels = ["openfactura", "facto", "bsale", "defontana", "nubox", "siigo"] as const;

/* ── Mocks visuales (mini-versiones reales del producto) ───────────────────── */

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
              <td className="px-4 py-3 font-medium sm:px-5">{r.name}</td>
              <td className="hidden px-2 py-3 text-xs text-[var(--text-muted)] sm:table-cell">{r.acc}</td>
              <td className="px-2 py-3 text-right font-mono text-xs text-[var(--text-2)]">{r.prod} prod.</td>
              <td className="px-4 py-3 text-right sm:px-5">
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

function LogoChip({ node, large = false }: { node: ReactNode; large?: boolean }) {
  return (
    <span className={`group/logo flex shrink-0 items-center justify-center px-2 ${large ? "h-24 w-[176px] sm:h-28 sm:w-[200px]" : "h-16 w-[132px]"}`}>
      <span className={`${large ? "h-16 w-[112px] sm:h-[76px] sm:w-[132px]" : "h-11 w-[74px]"} opacity-75 grayscale-[0.5] transition duration-300 group-hover/logo:opacity-100 group-hover/logo:grayscale-0 [&>svg]:h-full [&>svg]:w-full [&>svg]:rounded-[9px]`}>
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
          <LogoChip large key={`${k}-${i}`} node={resolveLogoNode(logoMap, k, Logos[k])} />
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

async function getPublicPlans(): Promise<PublicPlan[]> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${base}/api/public/plans`, { next: { revalidate: 300 } });
    if (!res.ok) return DEFAULT_PLANS;
    const rows = await res.json() as PublicPlan[];
    return rows.length ? rows : DEFAULT_PLANS;
  } catch {
    return DEFAULT_PLANS;
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
                <span className="min-w-0 flex-1 truncate">{s.a}</span>
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

/* ── Todo desde el panel ──────────────────────────────────────────────────── */

const TOOLS: Array<{ t: string; b: string; mock: ReactNode }> = [
  { t: "Publica en los marketplaces", b: "Creas el producto una vez y lo publicas en Mercado Libre, Falabella, Paris y Ripley desde el panel.", mock: <PublishMini /> },
  { t: "Ventas directas", b: "Punto de venta para tu tienda o bodega, con el mismo stock que tus canales online.", mock: <DirectSaleMini /> },
  { t: "Presupuestos y órdenes de compra", b: "Cotizas a tus clientes y pides mercadería a tus proveedores sin salir del sistema.", mock: <QuoteMini /> },
  { t: "Boletas y facturas", b: "Documentos tributarios electrónicos con tu proveedor de facturación, enviados por correo.", mock: <InvoiceMini /> },
  { t: "Etiquetas de los marketplaces", b: "Imprimes por lote las etiquetas de Mercado Libre, Falabella, Paris y Ripley.", mock: <LabelMini /> },
  { t: "Preguntas de Mercado Libre", b: "Respondes las preguntas de tus publicaciones desde el mismo lugar donde ves el stock.", mock: <QuestionsMini /> },
];

/* ── Catálogo de ejemplo con fotos reales ─────────────────────────────────── */

const CATALOG = [
  { name: "Zapatillas urbanas blancas", img: PRODUCT_IMG.zapatillas, price: "$49.990", stock: 24, channels: 6 },
  { name: "Polera oversize negra", img: PRODUCT_IMG.polera, price: "$12.990", stock: 58, channels: 5 },
  { name: "Mochila urbana 25 L", img: PRODUCT_IMG.mochila, price: "$34.990", stock: 17, channels: 4 },
  { name: "Polerón blanco", img: PRODUCT_IMG.poleron, price: "$24.990", stock: 31, channels: 5 },
];

/* ── Página ───────────────────────────────────────────────────────────────── */

const WRAP = "w-full px-4 sm:px-6 lg:px-12 2xl:px-20";
// Cada sección es una franja a todo el ancho con su propio fondo.
const BAND = "py-24 lg:py-32";

/** Encabezado de sección: título a la izquierda y bajada a la derecha en escritorio. */
function SectionHead({ label, title, lead, dark = false }: { label?: string; title: string; lead?: string; dark?: boolean }) {
  return (
    <div className="ui-reveal grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:gap-16">
      <div>
        {label && <p className={`lp-eyebrow ${dark ? "text-[#62aef0]" : "text-[#0075de]"}`}>{label}</p>}
        <h2 className="lp-h2 mt-3 max-w-[20ch] text-balance">{title}</h2>
      </div>
      {lead && <p className={`lp-lead max-w-[46ch] text-pretty lg:pb-1.5 ${dark ? "text-white/70" : "text-[#615d59]"}`}>{lead}</p>}
    </div>
  );
}

/** Franja de acción entre secciones. */
function CtaBand({ bg, fg = "#000", title, text, primary, secondary }: {
  bg: string; fg?: string; title: string; text: string;
  primary: { label: string; href: string }; secondary?: { label: string; href: string };
}) {
  const dark = fg === "#fff";
  return (
    <section style={{ background: bg, color: fg }}>
      <div className={`${WRAP} ui-reveal flex flex-col gap-8 py-14 lg:flex-row lg:items-center lg:justify-between lg:py-16`}>
        <div className="max-w-3xl">
          <p className="lp-h3 text-balance">{title}</p>
          <p className={`mt-3 max-w-[56ch] text-[16px] leading-[1.55] ${dark ? "text-white/75" : "text-black/70"}`}>{text}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={primary.href} className={`lp-btn ${dark ? "bg-white text-black hover:bg-white/90" : "bg-black text-white hover:bg-[#111]"}`}>
            {primary.label} <Icon d={ICONS.arrow} size={16} />
          </Link>
          {secondary && (
            <a href={secondary.href} className={`lp-btn ${dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-white/70 text-black hover:bg-white"}`}>
              {secondary.label}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export default async function Home() {
  const [logoMap, plans] = await Promise.all([getPlatformLogoMap(), getPublicPlans()]);
  return (
    <div className={`lp ${sans.variable} min-h-[100dvh] w-full max-w-full overflow-x-hidden`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
        Saltar al contenido
      </a>

      {/* Barra superior fija */}
      <header className="sticky top-0 z-40 bg-[#f6f5f4]/90 backdrop-blur-md [box-shadow:0_0.7px_1.46px_rgba(0,0,0,0.015),0_3px_9px_rgba(0,0,0,0.03)]">
        <nav className={`${WRAP} flex h-16 items-center justify-between gap-4`} aria-label="Principal">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-black text-[0.8rem] font-bold text-white">M</span>
            <span className="max-[380px]:hidden">Admin Marketplace</span>
          </Link>
          <div className="hidden items-center text-[15px] font-medium lg:flex">
            <a href="#beneficios" className="lp-nav-link">Beneficios</a>
            <a href="#funciones" className="lp-nav-link">Funciones</a>
            <a href="#dashboard" className="lp-nav-link">Dashboard</a>
            <a href="#canales" className="lp-nav-link">Canales</a>
            <a href="#movil" className="lp-nav-link">Versión móvil</a>
            <a href="#precios" className="lp-nav-link">Precios</a>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/login" className="lp-btn lp-btn--primary">Entrar al panel</Link>
          </div>
        </nav>
      </header>

      <main id="contenido">
        {/* Hero centrado */}
        <section className={`${WRAP} relative pb-24 pt-16 sm:pt-24 lg:pb-32`}>
          {/* Puntos de cuaderno y marcas decorativas alrededor del titular */}
          <div className="lp-dotgrid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px]" aria-hidden="true" />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:items-end lg:gap-16">
            <h1 className="lp-h1 ui-enter max-w-[14ch] text-balance" style={{ ["--d" as string]: "80ms" }}>
              Un solo stock para <span className="lp-pill">vender</span> en todos tus canales
            </h1>
            <div className="ui-enter lg:pb-2" style={{ ["--d" as string]: "160ms" }}>
              <p className="lp-lead max-w-[42ch] text-pretty text-[#615d59]">
                Mercado Libre, Falabella, Paris, Ripley y Walmart conectados a tu bodega.
                Vendes en uno y se descuenta en todos.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className="lp-btn lp-btn--primary lp-btn--lg">
                  Entrar al panel <Icon d={ICONS.arrow} size={16} />
                </Link>
                <a href="#beneficios" className="lp-btn lp-btn--soft lp-btn--lg">Ver beneficios</a>
              </div>
            </div>
          </div>

          <div className="ui-enter-panel relative mt-12 w-full text-left lg:mt-16" style={{ ["--d" as string]: "300ms" }} aria-hidden="true">
            <HeroScene
              logos={Object.fromEntries((["mercadolibre", "falabella", "paris", "ripley", "walmart"] as const).map((k) => [k, resolveLogoNode(logoMap, k, Logos[k])]))}
              phone={<PhoneMock />}
            />

          </div>
        </section>

        {/* Muro de logos */}
        <section className="border-y border-black/[0.06] bg-white py-10">
          <div className={WRAP}>
            <p className="mb-2 text-center text-[14px] text-[#757575]">Marketplaces y tiendas que puedes conectar</p>
            <LogosMarquee logoMap={logoMap} />
          </div>
        </section>

        {/* Beneficios */}
        <section id="beneficios" className={BAND}>
          <div className={WRAP}>
            <SectionHead label="Beneficios" title="Lo que ganas desde el primer día"
              lead="Menos planillas, menos Seller Center abiertos y menos ventas que no puedes cumplir." />
            <div className="ui-reveal mt-12 grid gap-4 md:grid-cols-3 lg:mt-16 lg:gap-5">
              {BENEFITS.map((b, i) => (
                <div key={b.t}
                  className={`relative flex flex-col overflow-hidden rounded-[12px] p-6 ${b.bg === "#ffffff" ? "border border-black/[0.08]" : ""} ${i === 0 ? "md:col-span-2" : ""}`}
                  style={{ background: b.bg, color: b.fg }}>
                  {"icon" in b && b.icon ? (
                    <span className="mb-6 grid h-10 w-10 place-items-center rounded-full bg-[#e6f3fe] text-[#0075de]">
                      <Icon d={b.icon} size={20} />
                    </span>
                  ) : (
                    <span className="mb-6 self-start font-mono text-[13px] font-medium opacity-60">0{i + 1}</span>
                  )}
                  <p className={`font-bold tracking-[-0.011em] ${i === 0 ? "text-[26px] leading-[1.15] sm:text-[30px]" : "text-[20px] leading-[1.3]"}`}>{b.t}</p>
                  <p className={`mt-2 text-[15px] leading-[1.55] ${b.fg === "#fff" ? "text-white/70" : b.bg === "#ffffff" ? "text-[#615d59]" : "text-black/70"}`}>{b.b}</p>
                  {b.bg === "#ffb110" && <StockMini />}
                  {b.bg === "#62aef0" && <ProfitMini />}
                  {b.bg === "#02093a" && <ClaimMini />}
                </div>
              ))}
            </div>
          </div>
        </section>

        <CtaBand bg="#ffb110" title="Deja de actualizar el stock a mano en cada canal"
          text="Conectas tus cuentas una vez y cada venta se descuenta sola en todos lados."
          primary={{ label: "Entrar al panel", href: "/login" }} secondary={{ label: "Ver funciones", href: "#funciones" }} />

        {/* Todo desde el panel */}
        <section id="funciones" className={`bg-white ${BAND}`}>
          <div className={WRAP}>
            <SectionHead label="Funciones" title="Todo tu negocio desde un solo panel"
              lead="Publicas, vendes, cotizas, facturas y despachas sin cambiar de sistema." />
            <div className="ui-reveal mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3 lg:gap-5">
              {TOOLS.map((x) => (
                <div key={x.t} className="lp-card flex min-w-0 flex-col p-6">
                  <p className="text-[20px] font-bold leading-[1.27] tracking-[-0.011em]">{x.t}</p>
                  <p className="mt-2 text-[15px] leading-[1.5] text-[#615d59]">{x.b}</p>
                  <div className="mt-auto" aria-hidden="true">{x.mock}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Dashboard y alertas */}
        <section id="dashboard" className={`bg-[#02093a] text-white ${BAND}`}>
          <div className={WRAP}>
            <div>
              <SectionHead dark label="Dashboard y alertas" title="Tu negocio de un vistazo, y avisos cuando importa"
                lead="Ventas, neto, órdenes y ticket promedio de todos tus canales en una pantalla. Y un aviso, con sonido, cada vez que entra una venta, una pregunta o un reclamo." />
              <div className="ui-reveal mt-12 lg:mt-16" aria-label="Ejemplo del dashboard con datos de muestra">
                <DashboardReplica />
              </div>
              <ul className="ui-reveal mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {ALERTS.map((a) => (
                  <li key={a.t} className="flex min-w-0 items-center gap-3 rounded-[10px] bg-white px-3.5 py-3 text-black">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `${a.tone}1f`, color: a.tone }}>
                      {a.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[14px] font-semibold leading-tight">{a.t}</span>
                        <span className="shrink-0 text-[11px] text-[#757575]">{a.when}</span>
                      </span>
                      <span className="block truncate text-[12px] leading-tight text-[#615d59]">{a.m}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <CtaBand bg="#0075de" fg="#fff" title="Mira tus números reales, no los de ejemplo"
          text="Entra al panel y ve tus ventas, tu neto y tus órdenes de todos los canales en una pantalla."
          primary={{ label: "Entrar al panel", href: "/login" }} secondary={{ label: "Ver planes", href: "#precios" }} />

        {/* Antes / ahora */}
        <section className={`bg-white ${BAND}`}>
          <div className={WRAP}>
            <div className="relative">
              <h2 className="lp-h2 ui-reveal max-w-[20ch] text-balance">
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
        <section id="canales" className={`bg-[#e6f3fe] ${BAND}`}>
          <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]`}>
            <div className="ui-reveal">
              <span className="lp-eyebrow text-[#0075de]">Canales</span>
              <h2 className="lp-h2 mt-3 text-balance">Stock, precios y documentos al día en cada canal</h2>
              <p className="lp-lead mt-5 max-w-[46ch] text-[#615d59]">
                Conectas cada cuenta una vez con su API. Lo demás corre solo.
              </p>
              <p className="mt-8 text-[14px] text-[#757575]">Proveedores de facturación electrónica</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
                {billingChannels.map((k) => (
                  <LogoChip key={k} node={resolveLogoNode(logoMap, k, BillingLogos[k])} />
                ))}
              </div>
            </div>
            <div className="ui-reveal relative rounded-[12px] bg-[#62aef0] p-4 sm:p-8">
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {CATALOG.map((p) => (
                  <div key={p.name} className="lp-shot overflow-hidden rounded-[12px] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.img} alt={p.name} width={480} height={480} loading="lazy" className="aspect-square w-full object-cover" />
                    <div className="p-2.5">
                      <p className="truncate text-[13px] font-semibold leading-tight">{p.name}</p>
                      <p className="mt-0.5 flex items-center justify-between text-[12px] text-[#615d59]">
                        <span className="font-mono">{p.price}</span>
                        <span>{p.stock} en stock</span>
                      </p>
                      <p className="mt-1.5 inline-flex rounded-full bg-[#e6f3fe] px-2 py-0.5 text-[11px] font-medium text-[#0075de]">
                        En {p.channels} canales
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lp-shot rounded-[12px]"><ChannelsMock /></div>
            </div>
          </div>
        </section>

        <CtaBand bg="#02093a" fg="#fff" title="Conecta tu primera cuenta en minutos"
          text="Mercado Libre, Falabella, Paris, Ripley o Walmart: autorizas tu cuenta y el panel trae tus publicaciones."
          primary={{ label: "Entrar al panel", href: "/login" }} secondary={{ label: "Ver versión móvil", href: "#movil" }} />

        {/* Versión móvil: bloque de color a la izquierda, texto a la derecha */}
        <section id="movil" className={BAND}>
          <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[1fr_1fr]`}>
            <div className="ui-reveal relative order-2 overflow-hidden rounded-[12px] bg-[#f64932] px-4 py-10 lg:order-1" aria-hidden="true">
              <div className="relative mx-auto max-w-[560px]">
                <PhoneMock />
                {/* Avisos flotantes: al costado del teléfono en pantallas medianas, debajo en el celular */}
                <div className="mt-6 grid gap-2 sm:mt-0 sm:block">
                  <Toast className="w-full sm:absolute sm:left-0 sm:top-10 sm:w-52" tone="#0075de" icon={TOAST_ICONS.sale}
                    title="¡Nueva venta!" meta="Falabella · Mochila urbana · $34.990" />
                  <Toast className="w-full sm:absolute sm:right-0 sm:top-40 sm:w-52" tone="#e89d01" icon={TOAST_ICONS.truck}
                    title="Ruta asignada" meta="Andrea · 8 paradas" style={{ ["--fd" as string]: "0.6s" }} />
                  <Toast className="w-full sm:absolute sm:bottom-16 sm:left-0 sm:w-52" tone="#15803d" icon={TOAST_ICONS.check}
                    title="Entregado con foto" meta="Los Leones 455 · 12:48" style={{ ["--fd" as string]: "1.2s" }} />
                </div>
              </div>
            </div>
            <div className="ui-reveal order-1 lg:order-2">
              <span className="lp-eyebrow text-[#c43b1c]">Versión móvil</span>
              <h2 className="lp-h2 mt-3 text-balance">Tu equipo trabaja desde el celular</h2>
              <p className="lp-lead mt-5 max-w-[46ch] text-[#615d59]">
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

        {/* Planes y precios */}
        <section id="precios" className={`bg-white ${BAND}`}>
          <div className={WRAP}>
            <SectionHead label="Planes y precios" title="Un plan para cada etapa de tu negocio"
              lead="Empiezas con los canales que tienes hoy y subes de plan cuando creces." />
            <Pricing plans={plans} />
          </div>
        </section>

        <CtaBand bg="#f6d5b8" title="Pruébalo gratis 15 días"
          text="Con todo lo del plan Crece y sin compromiso. Al final eliges si sigues."
          primary={{ label: "Empezar la prueba", href: "/login" }} secondary={{ label: "Ver cómo funciona", href: "#modulos" }} />

        {/* Módulos */}
        <section id="modulos" className={BAND}>
          <div className={WRAP}>
            <div>
              <SectionHead label="Módulos" title="Desde que entra el pedido hasta que llega al cliente"
                lead="Estas son pantallas reales del panel, con datos de ejemplo." />
              <ModulesExplorer />
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="bg-[#02093a] text-white">
          <div className={WRAP}>
            <div className="relative flex flex-col gap-8 py-16 sm:flex-row sm:items-end sm:justify-between sm:py-20">
              <div>
                <h2 className="lp-h2">¿Ya tienes cuenta?</h2>
                <p className="lp-lead mt-4 text-white/70">Entra con tu correo y sigue donde quedaste.</p>
              </div>
              <Link href="/login" className="lp-btn lp-btn--primary shrink-0 self-start sm:self-auto">
                Entrar al panel <Icon d={ICONS.arrow} size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#02093a] text-white/60 [border-top:1px_solid_rgba(255,255,255,0.1)]">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 py-8 text-[13px]`}>
          <span>Creado por OnDataSolution</span>
          <div className="flex gap-5">
            <a href="#beneficios" className="hover:text-white">Beneficios</a>
            <a href="#canales" className="hover:text-white">Canales</a>
            <a href="#movil" className="hover:text-white">Versión móvil</a>
            <Link href="/login" className="hover:text-white">Entrar al panel</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
