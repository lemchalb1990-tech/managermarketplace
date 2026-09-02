import Link from "next/link";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";

const salesChannels = [
  "mercadolibre", "falabella", "paris", "ripley", "hites", "walmart",
  "shopify", "woocommerce", "jumpseller",
] as const;

const billingChannels = ["openfactura", "facto", "bsale", "defontana", "nubox", "siigo"] as const;

const EASE = "cubic-bezier(0.32,0.72,0,1)";

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const modules = [
  {
    span: "lg:col-span-2",
    title: "Órdenes y envíos",
    body: "Los pedidos de todos tus canales, agrupados por transportista, con la hora límite de despacho de cada uno y las etiquetas listas para imprimir por lote. Los que se pasan de hora salen marcados.",
    icon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0",
  },
  {
    span: "lg:col-span-1",
    title: "Flujo de bodega",
    body: "Reparte los pedidos del día entre tu equipo y prepáralos con pistola: picking, packing y verificación, con el avance por persona.",
    icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Zm0 7 2 2 4-4",
  },
  {
    span: "lg:col-span-1",
    title: "Catálogo y bodegas",
    body: "Un stock, multi-bodega, sincronizado con cada canal en tiempo real. Sin sobreventa y sin planillas paralelas.",
    icon: "M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 12h6",
  },
  {
    span: "lg:col-span-1",
    title: "Punto de venta",
    body: "Vende en tienda con el mismo stock que online. Selecciona el cliente y emite boleta o factura en el mismo cobro.",
    icon: "M2 7h20l-1.5 12.5A2 2 0 0 1 18.5 21h-13a2 2 0 0 1-2-1.5L2 7Zm4 0V5a4 4 0 0 1 8 0v2",
  },
  {
    span: "lg:col-span-1",
    title: "Repartidores",
    body: "Flota propia con rutas, cierre de reparto, remuneración por paquete entregado y un mapa de las comunas con más demanda.",
    icon: "M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  },
  {
    span: "lg:col-span-2",
    title: "Devoluciones",
    body: "Recibe lo que vuelve a bodega escaneando la etiqueta, registra en qué estado llegó y repón el stock cuando corresponde.",
    icon: "M3 7v6h6M3 13a9 9 0 1 0 2.5-6.3L3 9",
  },
];

const steps = [
  { n: "01", t: "Conecta tus canales", d: "Marketplaces, tienda online y proveedor de facturación desde un solo lugar." },
  { n: "02", t: "El stock se sincroniza solo", d: "Cada venta descuenta de la bodega correcta y actualiza el resto de los canales." },
  { n: "03", t: "Prepara, despacha y factura", d: "Picking con escáner, despacho por transportista y documento tributario en el cobro." },
];

export default function Home() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-[100dvh] bg-[var(--page-bg)] text-[var(--text)]">
      {/* Nav */}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5 text-[0.95rem] font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-[#35301f] font-bold">M</span>
            Admin Marketplace
          </div>
          <Link
            href="/login"
            style={{ transitionTimingFunction: EASE }}
            className="group inline-flex items-center gap-2 rounded-full bg-[var(--text)] py-2 pl-4 pr-2 text-sm font-medium text-[var(--page-bg)] transition-transform duration-300 active:scale-[0.98]"
          >
            Entrar
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 group-hover:translate-x-0.5">
              <Icon d="M5 12h14M13 6l6 6-6 6" />
            </span>
          </Link>
        </div>
      </header>

      {/* Hero — panel oscuro, sin gradiente */}
      <section className="overflow-hidden bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-24 sm:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <span className="ui-eyebrow bg-white/10 text-[var(--brand)]">Operación omnicanal</span>
            <h1 className="font-serif mt-6 text-[2.5rem] leading-[1.08] tracking-[-0.02em] sm:text-[3.3rem]">
              Todas tus ventas y toda tu bodega en un solo lugar.
            </h1>
            <p className="mt-6 max-w-xl text-[1.05rem] leading-relaxed text-white/65">
              Conecta Mercado Libre, Falabella, Paris y más. Sincroniza stock, prepara los
              pedidos con escáner, despacha a tiempo y emite tus boletas — sin saltar entre
              sistemas.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                style={{ transitionTimingFunction: EASE }}
                className="group inline-flex items-center gap-2 rounded-full bg-[var(--brand)] py-3 pl-6 pr-3 font-medium text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.98]"
              >
                Entrar al panel
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-[1px]">
                  <Icon d="M5 12h14M13 6l6 6-6 6" />
                </span>
              </Link>
              <a href="#modulos" className="rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/5">
                Ver los módulos
              </a>
            </div>
            <p className="mt-12 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/35">
              9 canales de venta · 6 proveedores de facturación · stock en tiempo real
            </p>
          </div>

          {/* Mock del panel — solo desktop */}
          <div className="hidden lg:block" aria-hidden="true">
            <div className="rounded-[1.6rem] bg-white/5 p-2 ring-1 ring-white/10 lg:rotate-[1.4deg]">
              <div className="rounded-[calc(1.6rem-0.5rem)] bg-[var(--surface)] p-5 text-[var(--text)] shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--text-2)]">Por despachar hoy</p>
                  <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--brand-ink)]">31</span>
                </div>
                <div className="mt-3 space-y-2">
                  {[
                    { l: "Mercado Envíos · Colecta", n: 12, w: "78%", tone: "var(--ok)" },
                    { l: "Envío Falabella", n: 7, w: "48%", tone: "var(--brand)" },
                    { l: "Envío Ripley", n: 2, w: "22%", tone: "var(--warn)" },
                    { l: "Despacho propio", n: 10, w: "62%", tone: "var(--info)" },
                  ].map((r) => (
                    <div key={r.l} className="flex items-center gap-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2">
                      <span className="flex-1 truncate text-[0.78rem] text-[var(--text)]">{r.l}</span>
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border-soft)]">
                        <span className="block h-full rounded-full" style={{ width: r.w, background: r.tone }} />
                      </span>
                      <span className="w-5 text-right text-[0.72rem] font-mono text-[var(--text-2)]">{r.n}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[["Picking", "56%"], ["Packing", "40%"], ["Empacados", "28"]].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-[var(--border-soft)] px-2.5 py-2">
                      <p className="text-[0.95rem] font-bold tracking-tight">{v}</p>
                      <p className="text-[0.62rem] text-[var(--text-muted)]">{k}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Canales */}
      <section className="border-b border-[var(--border)] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="ui-reveal">
            <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Integraciones</span>
            <h2 className="font-serif mt-4 text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
              Se conecta con lo que ya usas
            </h2>
            <p className="mt-3 max-w-lg text-[0.95rem] text-[var(--text-2)]">
              Stock, precios, órdenes y documentos tributarios se mantienen al día entre
              tu catálogo y cada canal conectado.
            </p>
          </div>

          <p className="mt-12 mb-4 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Canales de venta</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {salesChannels.map((k) => (
              <div key={k} className="ui-reveal flex h-16 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
                <div className="w-[74px] [&>svg]:h-auto [&>svg]:w-full">{Logos[k]}</div>
              </div>
            ))}
          </div>

          <p className="mt-12 mb-4 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Facturación electrónica</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {billingChannels.map((k) => (
              <div key={k} className="ui-reveal flex h-16 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
                <div className="w-[74px] [&>svg]:h-auto [&>svg]:w-full">{BillingLogos[k]}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Módulos — bento */}
      <section id="modulos" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="ui-reveal max-w-2xl">
            <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Módulos</span>
            <h2 className="font-serif mt-4 text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
              Un módulo para cada parte de la operación
            </h2>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <article
                key={m.title}
                className={`ui-reveal ${m.span} rounded-[1.4rem] bg-[var(--surface-soft)] p-1.5`}
              >
                <div className="flex h-full flex-col rounded-[calc(1.4rem-0.375rem)] border border-[var(--border-soft)] bg-[var(--surface)] p-6">
                  <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-ink)]">
                    <Icon d={m.icon} />
                  </span>
                  <h3 className="text-[1.05rem] font-semibold tracking-tight">{m.title}</h3>
                  <p className="mt-2 text-[0.9rem] leading-relaxed text-[var(--text-2)]">{m.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="border-y border-[var(--border)] bg-[var(--surface-soft)] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="ui-reveal font-serif text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
            Cómo funciona
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="ui-reveal bg-[var(--surface)] p-8">
                <span className="font-mono text-xs text-[var(--brand-ink)]">{s.n}</span>
                <h3 className="mt-3 text-[1.05rem] font-semibold tracking-tight">{s.t}</h3>
                <p className="mt-2 text-[0.9rem] leading-relaxed text-[var(--text-2)]">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[var(--topbar-bg)] text-[var(--topbar-fg)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-serif max-w-md text-[1.8rem] leading-tight tracking-[-0.02em]">
            Empieza a operar desde un solo panel
          </h2>
          <Link
            href="/login"
            style={{ transitionTimingFunction: EASE }}
            className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--brand)] py-3 pl-6 pr-3 font-medium text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.98]"
          >
            Iniciar sesión
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1">
              <Icon d="M5 12h14M13 6l6 6-6 6" />
            </span>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-12">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)] text-[#35301f] text-xs font-bold">M</span>
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
