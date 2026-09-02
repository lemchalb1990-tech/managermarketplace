import Link from "next/link";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";

const salesChannels = [
  "mercadolibre", "falabella", "paris", "ripley", "hites", "walmart",
  "shopify", "woocommerce", "jumpseller",
] as const;
const billingChannels = ["openfactura", "facto", "bsale", "defontana", "nubox", "siigo"] as const;

const EASE = "cubic-bezier(0.32,0.72,0,1)";

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  orders: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0",
  warehouse: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Zm0 7 2 2 4-4",
  catalog: "M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 12h6",
  pos: "M2 7h20l-1.5 12.5A2 2 0 0 1 18.5 21h-13a2 2 0 0 1-2-1.5L2 7Zm4 0V5a4 4 0 0 1 8 0v2",
  truck: "M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  return: "M3 7v6h6M3 13a9 9 0 1 0 2.5-6.3L3 9",
  plug: "M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5",
  scan: "M4 7V5a2 2 0 0 1 2-2h2M4 17v2a2 2 0 0 0 2 2h2M20 7V5a2 2 0 0 0-2-2h-2M20 17v2a2 2 0 0 1-2 2h-2M4 12h16",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
};

const modules = [
  { span: "lg:col-span-1", title: "Flujo de bodega", icon: ICONS.warehouse,
    body: "Reparte los pedidos del día entre tu equipo y prepáralos con pistola: picking, packing y verificación, con el avance por persona." },
  { span: "lg:col-span-1", title: "Catálogo y bodegas", icon: ICONS.catalog,
    body: "Un stock, multi-bodega, sincronizado con cada canal en tiempo real. Sin sobreventa y sin planillas paralelas." },
  { span: "lg:col-span-1", title: "Punto de venta", icon: ICONS.pos,
    body: "Vende en tienda con el mismo stock que online. Selecciona el cliente y emite boleta o factura en el mismo cobro." },
  { span: "lg:col-span-1", title: "Repartidores", icon: ICONS.truck,
    body: "Flota propia con rutas, cierre de reparto, remuneración por paquete entregado y un mapa de las comunas con más demanda." },
  { span: "lg:col-span-2", title: "Devoluciones", icon: ICONS.return,
    body: "Recibe lo que vuelve a bodega escaneando la etiqueta, registra en qué estado llegó y repón el stock cuando corresponde." },
];

const steps = [
  { n: "01", t: "Conecta tus canales", icon: ICONS.plug,
    d: "Marketplaces, tienda online y proveedor de facturación desde un solo lugar." },
  { n: "02", t: "El stock se sincroniza solo", icon: ICONS.scan,
    d: "Cada venta descuenta de la bodega correcta y actualiza el resto de los canales." },
  { n: "03", t: "Prepara, despacha y factura", icon: ICONS.doc,
    d: "Picking con escáner, despacho por transportista y documento tributario en el cobro." },
];

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

function BoardMock() {
  return (
    <div className="ui-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold text-[var(--text-2)]">Flujo de bodega</p>
          {[["Picking", 56], ["Packing", 40]].map(([k, v]) => (
            <div key={k as string} className="mb-3">
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-medium">{k}</span>
                <span className="text-[var(--text-2)]">{v}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--border-soft)]">
                <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${v}%` }} />
              </div>
            </div>
          ))}
          <p className="mt-4 mb-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Empacado por hora</p>
          <div className="flex h-14 items-end gap-1">
            {[2, 5, 4, 8, 12, 9, 6, 3, 7, 10, 5].map((n, i) => (
              <div key={i} className="flex-1 rounded-sm bg-[var(--brand-soft)]" style={{ height: `${(n / 12) * 100}%` }} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold text-[var(--text-2)]">Reparto del día</p>
          <div className="space-y-1.5">
            {[["Andrea M.", 8, 8], ["José P.", 6, 9], ["Charles L.", 9, 11], ["Sin asignar", 0, 4]].map(([n, a, b]) => (
              <div key={n as string} className="flex items-center justify-between rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-xs">
                <span className="font-medium">{n}</span>
                <span className="font-mono text-[var(--text-2)]">{a} / {b}</span>
              </div>
            ))}
          </div>
          <button className="ui-btn-brand mt-3 w-full text-xs">Repartir ahora</button>
        </div>
      </div>
    </div>
  );
}

function FlowDiagram() {
  const nodes = [
    { icon: ICONS.plug, t: "Canales" },
    { icon: ICONS.scan, t: "Stock sincronizado" },
    { icon: ICONS.doc, t: "Despacho + factura" },
  ];
  return (
    <div className="ui-card flex flex-col items-stretch gap-3 p-6 sm:flex-row sm:items-center">
      {nodes.map((n, i) => (
        <div key={n.t} className="flex flex-1 items-center gap-3">
          <div className="flex flex-1 flex-col items-center gap-2 rounded-xl bg-[var(--surface-soft)] px-4 py-5 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-ink)]">
              <Icon d={n.icon} />
            </span>
            <span className="text-xs font-semibold">{n.t}</span>
          </div>
          {i < nodes.length - 1 && (
            <span className="hidden text-[var(--brand)] sm:block"><Icon d={ICONS.arrow} size={22} /></span>
          )}
        </div>
      ))}
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
        <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="ui-reveal">
            <span className="ui-eyebrow bg-[var(--brand-soft)] text-[var(--brand-ink)]">Integraciones</span>
            <h2 className="font-serif mt-4 text-[1.9rem] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
              Se conecta con lo que ya usas
            </h2>
            <p className="mt-3 max-w-md text-[0.95rem] text-[var(--text-2)]">
              Stock, precios, órdenes y documentos tributarios se mantienen al día entre tu
              catálogo y cada canal. Ves el estado de cada conexión de un vistazo.
            </p>
            <div className="mt-8">
              <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Canales de venta</p>
              <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
                {salesChannels.map((k) => (
                  <div key={k} className="flex h-14 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-2.5">
                    <div className="w-[64px] [&>svg]:h-auto [&>svg]:w-full">{Logos[k]}</div>
                  </div>
                ))}
              </div>
              <p className="mb-3 mt-6 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Facturación electrónica</p>
              <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
                {billingChannels.map((k) => (
                  <div key={k} className="flex h-14 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-2.5">
                    <div className="w-[64px] [&>svg]:h-auto [&>svg]:w-full">{BillingLogos[k]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="ui-reveal">
            <ChannelsMock />
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
          </div>

          {/* Showcase: Órdenes y envíos + bodega */}
          <div className="ui-reveal mt-12 grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-stretch">
            <article className="rounded-[1.4rem] bg-[var(--surface-soft)] p-1.5">
              <div className="flex h-full flex-col rounded-[calc(1.4rem-0.375rem)] border border-[var(--border-soft)] bg-[var(--surface)] p-6">
                <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-ink)]">
                  <Icon d={ICONS.orders} />
                </span>
                <h3 className="text-[1.15rem] font-semibold tracking-tight">Órdenes y envíos</h3>
                <p className="mt-2 max-w-md text-[0.92rem] leading-relaxed text-[var(--text-2)]">
                  Los pedidos de todos tus canales, agrupados por transportista, con la hora
                  límite de despacho de cada uno y las etiquetas listas para imprimir por
                  lote. Los que se pasan de hora salen marcados.
                </p>
                <div className="mt-5 hidden sm:block">
                  <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3">
                    <div className="flex items-center justify-between text-[0.7rem] text-[var(--text-muted)]">
                      <span>Envíos de hoy</span><span>límite 18:00</span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {[["Falabella recolección", "7 listas", "ok"], ["Mercado Envíos Flex", "2 enviadas", "ok"], ["Envío Ripley", "1 vencida", "bad"]].map(([a, b, s]) => (
                        <div key={a as string} className="flex items-center justify-between rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[0.72rem]">
                          <span>{a}</span>
                          <span className={s === "bad" ? "text-[var(--danger)]" : "text-[var(--ok)]"}>{b}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </article>
            <div className="flex">
              <BoardMock />
            </div>
          </div>

          {/* Resto de módulos */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((m) => (
              <article key={m.title} className={`ui-reveal ${m.span} rounded-[1.4rem] bg-[var(--surface-soft)] p-1.5`}>
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

          <div className="ui-reveal mt-10">
            <FlowDiagram />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="ui-reveal bg-[var(--surface)] p-8">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-ink)]">
                    <Icon d={s.icon} size={17} />
                  </span>
                  <span className="font-mono text-xs text-[var(--brand-ink)]">{s.n}</span>
                </div>
                <h3 className="mt-3 text-[1.05rem] font-semibold tracking-tight">{s.t}</h3>
                <p className="mt-2 text-[0.9rem] leading-relaxed text-[var(--text-2)]">{s.d}</p>
              </div>
            ))}
          </div>
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
