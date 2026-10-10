import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { Steps } from "@/components/landing/steps";
import { ConnectorsMarquee } from "@/components/landing/connectors-marquee";
import { Pricing, DEFAULT_PLANS, type PublicPlan } from "@/components/landing/pricing";
import { DashboardReplica } from "@/components/landing/dashboard-replica";
import { HeroScene } from "@/components/landing/hero-scene";
import { Benefits } from "@/components/landing/benefits";
import { BeforeAfter } from "@/components/landing/before-after";
import { ContactButtons, ExecutiveButton } from "@/components/landing/contact";
import { RemoteLogo } from "@/components/landing/remote-logo";
import type { LogoView } from "@/lib/platformLogos";
import {
  Toast, TOAST_ICONS,
  ALERTS,
} from "@/components/landing/visuals";

// Tipografía propia de la landing: una sola sans para todo. El panel sigue con Hanken Grotesk.
const sans = Inter({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap" });


/* ── Mocks visuales (mini-versiones reales del producto) ───────────────────── */

type LogoMap = Record<string, { logoUrl: string | null; logoScale?: number; logoScales?: Record<string, number> | null } | undefined>;

// Usa el logo registrado en el panel; si el servidor no lo trajo, lo pide el navegador.
function resolveLogoNode(map: LogoMap, key: string, fallback: ReactNode, view: LogoView = "icon"): ReactNode {
  return <RemoteLogo platform={key} initial={map[key]} view={view} fallback={fallback} />;
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
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.ok ? "bg-[#15803d]" : s.c === "En camino" ? "bg-[#0075de]" : "bg-black/15"}`} />
                <span className="min-w-0 flex-1 truncate">{s.a}</span>
                <span className="text-[#757575]">{s.c}</span>
              </div>
            ))}
          </div>
          <span className="mt-3 block rounded-lg bg-[#02093a] py-2.5 text-center text-[12px] font-medium text-white">
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



/* ── Página ───────────────────────────────────────────────────────────────── */

const WRAP = "w-full px-4 sm:px-6 lg:px-12 2xl:px-20";
// Cada sección es una franja a todo el ancho con su propio fondo.
const BAND = "py-16 lg:py-20";

/** Encabezado de sección: título a la izquierda y bajada a la derecha en escritorio. */
// points: frases cortas con check bajo la bajada (opcional).
function SectionHead({ label, title, lead, points, dark = false, center = false }: { label?: string; title: ReactNode; lead?: string; points?: string[]; dark?: boolean; center?: boolean }) {
  // Centrado: solo etiqueta y título, al medio de la página.
  if (center) {
    return (
      <div className="ui-reveal text-center">
        {label && <p className={`lp-eyebrow ${dark ? "text-[#62aef0]" : "text-[#0075de]"}`}>{label}</p>}
        <h2 className="lp-h2 mx-auto mt-3 max-w-[22ch] text-balance">{title}</h2>
      </div>
    );
  }
  return (
    <div className="ui-reveal grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16">
      <div>
        {label && <p className={`lp-eyebrow ${dark ? "text-[#62aef0]" : "text-[#0075de]"}`}>{label}</p>}
        <h2 className="lp-h2 mt-3 max-w-[20ch] text-balance">{title}</h2>
      </div>
      {(lead || points) && (
        <div>
          {lead && <p className={`lp-lead max-w-[46ch] text-pretty ${dark ? "text-white/70" : "text-[#615d59]"}`}>{lead}</p>}
          {points && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {points.map((t) => (
                <li key={t} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${dark ? "bg-white/10 text-white" : "bg-white text-[#02093a]"}`}
                  style={dark ? undefined : { border: "1px solid rgba(2,9,58,0.08)" }}>
                  <span className="text-[#0075de]"><Icon d={ICONS.check} size={14} /></span>{t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Franja de acción entre secciones. */
// contact: en vez de los botones fijos, muestra "Agenda con un ejecutivo" y "Contáctanos".
function CtaBand({ bg, fg = "#000", title, text, primary, secondary, contact = false }: {
  bg: string; fg?: string; title: string; text: string;
  primary?: { label: string; href: string }; secondary?: { label: string; href: string }; contact?: boolean;
}) {
  const dark = fg === "#fff";
  return (
    <section style={{ background: bg, color: fg }}>
      <div className={`${WRAP} ui-reveal flex flex-col gap-6 py-10 lg:flex-row lg:items-center lg:justify-between lg:py-12`}>
        <div className="max-w-5xl">
          <p className="lp-h3 text-balance">{title}</p>
          <p className={`mt-2 max-w-[80ch] text-[16px] leading-[1.55] ${dark ? "text-white/75" : "text-black/70"}`}>{text}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {contact && <ContactButtons dark={dark} primary size="md" />}
          {primary && <Link href={primary.href} className={`lp-btn ${dark ? "bg-white text-black hover:bg-white/90" : "lp-btn--primary"}`}>
            {primary.label} <Icon d={ICONS.arrow} size={16} />
          </Link>}
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
            <a href="#dashboard" className="lp-nav-link">Dashboard</a>
            <a href="#movil" className="lp-nav-link">Versión móvil</a>
            <a href="#precios" className="lp-nav-link">Precios</a>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/login" className="lp-btn lp-btn--primary">Entrar al panel</Link>
          </div>
        </nav>
      </header>

      <main id="contenido">
        {/* Inicio: franja azul noche a todo el ancho */}
        <section className="relative overflow-hidden text-white" style={{ background: "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)" }}>
          {/* Puntos tenues y halo azul detrás de la escena */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true"
            style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1.2px)", backgroundSize: "22px 22px" }} />
          <div className="pointer-events-none absolute inset-0" aria-hidden="true"
            style={{ background: "radial-gradient(ellipse 55% 70% at 72% 50%, rgba(0,117,222,0.32), transparent 70%)" }} />
          <div className={`${WRAP} relative pb-16 pt-10 sm:pt-14 lg:pb-20`}>
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10 2xl:gap-16">
            {/* Izquierda: titular, bajada y botones */}
            <div>
              <p className="lp-eyebrow ui-enter text-[#62aef0]">Para tiendas que venden en marketplaces en Chile</p>
              <h1 className="lp-h1 lp-h1--hero ui-enter mt-4 max-w-[20ch] text-balance" style={{ ["--d" as string]: "80ms" }}>
                Vende en todos tus canales sin <span className="lp-pill text-[#02093a]" style={{ background: "#cfe6fc" }}>sobrevender</span>
              </h1>
              <div className="ui-enter mt-5 flex flex-col gap-6" style={{ ["--d" as string]: "160ms" }}>
                <p className="lp-lead max-w-[46ch] text-pretty text-white/75">
                  Conecta Mercado Libre, Falabella, Paris, Ripley y Walmart a tu bodega.
                  Cada venta descuenta el stock en todos y emite la boleta sola.
                </p>
                <div className="flex flex-wrap gap-3">
                  <ContactButtons dark primary />
                </div>
                <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/75">
                  {["Stock sincronizado solo", "Boleta automática", "Sin instalar nada"].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="text-[#4ade80]"><Icon d={ICONS.check} size={16} /></span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Derecha: escena animada */}
            <div className="ui-enter-panel min-w-0 text-left" style={{ ["--d" as string]: "240ms" }} aria-hidden="true">
              <HeroScene
                logos={Object.fromEntries((["mercadolibre", "falabella", "paris", "ripley", "walmart", "shopify", "hites", "woocommerce", "jumpseller"] as const).map((k) => [k, resolveLogoNode(logoMap, k, Logos[k], "circle")]))}
                billingLogo={resolveLogoNode(logoMap, "openfactura", BillingLogos.openfactura, "circle")}
              />
            </div>
          </div>
          </div>
        </section>

        {/* Muro de logos */}
        <section className="border-y border-black/[0.06] bg-white py-6">
          <div className={WRAP}>
            <p className="mb-2 text-center text-[14px] text-[#757575]">Conectores disponibles: marketplaces, tiendas, facturación y couriers</p>
            <ConnectorsMarquee />
          </div>
        </section>

        {/* Beneficios */}
        <section id="beneficios" className={BAND}>
          <div className={WRAP}>
            <SectionHead center label="Beneficios"
              title={<>Vende tranquilo, <span className="lp-pill text-[#02093a]" style={{ background: "#cfe6fc" }}>sin quiebres</span> de stock</>} />
            <Benefits />
          </div>
        </section>

        {/* Dashboard y alertas */}
        <section id="dashboard" className={`bg-[#02093a] text-white ${BAND}`}>
          <div className={WRAP}>
            <div>
              <SectionHead center dark label="Dashboard y alertas" title="Tu negocio de un vistazo, y avisos cuando importa" />
              <div className="ui-reveal mt-8 lg:mt-10" aria-label="Ejemplo del dashboard con datos de muestra">
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

        <CtaBand bg="#0075de" fg="#fff" contact title="Imagina este panel con tus propias ventas"
          text="Un ejecutivo te lo muestra con tus canales y te ayuda a conectarlos, sin costo." />

        {/* Antes / ahora */}
        <section className={`bg-white ${BAND}`}>
          <div className={WRAP}>
            <div className="relative">
              <h2 className="lp-h2 ui-reveal mx-auto max-w-[20ch] text-balance text-center">
                Lo que deja de pasarte en el día a día
              </h2>
              <BeforeAfter />
            </div>
          </div>
        </section>

        {/* Versión móvil: bloque de color a la izquierda, texto a la derecha */}
        <section id="movil" className={BAND}>
          <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[1fr_1fr]`}>
            <div className="ui-reveal relative order-2 overflow-hidden rounded-[12px] px-4 py-10 lg:order-1" aria-hidden="true" style={{ background: "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)" }}>
              <div className="relative mx-auto max-w-[560px]">
                <PhoneMock />
                {/* Avisos flotantes: al costado del teléfono en pantallas medianas, debajo en el celular */}
                <div className="mt-6 grid gap-2 sm:mt-0 sm:block">
                  <Toast className="w-full sm:absolute sm:left-0 sm:top-10 sm:w-52" tone="#0075de" icon={TOAST_ICONS.sale}
                    title="¡Nueva venta!" meta="Falabella · Mochila urbana · $34.990" />
                  <Toast className="w-full sm:absolute sm:right-0 sm:top-40 sm:w-52" tone="#0075de" icon={TOAST_ICONS.truck}
                    title="Ruta asignada" meta="Andrea · 8 paradas" style={{ ["--fd" as string]: "0.6s" }} />
                  <Toast className="w-full sm:absolute sm:bottom-16 sm:left-0 sm:w-52" tone="#15803d" icon={TOAST_ICONS.check}
                    title="Entregado con foto" meta="Los Leones 455 · 12:48" style={{ ["--fd" as string]: "1.2s" }} />
                </div>
              </div>
            </div>
            <div className="ui-reveal order-1 lg:order-2">
              <span className="lp-eyebrow text-[#0075de]">Versión móvil</span>
              <h2 className="lp-h2 lp-h2--sm mt-3 text-balance">Tu equipo trabaja desde el celular</h2>
              <p className="lp-lead mt-4 max-w-[46ch] text-[#615d59]">
                El panel se adapta al teléfono, sin instalar nada: se abre en el navegador con el mismo usuario.
              </p>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {MOBILE_POINTS.map(([t, b]) => (
                  <li key={t} className="lp-card p-5">
                    <p className="text-[16px] font-semibold">{t}</p>
                    <p className="mt-1 text-[15px] leading-[1.5] text-[#615d59]">{b}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Planes y precios */}
        <section id="precios" className={`bg-white ${BAND}`}>
          <div className={WRAP}>
            <SectionHead center label="Planes y precios" title="Un plan para cada etapa de tu negocio" />
            <Pricing plans={plans} />
          </div>
        </section>

        {/* Cómo empezar */}
        <section id="como-empezar" className={BAND}>
          <div className={WRAP}>
            <h2 className="lp-h2 ui-reveal mx-auto max-w-[22ch] text-balance text-center">Empieza a vender en todos tus canales en 3 pasos</h2>
            <Steps logos={(["mercadolibre", "falabella", "paris", "ripley", "walmart", "shopify"] as const)
              .map((k) => resolveLogoNode(logoMap, k, Logos[k], "circle"))
              .concat(resolveLogoNode(logoMap, "openfactura", BillingLogos.openfactura, "circle"))} />
          </div>
        </section>

        {/* Cierre */}
        <section className="bg-[#02093a] text-white">
          <div className={WRAP}>
            <div className="relative flex flex-col gap-6 py-12 sm:flex-row sm:items-end sm:justify-between sm:py-14">
              <div>
                <h2 className="lp-h2">¿Conversamos?</h2>
                <p className="lp-lead mt-4 text-white/70">Un ejecutivo te ayuda a elegir el plan y a conectar tus canales.</p>
              </div>
              <ExecutiveButton label="Agenda con un ejecutivo" className="lp-btn--light lp-btn--lg shrink-0 self-start sm:self-auto" />
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#02093a] text-white/60 [border-top:1px_solid_rgba(255,255,255,0.1)]">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 py-8 text-[13px]`}>
          <span>Creado por OnDataSolution</span>
          <div className="flex gap-5">
            <a href="#beneficios" className="hover:text-white">Beneficios</a>
            <a href="#movil" className="hover:text-white">Versión móvil</a>
            <Link href="/login" className="hover:text-white">Entrar al panel</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
