"use client";

/* Réplica del Inicio del panel (src/app/dashboard/page.tsx) con datos de ejemplo:
   mismas tarjetas, íconos, colores, gráfico de barras, dona por canal y filtros. */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { SectionCard } from "@/components/ui";

const CARD_SHADOW: CSSProperties = { boxShadow: "0 10px 24px rgba(43,42,39,0.12), 0 2px 6px rgba(43,42,39,0.08)" };
const DONUT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#64748b"];
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

const PERIODS = [
  { key: "12m", label: "12 meses" },
  { key: "6m", label: "6 meses" },
  { key: "15d", label: "15 días" },
  { key: "7d", label: "7 días" },
  { key: "hoy", label: "Hoy" },
] as const;
type Period = typeof PERIODS[number]["key"];

const CHANNELS: Array<[string, string, number]> = [
  ["", "Todos", 1],
  ["MERCADO_LIBRE", "Mercado Libre", 0.44],
  ["FALABELLA", "Falabella", 0.2],
  ["PARIS", "Paris", 0.13],
  ["POS", "POS", 0.12],
  ["RIPLEY", "Ripley", 0.07],
  ["WALMART", "Walmart", 0.04],
];

// Participación por canal: [nombre, % de órdenes, ticket promedio, % neto].
const STORES: Array<[string, number, number, number]> = [
  ["Mercado Libre", 0.44, 27900, 0.82],
  ["Falabella", 0.2, 31200, 0.8],
  ["Paris", 0.13, 29400, 0.81],
  ["POS - Tienda Centro", 0.12, 18600, 0.98],
  ["Ripley", 0.07, 33800, 0.79],
  ["Walmart", 0.04, 24500, 0.8],
];

const MONTHS = ["nov.", "dic.", "ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct."];
const MONTH_SALES = [21.4, 32.8, 18.9, 17.2, 19.6, 20.3, 22.1, 21.7, 23.9, 25.2, 26.8, 12.4].map((m) => m * 1_000_000);
const DAY_SALES = [612, 845, 790, 1020, 932, 1184, 702, 655, 980, 1105, 1240, 1012, 890, 1310, 1284].map((k) => k * 1000);

function seriesFor(period: Period) {
  if (period === "12m") return MONTHS.map((label, i) => ({ label, total: MONTH_SALES[i] }));
  if (period === "6m") return MONTHS.slice(6).map((label, i) => ({ label, total: MONTH_SALES[i + 6] }));
  const days = period === "15d" ? 15 : period === "7d" ? 7 : 1;
  const today = new Date(2026, 9, 9);
  return DAY_SALES.slice(-days).map((total, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return { label: days === 1 ? "Hoy" : d.toLocaleDateString("es-CL", { day: "numeric", month: "short" }).replace(".", ""), total };
  });
}

const ORDERS_BY_PERIOD: Record<Period, number> = { "12m": 9640, "6m": 4870, "15d": 612, "7d": 284, hoy: 48 };

function RowOpenIcon() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-muted)] transition-colors group-hover:border-emerald-500 group-hover:bg-emerald-500 group-hover:text-white">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
    </span>
  );
}

function Kpi({ title, value, icon, colorClass, center = false }: { title: string; value: string; icon: string; colorClass: string; center?: boolean }) {
  return (
    <div className="ui-card flex h-full items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3" style={CARD_SHADOW}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg sm:h-11 sm:w-11 sm:text-xl ${colorClass}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 line-clamp-2 text-xs font-bold leading-tight text-[var(--text-2)] sm:text-[13px]">{title}</p>
        <p className={`whitespace-nowrap text-[1.15rem] font-bold leading-tight tracking-tight text-[var(--text)] sm:text-[1.35rem] ${center ? "text-center" : "text-right"}`}>{value}</p>
      </div>
    </div>
  );
}

const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Pendiente", color: "bg-amber-100 text-amber-700" },
  PREPARING: { label: "Preparando", color: "bg-blue-100 text-blue-700" },
  READY: { label: "Listo", color: "bg-indigo-100 text-indigo-700" },
};
const URGENT: Array<[keyof typeof STATUS, string, string, string, boolean]> = [
  ["PENDING", "2000009871", "Camila Rojas", "Mercado Libre - Tienda Principal", true],
  ["PREPARING", "88213", "Jorge Muñoz", "Falabella", true],
  ["READY", "A4F21C", "Valentina Soto", "POS", false],
  ["PENDING", "7712045", "Ignacio Pérez", "Paris", true],
];
const RECENT: Array<[string, string, string, number, string]> = [
  ["Zapatillas urbanas blancas", "Mercado Libre", "12:48", 49990, "/landing/products/zapatillas-blancas.jpg"],
  ["Polera oversize negra +1 más", "POS", "12:31", 25980, "/landing/products/polera-negra.jpg"],
  ["Mochila urbana 25 L", "Falabella", "12:05", 34990, "/landing/products/mochila-urbana.jpg"],
  ["Jockey blanco", "Paris", "11:52", 12990, "/landing/products/jockey-blanco.jpg"],
];

export function DashboardReplica() {
  const [period, setPeriod] = useState<Period>("12m");
  const [channel, setChannel] = useState("");
  // Las barras y la dona crecen cada vez que cambia un filtro, como en el panel.
  const filterKey = `${period}|${channel}`;
  const [readyFor, setReadyFor] = useState("");
  const ready = readyFor === filterKey;
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setReadyFor(filterKey)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [filterKey]);

  const factor = CHANNELS.find(([k]) => k === channel)?.[2] ?? 1;
  const data = useMemo(() => seriesFor(period).map((d) => ({ ...d, total: d.total * factor })), [period, factor]);
  const daily = period !== "12m" && period !== "6m";
  const max = Math.max(...data.map((d) => d.total), 1);
  const avg = data.reduce((s, d) => s + d.total, 0) / data.length;

  const totalOrders = ORDERS_BY_PERIOD[period];
  const segments = STORES.map(([label, share, ticket, net], i) => ({
    label, count: Math.round(totalOrders * share), ticket, net, pct: share * 100, color: DONUT_COLORS[i],
    offset: 25 - STORES.slice(0, i).reduce((sum, st) => sum + st[1] * 100, 0),
  }));

  return (
    <div className="lp-panel rounded-[12px] p-3 text-left sm:p-5">
      {/* Encabezado */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[12px] text-[var(--text-muted)]">Inicio <span className="mx-1">/</span> Tienda Urbana SpA</p>
          <p className="text-[1.35rem] font-bold leading-tight tracking-[-0.02em]">Bienvenida, Andrea</p>
        </div>
        <span className="hidden text-sm capitalize text-[var(--text-muted)] sm:block">viernes, 9 de octubre de 2026</span>
      </div>

      {/* Indicadores del día */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Kpi title="Ventas hoy" value="48" icon="🛒" colorClass="bg-blue-50 text-blue-500" center />
        <Kpi title="Ingresos hoy" value="$1.284.500" icon="💰" colorClass="bg-green-50 text-green-500" />
        <Kpi title="Total neto recibido" value="$1.052.290" icon="🏦" colorClass="bg-emerald-50 text-emerald-600" />
        <Kpi title="Órdenes activas" value="23" icon="📦" colorClass="bg-amber-50 text-amber-500" center />
        <div className="col-span-2 lg:col-span-1">
          <Kpi title="Ticket promedio hoy" value="$26.760" icon="🧾" colorClass="bg-violet-50 text-violet-500" />
        </div>
      </div>

      {/* Historial + ventas por canal */}
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <SectionCard
          style={CARD_SHADOW}
          title={
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-sm font-bold text-[var(--text)]">Historial de Ventas</span>
              <span className="text-[var(--border)]">|</span>
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                Canal de Venta:
                <select value={channel} onChange={(e) => setChannel(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--text)]">
                  {CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
          }
        >
          <div className="mb-1 flex items-baseline gap-2">
            <p className="text-[11.5px] text-[var(--text-muted)]">{daily ? "Promedio por día" : "Promedio por mes"}</p>
            <p className="text-base font-extrabold leading-tight sm:text-lg">{clp(avg)}</p>
          </div>
          <div className="flex items-end gap-0.5 sm:gap-1.5">
            {data.map((d, i) => {
              const h = Math.max((d.total / max) * 108, 4);
              const dense = data.length > 12;
              const current = i === data.length - 1;
              return (
                <div key={`${period}-${i}`} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg px-0.5 pb-1.5 pt-1 transition-colors hover:bg-[var(--brand-light)] sm:px-1">
                  <div className="relative flex h-32 w-full flex-col justify-end">
                    <span
                      className={dense
                        ? "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-white px-1.5 py-0.5 text-[10px] font-semibold opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100"
                        : "absolute inset-x-0 hidden truncate px-0.5 text-center text-[10px] font-semibold text-[var(--text-2)] sm:block"}
                      style={{ bottom: ready ? `${h + 4}px` : "4px", transition: dense ? "opacity 150ms" : `bottom 700ms ${i * 25}ms` }}>
                      ${compact.format(d.total)}
                    </span>
                    <div className="w-full rounded-t-md bg-[#b8ccfa] ease-out group-hover:bg-[#9fb9f7]"
                      style={{ height: ready ? `${h}px` : "0px", transition: `height 700ms ${i * 25}ms, background-color 150ms` }} />
                  </div>
                  <p className={`w-full truncate text-center text-[9px] capitalize leading-tight sm:text-xs ${current ? "font-semibold" : "text-[var(--text-muted)]"}`}
                    style={current ? { color: "var(--info)" } : undefined}>
                    {d.label}
                  </p>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          style={CARD_SHADOW}
          title={<span className="text-sm font-bold text-[var(--text)]">Ventas por Canal - Tienda</span>}
          actions={
            <div className="flex flex-wrap items-center gap-1 rounded-full bg-white p-1">
              {PERIODS.map((p) => (
                <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${period === p.key ? "bg-[var(--brand)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div className="relative h-28 w-28 shrink-0 sm:h-36 sm:w-36">
              <svg viewBox="0 0 36 36" className="h-full w-full">
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--border)" strokeWidth="3" />
                {segments.map((s, i) => (
                  <circle key={s.label} cx="18" cy="18" r="15.915" fill="none" stroke={s.color} strokeWidth="3"
                    strokeDasharray={ready ? `${s.pct} ${100 - s.pct}` : "0 100"} strokeDashoffset={s.offset}
                    style={{ transition: `stroke-dasharray 900ms cubic-bezier(.22,1,.36,1) ${i * 60}ms` }} />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold">{totalOrders.toLocaleString("es-CL")}</span>
                <span className="text-[11px] text-[var(--text-muted)]">ventas</span>
              </div>
            </div>
            <div className="max-h-[176px] w-full min-w-0 flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-[11px] text-[var(--text-muted)]">
                    <th className="pb-2 pr-2 text-left font-medium">Canal</th>
                    <th className="px-2 pb-2 text-right font-medium">Órdenes</th>
                    <th className="hidden px-2 pb-2 text-right font-medium sm:table-cell">Ticket prom</th>
                    <th className="pb-2 pl-2 text-right font-medium">Total neto</th>
                    <th className="w-7 pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)]">
                  {segments.map((s) => (
                    <tr key={s.label} className="group cursor-default transition-colors hover:bg-[var(--surface-soft)]">
                      <td className="py-2 pr-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                          <span className="truncate text-[var(--text-2)]">{s.label}</span>
                        </span>
                      </td>
                      <td className="px-2 text-right font-semibold">{s.count.toLocaleString("es-CL")}</td>
                      <td className="hidden px-2 text-right text-[var(--text-2)] sm:table-cell">{clp(s.ticket)}</td>
                      <td className="pl-2 text-right font-semibold text-emerald-600">{clp(s.count * s.ticket * s.net)}</td>
                      <td className="py-2 pl-2"><RowOpenIcon /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Órdenes urgentes + últimas ventas */}
      <div className="mt-2 hidden grid-cols-1 gap-2 md:grid lg:grid-cols-2">
        <SectionCard title="Órdenes urgentes" style={CARD_SHADOW} compactHeader
          actions={<span className="text-xs font-medium text-blue-500">Ver todas →</span>}>
          <div className="divide-y divide-[var(--border-soft)]">
            {URGENT.map(([st, id, name, ch, delivery]) => (
              <div key={id} className="group flex items-center gap-3 py-[5px]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold ${STATUS[st].color}`}>{STATUS[st].label}</span>
                    <span className="shrink-0 font-mono text-xs font-bold text-gray-600">#{id}</span>
                    <span className="truncate text-xs text-gray-600">{name}</span>
                    <span className="shrink-0 text-xs">{delivery ? "🚚" : "🏬"}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">{ch}</p>
                </div>
                <RowOpenIcon />
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Últimas ventas" style={CARD_SHADOW} compactHeader
          actions={<span className="text-xs font-medium text-blue-500">Ver todas →</span>}>
          <div className="divide-y divide-[var(--border-soft)]">
            {RECENT.map(([name, ch, time, total, img]) => (
              <div key={name} className="group flex items-center gap-3 py-[5px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 shrink-0 rounded-lg bg-blue-50 object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{name}</p>
                  <p className="truncate text-xs text-gray-400">{ch} · {time}</p>
                </div>
                <span className="shrink-0 text-sm font-bold text-gray-900">{clp(total)}</span>
                <RowOpenIcon />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
