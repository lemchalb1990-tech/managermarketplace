import type { ReactNode } from "react";
import Link from "next/link";
import { Nunito } from "next/font/google";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { ICONS, Icon } from "@/components/landing/icons";
import { Steps } from "@/components/landing/steps";
import { TopNav } from "@/components/landing/topnav";
import { HeroDeco, LightDeco, DarkDeco, Wave } from "@/components/landing/deco";
import { Gallery } from "@/components/landing/gallery";
import { ConnectorsMarquee } from "@/components/landing/connectors-marquee";
import { Pricing, DEFAULT_PLANS, type PublicPlan } from "@/components/landing/pricing";
import { DashboardReplica } from "@/components/landing/dashboard-replica";
import { HeroScene } from "@/components/landing/hero-scene";
import { Benefits } from "@/components/landing/benefits";
import { BeforeAfter } from "@/components/landing/before-after";
import { ContactButtons, ExecutiveButton } from "@/components/landing/contact";
import { FloatingContact } from "@/components/landing/floating-contact";
import { RemoteLogo } from "@/components/landing/remote-logo";
import type { LogoView } from "@/lib/platformLogos";
import "./landing-domium.css";
import { ALERTS } from "@/components/landing/visuals";

// Tipografía de la marca Domium en la landing. El panel sigue con Inter.
const sans = Nunito({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700", "800", "900"] });


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

// ¿Está abierto el registro de empresas nuevas con Google? (muestra "Prueba gratis").
async function getSignupEnabled(): Promise<boolean> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${base}/api/auth/config`, { next: { revalidate: 300 } });
    if (!res.ok) return false;
    return !!(await res.json() as { signupEnabled?: boolean }).signupEnabled;
  } catch {
    return false;
  }
}

/* ── Contenido ─────────────────────────────────────────────────────────────── */


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
        {label && <p className={`lp-eyebrow ${dark ? "text-[#8bcfd8]" : "text-[#23899a]"}`}>{label}</p>}
        <h2 className="lp-h2 mx-auto mt-3 max-w-[22ch] text-balance">{title}</h2>
      </div>
    );
  }
  return (
    <div className="ui-reveal grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16">
      <div>
        {label && <p className={`lp-eyebrow ${dark ? "text-[#8bcfd8]" : "text-[#23899a]"}`}>{label}</p>}
        <h2 className="lp-h2 mt-3 max-w-[20ch] text-balance">{title}</h2>
      </div>
      {(lead || points) && (
        <div>
          {lead && <p className={`lp-lead max-w-[46ch] text-pretty ${dark ? "text-white/70" : "text-[#3d5368]"}`}>{lead}</p>}
          {points && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {points.map((t) => (
                <li key={t} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${dark ? "bg-white/10 text-white" : "bg-white text-[#011f3d]"}`}
                  style={dark ? undefined : { border: "1px solid rgba(1,31,61,0.08)" }}>
                  <span className="text-[#23899a]"><Icon d={ICONS.check} size={14} /></span>{t}
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
  const [logoMap, plans, signupEnabled] = await Promise.all([getPlatformLogoMap(), getPublicPlans(), getSignupEnabled()]);
  return (
    <div className={`lp ${sans.variable} min-h-[100dvh] w-full max-w-full overflow-x-hidden`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
        Saltar al contenido
      </a>

      <TopNav />

      <main id="contenido">
        {/* Inicio: franja azul noche a todo el ancho */}
        <section id="inicio" className="relative overflow-hidden text-white" style={{ background: "linear-gradient(160deg, #011f3d 0%, #014687 100%)" }}>
          {/* Puntos tenues y halo azul detrás de la escena */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true"
            style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1.2px)", backgroundSize: "22px 22px" }} />
          <div className="pointer-events-none absolute inset-0" aria-hidden="true"
            style={{ background: "radial-gradient(ellipse 55% 70% at 72% 50%, rgba(133,194,38,0.32), transparent 70%)" }} />
          <HeroDeco />
          <div className={`${WRAP} relative pb-16 pt-10 sm:pt-14 lg:pb-20`}>
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10 2xl:gap-16">
            {/* Izquierda: titular, bajada y botones */}
            <div>
              <p className="lp-eyebrow ui-enter text-[#8bcfd8]">Para tiendas que quieren llevar el control en un solo lugar</p>
              <h1 className="lp-h1 lp-h1--hero ui-enter mt-4 max-w-[20ch] text-balance" style={{ ["--d" as string]: "80ms" }}>
                Vende en todos tus canales sin <span className="lp-pill text-[#011f3d]" style={{ background: "#d6ecb0" }}>sobrevender</span>
              </h1>
              <div className="ui-enter mt-5 flex flex-col gap-6" style={{ ["--d" as string]: "160ms" }}>
                <p className="lp-lead max-w-[46ch] text-pretty text-white/75">
                  Une tus sucursales y marketplaces en un solo inventario: Mercado Libre, Falabella, Paris, Ripley y Walmart.
                  <span className="deco-lead-2">Cada venta descuenta el stock en todos tus canales y emite la boleta al instante.</span>
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <ContactButtons dark primary />
                  <a href="#precios" className="lp-btn lp-btn--lg deco-demo-btn">Solicita tu demo gratis</a>
                </div>
                <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/75">
                  {["Stock sincronizado solo", "Boleta automática", "Sin instalar nada"].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="text-[#85c226]"><Icon d={ICONS.check} size={16} /></span>
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
        <Wave fill="#ffffff" />
        </section>

        {/* Muro de logos */}
        <section className="border-b border-black/[0.06] bg-white py-3 deco-conn">
          <div className={WRAP}>
            <p className="mb-1 text-center deco-conn-title">Conectores disponibles: marketplaces, tiendas, facturación y couriers</p>
            <ConnectorsMarquee />
          </div>
        </section>

        <Gallery />

        {/* Beneficios */}
        <section id="beneficios" className={`${BAND} relative overflow-hidden deco-band-light`}>
          <LightDeco />
          <div className={`${WRAP} relative z-[1]`}>
            <SectionHead center label="Beneficios"
              title={<>Vende tranquilo, <span className="lp-pill text-[#011f3d]" style={{ background: "#d6ecb0" }}>sin quiebres</span> de stock</>} />
            <Benefits />
          </div>
        </section>

        {/* Dashboard y alertas */}
        <section id="dashboard" className={`bg-[#011f3d] text-white ${BAND} relative overflow-hidden`}>
          <DarkDeco />
          <div className={`${WRAP} relative z-[1]`}>
            <div className="db-wrap">
              <SectionHead center dark label="Dashboard y alertas" title="Tu negocio de un vistazo, y avisos cuando importa" />
              <div className="ui-reveal mt-8 lg:mt-10 db-frame" aria-label="Ejemplo del dashboard con datos de muestra">
                <div className="db-chrome" aria-hidden="true"><i /><i /><i /><span>Panel de Domium</span></div>
                <DashboardReplica />
              </div>
              <p className="db-feed-title"><span className="db-live" />Avisos en tiempo real</p>
              <ul className="ui-reveal mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 db-alerts">
                {ALERTS.map((a) => (
                  <li key={a.t} className="flex min-w-0 items-center gap-3 rounded-[10px] bg-white px-3.5 py-3 text-black">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `${a.tone}1f`, color: a.tone }}>
                      {a.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[14px] font-semibold leading-tight">{a.t}</span>
                        <span className="shrink-0 text-[11px] text-[#6b7f93]">{a.when}</span>
                      </span>
                      <span className="block truncate text-[12px] leading-tight text-[#3d5368]">{a.m}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="db-ticker" aria-hidden="true"><ul>
                {[...ALERTS, ...ALERTS].map((a, n) => (
                  <li key={n}><span className="db-tk-ico" style={{ background: `${a.tone}1f`, color: a.tone }}>{a.icon}</span><b>{a.t}</b><span>{a.m}</span><em>{a.when}</em></li>
                ))}
              </ul></div>
            </div>
          </div>
        </section>

        <CtaBand bg="#23899a" fg="#fff" contact title="Imagina este panel con tus propias ventas"
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

        {/* Planes y precios */}
        <section id="precios" className={`bg-white ${BAND}`}>
          <div className={WRAP}>
            <SectionHead center label="Planes y precios" title="Un plan para cada etapa de tu negocio" />
            <Pricing plans={plans} />
          </div>
        </section>

        {/* Cómo empezar */}
        <section id="como-empezar" className={`${BAND} relative overflow-hidden deco-band-light`}>
          <LightDeco />
          <div className={`${WRAP} relative z-[1]`}>
            <h2 className="lp-h2 ui-reveal mx-auto max-w-[22ch] text-balance text-center">Empieza a vender en todos tus canales en 3 pasos</h2>
            <Steps logos={[]} />
          </div>
        </section>

        {/* Cierre */}
        <section id="cierre" className="bg-[#011f3d] text-white relative overflow-hidden">
          <DarkDeco />
          <div className={`${WRAP} relative z-[1]`}>
            <div className="relative flex flex-col gap-6 py-12 sm:flex-row sm:items-end sm:justify-between sm:py-14">
              <div className="flex items-center gap-6">
                <div>
                <h2 className="lp-h2">¿Conversamos?</h2>
                <p className="lp-lead mt-4 text-white/70">Un ejecutivo te ayuda a elegir el plan y a conectar tus canales.</p>
                </div>
              </div>
              <ExecutiveButton label="Agenda con un ejecutivo" className="lp-btn--light lp-btn--lg shrink-0 self-start sm:self-auto" />
            </div>
          </div>
        </section>
      </main>

      <FloatingContact heroId="inicio" signupEnabled={signupEnabled} />

      <footer className="bg-[#011f3d] text-white/60 [border-top:1px_solid_rgba(255,255,255,0.1)]">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 py-8 text-[13px]`}>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}><img src="/landing/domium/domium-horizontal-blanco.svg" alt="Domium" style={{ height: 24, width: "auto" }} />Creado por OnDataSolution</span>
          <div className="flex gap-5">
            <a href="#beneficios" className="hover:text-white">Beneficios</a>
            <Link href="/login" className="hover:text-white">Entrar al panel</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

