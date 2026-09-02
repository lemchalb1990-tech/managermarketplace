"use client";

import { useState } from "react";
import { ICONS, Icon } from "./icons";

const EASE = "cubic-bezier(0.32,0.72,0,1)";

/* ── Mini-mockups por módulo ───────────────────────────────────────────────── */

function Bar({ w, c }: { w: string; c: string }) {
  return (
    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border-soft)]">
      <span className="block h-full rounded-full" style={{ width: w, background: c }} />
    </span>
  );
}

function OrdersMock() {
  const rows = [
    { l: "Mercado Envíos · Colecta", n: 12, w: "80%", c: "var(--ok)", cut: "corte 16:00" },
    { l: "Envío Falabella", n: 7, w: "45%", c: "var(--brand)", cut: "2 vencidas", bad: true },
    { l: "Envío Ripley", n: 2, w: "20%", c: "var(--warn)", cut: "corte 18:00" },
    { l: "Despacho propio", n: 10, w: "60%", c: "var(--info)", cut: "sin corte" },
  ];
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--text-2)]">Por despachar hoy</p>
        <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--brand-ink)]">31</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.l} className="rounded-lg bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="flex-1 truncate text-[0.78rem]">{r.l}</span>
              <span className="w-4 text-right font-mono text-[0.72rem] text-[var(--text-2)]">{r.n}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Bar w={r.w} c={r.c} />
              <span className={`text-[0.6rem] ${r.bad ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{r.cut}</span>
            </div>
          </div>
        ))}
      </div>
      <button className="ui-btn-brand mt-3 w-full text-xs">Imprimir 21 etiquetas</button>
    </div>
  );
}

function WarehouseMock() {
  const lanes = [
    { t: "Picking", people: [["Andrea M.", "8 / 8"], ["Luis R.", "5 / 9"]] },
    { t: "Packing", people: [["José P.", "4 / 6"], ["Marta S.", "3 / 5"]] },
    { t: "Verificación", people: [["Charles L.", "3 / 3"]] },
  ];
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {lanes.map((l) => (
          <div key={l.t}>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{l.t}</p>
            <div className="space-y-1.5">
              {l.people.map(([n, v]) => (
                <div key={n} className="flex items-center justify-between rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[0.72rem]">
                  <span className="truncate">{n}</span>
                  <span className="font-mono text-[var(--text-2)]">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[0.68rem] text-[var(--text-2)]">Avance del día</span>
        <Bar w="56%" c="var(--brand)" />
        <span className="font-mono text-[0.68rem] text-[var(--text-2)]">56%</span>
      </div>
    </div>
  );
}

function CatalogMock() {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
      <p className="text-[0.82rem] font-semibold">Polera oversize negra</p>
      <p className="font-mono text-[0.66rem] text-[var(--text-muted)]">SKU POL-001</p>
      <div className="mt-3 space-y-1.5">
        {[["Bodega Centro", 24], ["Bodega Norte", 8]].map(([b, n]) => (
          <div key={b as string} className="flex items-center justify-between rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[0.74rem]">
            <span>{b}</span>
            <span className="font-mono text-[var(--text-2)]">{n}</span>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-md bg-[var(--brand-soft)] px-2.5 py-1.5 text-[0.74rem] font-semibold text-[var(--brand-ink)]">
          <span>Stock total</span>
          <span className="font-mono">32</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Mercado Libre", "Falabella", "Paris"].map((c) => (
          <span key={c} className="ui-badge ui-badge--ok">
            <Icon d={ICONS.check} size={11} /> {c} 32
          </span>
        ))}
      </div>
    </div>
  );
}

function PosMock() {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
      <p className="mb-2 text-xs font-semibold text-[var(--text-2)]">Venta en tienda</p>
      <div className="space-y-1 text-[0.76rem]">
        {[["2× Polera oversize", "$19.980"], ["1× Jockey lino", "$8.990"]].map(([a, b]) => (
          <div key={a} className="flex justify-between rounded-md bg-[var(--surface)] px-2.5 py-1.5">
            <span>{a}</span>
            <span className="font-mono text-[var(--text-2)]">{b}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-[var(--border-soft)] pt-2 text-[0.85rem] font-semibold">
        <span>Total</span>
        <span className="font-mono">$28.970</span>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[0.68rem]">Boleta</span>
        <span className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-[0.68rem] font-semibold text-[#35301f]">Factura 33</span>
        <span className="ml-auto text-[0.66rem] text-[var(--text-muted)]">Cliente: Juan Pérez</span>
      </div>
      <button className="ui-btn-brand mt-3 w-full text-xs">Cobrar y emitir</button>
    </div>
  );
}

function DriversMock() {
  const stops = [
    { a: "Providencia 1234", s: "entregado", ok: true },
    { a: "Ñuñoa 567", s: "entregado", ok: true },
    { a: "Las Condes 890", s: "en camino", now: true },
    { a: "Vitacura 21", s: "pendiente" },
  ];
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
      <p className="mb-2 text-xs font-semibold text-[var(--text-2)]">Ruta de Andrea · 8 paradas</p>
      <div className="space-y-1.5">
        {stops.map((st) => (
          <div key={st.a} className="flex items-center gap-2 rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[0.74rem]">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                st.ok ? "bg-[var(--ok-bg)] text-[var(--ok)]" : st.now ? "bg-[var(--info-bg)] text-[var(--info)]" : "bg-[var(--border-soft)] text-[var(--text-muted)]"
              }`}
            >
              {st.ok ? "✓" : "•"}
            </span>
            <span className="flex-1 truncate">{st.a}</span>
            <span className="text-[0.64rem] text-[var(--text-muted)]">{st.s}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between rounded-md bg-[var(--brand-soft)] px-2.5 py-1.5 text-[0.74rem] font-semibold text-[var(--brand-ink)]">
        <span>Pago del día · 8 × $1.200</span>
        <span className="font-mono">$9.600</span>
      </div>
    </div>
  );
}

function ReturnsMock() {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-4">
      <p className="mb-2 text-xs font-semibold text-[var(--text-2)]">Recepción de devoluciones</p>
      <div className="flex items-center gap-2 rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[0.72rem] text-[var(--text-muted)]">
        <Icon d={ICONS.scan} size={14} />
        <span className="font-mono">CL-882931045</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {[
          { p: "Polera oversize negra", c: "Buen estado", ok: true },
          { p: "Jockey lino", c: "Con daño", ok: false },
        ].map((r) => (
          <div key={r.p} className="flex items-center justify-between rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[0.74rem]">
            <span className="truncate">{r.p}</span>
            <span className={`ui-badge ${r.ok ? "ui-badge--ok" : "ui-badge--danger"}`}>{r.c}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.66rem] text-[var(--text-muted)]">1 item repone stock · 1 va a revisión</p>
    </div>
  );
}

/* ── Acordeón de módulos ───────────────────────────────────────────────────── */

const MODULES = [
  {
    icon: ICONS.orders,
    title: "Órdenes y envíos",
    teaser: "Todos los pedidos agrupados por transportista, con hora de corte y etiquetas por lote.",
    body: "Los pedidos de todos tus canales llegan a un solo tablero, agrupados por transportista y con la hora límite de despacho de cada uno. Imprime las etiquetas por lote y los pedidos que se pasan de hora salen marcados en rojo.",
    mock: <OrdersMock />,
  },
  {
    icon: ICONS.warehouse,
    title: "Flujo de bodega",
    teaser: "Reparte el día entre tu equipo y prepara con pistola: picking, packing y verificación.",
    body: "Asigna los pedidos del día entre tu equipo y sigue el avance por persona en cada etapa. El escáner evita errores de producto y deja registro de quién preparó cada pedido.",
    mock: <WarehouseMock />,
  },
  {
    icon: ICONS.catalog,
    title: "Catálogo y bodegas",
    teaser: "Un stock multi-bodega, sincronizado con cada canal en tiempo real.",
    body: "Un único inventario para todas tus bodegas y canales. Cada venta descuenta de la bodega correcta y el stock se publica al instante en cada marketplace, sin sobreventa ni planillas paralelas.",
    mock: <CatalogMock />,
  },
  {
    icon: ICONS.pos,
    title: "Punto de venta",
    teaser: "Vende en tienda con el mismo stock que online y emite boleta o factura en el cobro.",
    body: "El POS usa el mismo inventario que tus canales online. Selecciona o agrega el cliente, cobra y emite el documento tributario —boleta o factura 33/34— en la misma operación, con envío por correo.",
    mock: <PosMock />,
  },
  {
    icon: ICONS.truck,
    title: "Repartidores",
    teaser: "Flota propia con rutas, cierre de reparto y pago por paquete entregado.",
    body: "Arma rutas para tu flota propia, sigue cada parada en vivo y cierra el reparto con la evidencia de entrega. La remuneración por paquete se calcula sola y un mapa muestra las comunas con más demanda.",
    mock: <DriversMock />,
  },
  {
    icon: ICONS.return,
    title: "Devoluciones",
    teaser: "Recibe lo que vuelve escaneando la etiqueta y repón el stock cuando corresponde.",
    body: "Registra cada devolución escaneando la etiqueta, anota en qué estado llegó el producto y decide si vuelve al stock o va a revisión. Todo queda ligado a la venta original.",
    mock: <ReturnsMock />,
  },
];

export function ModulesExplorer() {
  const [open, setOpen] = useState(0);
  return (
    <div className="ui-reveal mt-4 grid gap-3">
      {MODULES.map((m, i) => {
        const isOpen = open === i;
        return (
          <article
            key={m.title}
            className={`group/mod overflow-hidden rounded-[1.2rem] border bg-[var(--surface)] transition-[border-color,box-shadow,transform] duration-300 ${
              isOpen
                ? "border-[var(--brand)] shadow-[var(--shadow-sm)]"
                : "border-[var(--border)] hover:border-[var(--brand)]/40"
            }`}
            style={{ transitionTimingFunction: EASE }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-4 px-5 py-4 text-left"
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${
                  isOpen
                    ? "scale-110 bg-[var(--brand)] text-[#35301f]"
                    : "bg-[var(--brand-soft)] text-[var(--brand-ink)] group-hover/mod:-rotate-6"
                }`}
                style={{ transitionTimingFunction: EASE }}
              >
                <Icon d={m.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[1rem] font-semibold tracking-tight">{m.title}</span>
                <span className={`mt-0.5 block text-[0.85rem] leading-snug text-[var(--text-2)] ${isOpen ? "hidden sm:block" : ""}`}>
                  {m.teaser}
                </span>
              </span>
              <span
                className="shrink-0 text-[var(--text-muted)] transition-transform duration-300"
                style={{ transform: isOpen ? "rotate(180deg)" : "none", transitionTimingFunction: EASE }}
              >
                <Icon d={ICONS.chevron} size={18} />
              </span>
            </button>

            <div
              className="grid transition-[grid-template-rows] duration-500"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", transitionTimingFunction: EASE }}
            >
              <div className="overflow-hidden">
                <div className="grid gap-5 border-t border-[var(--border-soft)] px-5 py-5 md:grid-cols-[1fr_1.05fr] md:items-start">
                  <p className="text-[0.92rem] leading-relaxed text-[var(--text-2)]">{m.body}</p>
                  <div aria-hidden="true">{m.mock}</div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ── Cómo funciona: filas alternadas con mockup ────────────────────────────── */

function ConnectMock() {
  const rows = [
    { n: "Mercado Libre", t: "Tienda oficial", on: true },
    { n: "Falabella Seller", t: "API conectada", on: true },
    { n: "Paris / Cencosud", t: "API conectada", on: true },
    { n: "OpenFactura", t: "Folios cargados", on: true },
  ];
  return (
    <div className="ui-card p-5">
      <p className="mb-3 text-xs font-semibold text-[var(--text-2)]">Conexiones activas</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.82rem] font-medium">{r.n}</span>
              <span className="block text-[0.68rem] text-[var(--text-muted)]">{r.t}</span>
            </span>
            <span className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-[var(--ok)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" /> Conectado
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncMock() {
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
        <span className="ml-auto text-[0.66rem] text-[var(--text-muted)]">−1 Bodega Centro</span>
      </div>
      <p className="mt-3 mb-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Publicado en</p>
      <div className="flex flex-wrap gap-1.5">
        {["Mercado Libre", "Falabella", "Paris", "Tienda web"].map((c) => (
          <span key={c} className="ui-badge ui-badge--ok">
            <Icon d={ICONS.check} size={11} /> {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function FulfillMock() {
  return (
    <div className="ui-card p-5">
      <p className="mb-3 text-xs font-semibold text-[var(--text-2)]">Pedido #40213 · listo para despacho</p>
      <div className="space-y-1.5">
        {[
          "Picking verificado con escáner",
          "Empacado y pesado",
          "Etiqueta Mercado Envíos impresa",
          "Boleta electrónica emitida",
        ].map((t) => (
          <div key={t} className="flex items-center gap-2.5 rounded-md bg-[var(--surface-soft)] px-3 py-2 text-[0.76rem]">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ok-bg)] text-[var(--ok)]">
              <Icon d={ICONS.check} size={11} />
            </span>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  {
    icon: ICONS.plug,
    t: "Conecta tus canales",
    d: "Enlazas tus marketplaces, la tienda online y el proveedor de facturación una sola vez. Desde ahí todo entra al mismo panel.",
    mock: <ConnectMock />,
  },
  {
    icon: ICONS.scan,
    t: "El stock se sincroniza solo",
    d: "Cada venta, venga del canal que venga, descuenta de la bodega correcta y vuelve a publicar el stock disponible en el resto de los canales.",
    mock: <SyncMock />,
  },
  {
    icon: ICONS.doc,
    t: "Prepara, despacha y factura",
    d: "El equipo prepara con pistola, despacha por transportista antes de la hora de corte y el documento tributario se emite en el mismo flujo.",
    mock: <FulfillMock />,
  },
];

export function HowItWorks() {
  return (
    <div className="relative mt-14 pl-11">
      <div className="ui-timeline-line" aria-hidden="true" />
      {STEPS.map((s) => (
        <div key={s.t} className="ui-reveal relative pb-16 last:pb-0">
          <span className="absolute -left-11 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--brand)] bg-[var(--surface)] text-[var(--brand-ink)]">
            <Icon d={s.icon} size={16} />
          </span>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr] lg:items-center">
            <div>
              <h3 className="font-serif text-[1.5rem] leading-tight">{s.t}</h3>
              <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-[var(--text-2)]">{s.d}</p>
            </div>
            <div aria-hidden="true">{s.mock}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
