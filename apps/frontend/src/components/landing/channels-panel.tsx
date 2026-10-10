"use client";

import { useState, type ReactNode } from "react";
import { PRODUCT_IMG } from "./visuals";

const LINE = "1px solid rgba(0,0,0,0.08)";
const clp = (n: number) => `$${n.toLocaleString("es-CL")}`;

type Row = { key: string; name: string; price: number; on: boolean };
type Product = { name: string; img: string; stock: number; rows: Row[] };

// Cada producto con su precio propio por canal (como se configura en el panel).
const PRODUCTS: Product[] = [
  {
    name: "Zapatillas urbanas blancas", img: PRODUCT_IMG.zapatillas, stock: 24, rows: [
      { key: "mercadolibre", name: "Mercado Libre", price: 49990, on: true },
      { key: "falabella", name: "Falabella", price: 51990, on: true },
      { key: "paris", name: "Paris", price: 51990, on: true },
      { key: "ripley", name: "Ripley", price: 50990, on: true },
      { key: "walmart", name: "Walmart", price: 49990, on: false },
    ],
  },
  {
    name: "Polera oversize negra", img: PRODUCT_IMG.polera, stock: 58, rows: [
      { key: "mercadolibre", name: "Mercado Libre", price: 12990, on: true },
      { key: "falabella", name: "Falabella", price: 13490, on: true },
      { key: "paris", name: "Paris", price: 13490, on: false },
      { key: "ripley", name: "Ripley", price: 12990, on: true },
      { key: "walmart", name: "Walmart", price: 12990, on: true },
    ],
  },
  {
    name: "Mochila urbana 25 L", img: PRODUCT_IMG.mochila, stock: 17, rows: [
      { key: "mercadolibre", name: "Mercado Libre", price: 34990, on: true },
      { key: "falabella", name: "Falabella", price: 36990, on: true },
      { key: "paris", name: "Paris", price: 35990, on: true },
      { key: "ripley", name: "Ripley", price: 35990, on: false },
      { key: "walmart", name: "Walmart", price: 34990, on: false },
    ],
  },
  {
    name: "Polerón blanco", img: PRODUCT_IMG.poleron, stock: 31, rows: [
      { key: "mercadolibre", name: "Mercado Libre", price: 24990, on: true },
      { key: "falabella", name: "Falabella", price: 25990, on: true },
      { key: "paris", name: "Paris", price: 25990, on: true },
      { key: "ripley", name: "Ripley", price: 24990, on: true },
      { key: "walmart", name: "Walmart", price: 24990, on: true },
    ],
  },
];

/** Elige un producto y ve su precio, stock y estado en cada canal. */
export function ChannelsPanel({ logos }: { logos: Record<string, ReactNode> }) {
  const [sel, setSel] = useState(0);
  const p = PRODUCTS[sel];
  const live = p.rows.filter((r) => r.on).length;
  return (
    <div className="rounded-[12px] p-4 sm:p-6" style={{ background: "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)" }}>
      {/* Productos */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {PRODUCTS.map((x, i) => (
          <button key={x.name} type="button" onClick={() => setSel(i)} aria-pressed={i === sel} aria-label={x.name}
            className={`overflow-hidden rounded-[10px] bg-white transition ${i === sel ? "ring-2 ring-[#62aef0] ring-offset-2 ring-offset-[#02093a]" : "opacity-60 hover:opacity-100"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.img} alt="" loading="lazy" className="aspect-square w-full object-cover" />
          </button>
        ))}
      </div>

      {/* Detalle por canal del producto elegido */}
      <div key={sel} className="lp-slide mt-4 overflow-hidden rounded-[12px] bg-white text-black">
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: LINE }}>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{p.name}</p>
            <p className="text-[12px] text-[#757575]">{p.stock} en stock · publicado en {live} de {p.rows.length} canales</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#15803d]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#15803d]" /> Sincronizado
          </span>
        </div>
        <ul>
          {p.rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: LINE }}>
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white" style={{ border: LINE }}>
                <span className="absolute inset-0 overflow-hidden rounded-full [&>*]:h-full [&>*]:w-full [&>img]:rounded-full [&>img]:object-cover [&>svg]:scale-[1.7]">
                  {logos[r.key]}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.name}</span>
              <span className="w-[72px] text-right font-mono text-[13px] tabular-nums">{clp(r.price)}</span>
              <span className="hidden w-14 text-right font-mono text-[13px] tabular-nums text-[#615d59] sm:block">{r.on ? p.stock : "—"}</span>
              <span className={`w-[78px] rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${r.on ? "bg-green-50 text-green-700" : "bg-[#f6f5f4] text-[#757575]"}`}>
                {r.on ? "Publicado" : "Sin publicar"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
