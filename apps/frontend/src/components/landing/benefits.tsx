"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PRODUCT_IMG } from "./visuals";

const LINE = "1px solid rgba(0,0,0,0.08)";
const NAVY = "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)";
const clp = (n: number) => `$${n.toLocaleString("es-CL")}`;

function Photo({ src, className = "" }: { src: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className={`shrink-0 rounded-lg object-cover ${className}`} style={{ border: LINE }} />;
}

function Card({ title, text, dark = false, className = "", children }: {
  title: string; text: string; dark?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-[12px] p-4 sm:p-5 ${dark ? "text-white" : "bg-white"} ${className}`}
      style={dark ? { background: NAVY } : { border: LINE }}>
      <p className={`font-bold tracking-[-0.015em] ${dark ? "text-[22px] leading-[1.15]" : "text-[17px] leading-[1.25]"}`}>{title}</p>
      <p className={`mt-1 text-[13px] leading-[1.45] ${dark ? "text-white/65" : "text-[#615d59]"}`}>{text}</p>
      <div className="mt-3 flex-1">{children}</div>
    </div>
  );
}

/* 1. Stock sincronizado: se simula una venta y baja en todos los canales */
function StockDemo() {
  const channels = ["Mercado Libre", "Falabella", "Paris", "Ripley", "Walmart"];
  const [stock, setStock] = useState(32);
  const [hit, setHit] = useState<number | null>(null);
  const [n, setN] = useState(0);
  function sell() {
    if (stock <= 0) { setStock(32); setHit(null); return; }
    setStock((s) => s - 1);
    setHit(Math.floor(Math.random() * channels.length));
    setN((x) => x + 1);
  }
  return (
    <div className="rounded-[10px] bg-white p-4 text-black">
      <div className="flex items-center gap-3">
        <Photo src={PRODUCT_IMG.polera} className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">Polera oversize negra</p>
          <p className="text-[12px] text-[#757575]">{hit != null ? `Venta en ${channels[hit]}` : "Stock en todos tus canales"}</p>
        </div>
        <span key={stock} className="lp-pop font-mono text-[34px] font-semibold leading-none tabular-nums">{stock}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {channels.map((c, i) => (
          <span key={`${c}-${n}`} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${i === hit ? "lp-pop bg-[#0075de] text-white" : "bg-[#f6f5f4] text-[#615d59]"}`}>
            {c} <span className="font-mono font-semibold tabular-nums">{stock}</span>
          </span>
        ))}
      </div>
      <button type="button" onClick={sell}
        className="mt-3 w-full rounded-lg bg-[#02093a] py-2 text-[13px] font-semibold text-white transition hover:bg-[#0b1d5c]">
        {stock > 0 ? "Simular una venta" : "Reponer stock"}
      </button>
    </div>
  );
}

/* 2. Pedidos en una lista, con filtro de atrasados */
function OrdersDemo() {
  const orders = [
    { img: PRODUCT_IMG.zapatillas, n: "#2000098", c: "Flex", t: "12:00", late: false },
    { img: PRODUCT_IMG.mochila, n: "#88213", c: "Falabella", t: "14:00", late: true },
    { img: PRODUCT_IMG.polera, n: "#77120", c: "Paris", t: "15:30", late: false },
    { img: PRODUCT_IMG.jockey, n: "#A4F21", c: "Retiro", t: "18:00", late: true },
  ];
  const [onlyLate, setOnlyLate] = useState(false);
  const list = orders.filter((o) => !onlyLate || o.late);
  return (
    <div>
      <div className="inline-flex rounded-lg bg-[#f6f5f4] p-0.5 text-[12px] font-medium">
        {[false, true].map((v) => (
          <button key={String(v)} type="button" onClick={() => setOnlyLate(v)}
            className={`rounded-md px-3 py-1 transition ${onlyLate === v ? "bg-white shadow-sm" : "text-[#757575]"}`}>
            {v ? "Atrasados (2)" : "Todos (4)"}
          </button>
        ))}
      </div>
      <ul className="mt-2 min-h-[148px] space-y-1">
        {list.map((o) => (
          <li key={o.n} className="lp-slide flex items-center gap-2 rounded-lg px-2 py-1" style={{ border: LINE }}>
            <Photo src={o.img} className="h-7 w-7" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{o.n} · {o.c}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.late ? "bg-red-50 text-red-600" : "bg-[#f6f5f4] text-[#615d59]"}`}>
              {o.late ? "Atrasado" : `Corte ${o.t}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 3. Boleta automática: cada venta emite su documento */
const DOCS: Array<[string, string, number]> = [
  [PRODUCT_IMG.zapatillas, "Zapatillas urbanas blancas", 49990],
  [PRODUCT_IMG.polera, "Polera oversize negra", 12990],
  [PRODUCT_IMG.jockey, "Jockey blanco", 8990],
  [PRODUCT_IMG.poleron, "Polerón blanco", 24990],
];
function InvoiceDemo() {
  const [folio, setFolio] = useState(4520);
  const [fresh, setFresh] = useState(false);
  return (
    <div>
      <div className="space-y-1.5">
        {[folio, folio - 1].map((f, i) => {
          const item = DOCS[f % DOCS.length];
          return (
            <div key={f} className={`${fresh && i === 0 ? "lp-slide" : ""} rounded-lg p-2.5 ${i === 1 ? "opacity-60" : ""}`} style={{ border: LINE }}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold">Boleta N° {f}</span>
                <span className="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">Aceptada SII</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Photo src={item[0]} className="h-7 w-7" />
                <span className="flex-1 truncate text-[12px] text-[#615d59]">{item[1]}</span>
                <span className="font-mono text-[12px] font-semibold">{clp(item[2])}</span>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => { setFolio((f) => f + 1); setFresh(true); }}
        className="mt-2 w-full rounded-lg bg-[#02093a] py-2 text-[13px] font-semibold text-white transition hover:bg-[#0b1d5c]">
        Vender y emitir
      </button>
    </div>
  );
}

/* 4. Ganancia real: se puede ver cada parte del precio */
function ProfitDemo() {
  const price = 24990;
  const parts: Array<[string, number, string]> = [
    ["Comisión", 0.14, "#02093a"], ["Envío", 0.06, "#62aef0"], ["Costo", 0.23, "#c9c6c0"], ["Ganancia", 0.57, "#0075de"],
  ];
  const [sel, setSel] = useState(3);
  return (
    <div>
      <div className="flex items-center gap-3">
        <Photo src={PRODUCT_IMG.poleron} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">Polerón blanco</p>
          <p className="text-[12px] text-[#757575]">Venta neta {clp(Math.round(price / 1.19))}</p>
        </div>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full">
        {parts.map(([k, v, c], i) => (
          <button key={k} type="button" aria-label={k} onMouseEnter={() => setSel(i)} onClick={() => setSel(i)}
            className={`h-full transition-opacity ${sel === i ? "" : "opacity-50"}`} style={{ width: `${v * 100}%`, background: c }} />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-1.5 text-[12px]">
        {parts.map(([k, v, c], i) => (
          <li key={k}>
            <button type="button" onMouseEnter={() => setSel(i)} onClick={() => setSel(i)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition ${sel === i ? "bg-[#f6f5f4] font-semibold" : "text-[#615d59]"}`}>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c }} />{k}
              <span className="ml-auto font-mono">{clp(Math.round((price / 1.19) * v))}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 5. Fotos revisadas con IA: foto correcta o equivocada */
function PhotoAiDemo() {
  const [wrong, setWrong] = useState(false);
  const [scanning, setScanning] = useState(false);
  function check(w: boolean) {
    setWrong(w);
    setScanning(true);
    window.setTimeout(() => setScanning(false), 900);
  }
  return (
    <div>
      <p className="text-[12px] text-[#757575]">Título: <span className="font-medium text-black">Zapatillas urbanas blancas</span></p>
      <div className="relative mt-2 overflow-hidden rounded-lg" style={{ border: LINE }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wrong ? PRODUCT_IMG.jockey : PRODUCT_IMG.zapatillas} alt="" className="aspect-[3/1] w-full object-cover" />
        {scanning && <span className="lp-scan pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-[#0075de]/35 to-transparent" />}
        {!scanning && (
          <span className={`lp-slide absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${wrong ? "bg-red-600" : "bg-green-600"}`}>
            {wrong ? "✕ No coincide: parece un jockey" : "✓ Coincide con el título"}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[12px] font-medium">
        <button type="button" onClick={() => check(false)} className={`rounded-lg py-1.5 ${!wrong ? "bg-[#02093a] text-white" : "bg-[#f6f5f4]"}`}>Foto correcta</button>
        <button type="button" onClick={() => check(true)} className={`rounded-lg py-1.5 ${wrong ? "bg-[#02093a] text-white" : "bg-[#f6f5f4]"}`}>Foto equivocada</button>
      </div>
    </div>
  );
}

/* 6. Reclamos: cuenta regresiva real y respuesta desde el panel */
function ClaimDemo() {
  const [left, setLeft] = useState(2 * 86400 + 5 * 3600 + 12 * 60);
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (answered) return;
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [answered]);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-3 rounded-lg p-2.5" style={{ border: LINE }}>
        <Photo src={PRODUCT_IMG.mochila} className="h-12 w-12" />
        <div className="min-w-0">
          <p className="text-[12px] text-[#757575]">Reclamo N° 5284019 · Mercado Libre</p>
          <p className="truncate text-[14px] font-medium">“La mochila llegó con el cierre roto”</p>
        </div>
      </div>
      {answered ? (
        <span className="lp-slide rounded-lg bg-green-50 px-4 py-3 text-center text-[13px] font-semibold text-green-700">✓ Respondido a tiempo</span>
      ) : (
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-lg bg-[#02093a] px-4 py-2 text-white">
            <p className="text-[11px] text-white/60">Tiempo para responder</p>
            <p className="font-mono text-[18px] font-semibold tabular-nums">{d}d {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</p>
          </div>
          <button type="button" onClick={() => setAnswered(true)}
            className="rounded-lg bg-[#02093a] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-[#0b1d5c]">
            Responder
          </button>
        </div>
      )}
    </div>
  );
}

/** Beneficios con menos texto: cada tarjeta se entiende probándola. */
export function Benefits() {
  return (
    <div className="ui-reveal mt-8 grid gap-4 md:grid-cols-2 lg:mt-10 lg:grid-cols-4">
      <Card dark className="md:col-span-2" title="Nunca vendes lo que no tienes" text="Una venta descuenta el stock en todos tus canales.">
        <StockDemo />
      </Card>
      <Card title="Pedidos en una lista" text="Por transportista y hora de corte.">
        <OrdersDemo />
      </Card>
      <Card title="Boleta automática" text="Se emite en el mismo paso de la venta.">
        <InvoiceDemo />
      </Card>
      <Card title="Ganancia real" text="Neto, comisión, envío y costo.">
        <ProfitDemo />
      </Card>
      <Card title="Fotos revisadas con IA" text="Antes de publicar en Mercado Libre.">
        <PhotoAiDemo />
      </Card>
      <Card className="md:col-span-2" title="Reclamos sin perder plazos" text="Cada reclamo con su fecha límite.">
        <ClaimDemo />
      </Card>
    </div>
  );
}
