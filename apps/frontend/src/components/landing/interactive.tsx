"use client";

import { useState } from "react";
import { ICONS, Icon } from "./icons";


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
    body: "Los pedidos de todos tus canales llegan a un solo tablero, agrupados por transportista y con la hora límite de despacho de cada uno. Imprime las etiquetas por lote y los pedidos que se pasan de hora salen marcados en rojo.",
    mock: <OrdersMock />,
  },
  {
    icon: ICONS.warehouse,
    title: "Flujo de bodega",
    body: "Asigna los pedidos del día entre tu equipo y sigue el avance por persona en cada etapa. El escáner evita errores de producto y deja registro de quién preparó cada pedido.",
    mock: <WarehouseMock />,
  },
  {
    icon: ICONS.catalog,
    title: "Catálogo y bodegas",
    body: "Un único inventario para todas tus bodegas y canales. Cada venta descuenta de la bodega correcta y el stock se publica al instante en cada marketplace, sin sobreventa ni planillas paralelas.",
    mock: <CatalogMock />,
  },
  {
    icon: ICONS.pos,
    title: "Punto de venta",
    body: "El POS usa el mismo inventario que tus canales online. Selecciona o agrega el cliente, cobra y emite el documento tributario —boleta o factura 33/34— en la misma operación, con envío por correo.",
    mock: <PosMock />,
  },
  {
    icon: ICONS.truck,
    title: "Repartidores",
    body: "Arma rutas para tu flota propia, sigue cada parada en vivo y cierra el reparto con la evidencia de entrega. La remuneración por paquete se calcula sola y un mapa muestra las comunas con más demanda.",
    mock: <DriversMock />,
  },
  {
    icon: ICONS.return,
    title: "Devoluciones",
    body: "Registra cada devolución escaneando la etiqueta, anota en qué estado llegó el producto y decide si vuelve al stock o va a revisión. Todo queda ligado a la venta original.",
    mock: <ReturnsMock />,
  },
];

// Lista de módulos a un lado y la pantalla del módulo elegido al otro (en celular, pestañas
// deslizables arriba). Reemplaza al acordeón: se ve una pantalla completa a la vez.
export function ModulesExplorer() {
  const [active, setActive] = useState(0);
  const m = MODULES[active];
  return (
    <div className="ui-reveal mt-10 grid gap-8 lg:grid-cols-[17rem_1fr] lg:gap-12">
      <div role="tablist" aria-label="Módulos" className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0">
        {MODULES.map((mod, i) => {
          const on = i === active;
          return (
            <button
              key={mod.title}
              type="button"
              role="tab"
              id={`mod-tab-${i}`}
              aria-selected={on}
              aria-controls="mod-panel"
              onClick={() => setActive(i)}
              className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left text-[0.92rem] transition-colors duration-200 lg:rounded-none lg:border-l-2 lg:px-4 lg:py-3.5 ${
                on
                  ? "bg-[var(--brand-soft)] font-semibold text-[var(--text)] lg:border-[var(--brand)] lg:bg-transparent"
                  : "text-[var(--text-2)] hover:text-[var(--text)] lg:border-[var(--border)]"
              }`}
            >
              <span className={on ? "text-[var(--brand-ink)]" : "text-[var(--text-muted)]"}>
                <Icon d={mod.icon} size={18} />
              </span>
              {mod.title}
            </button>
          );
        })}
      </div>

      <div id="mod-panel" role="tabpanel" aria-labelledby={`mod-tab-${active}`}
        className="grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-start">
        <div key={m.title} className="ui-fade">
          <h3 className="text-[1.35rem] font-bold tracking-[-0.02em]">{m.title}</h3>
          <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-[var(--text-2)]">{m.body}</p>
        </div>
        <div key={`${m.title}-mock`} className="ui-fade" aria-hidden="true">{m.mock}</div>
      </div>
    </div>
  );
}
