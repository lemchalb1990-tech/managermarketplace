"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { scheduleHref, trialHref, useContact } from "./contact";

export type PublicPlan = {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  priceFrom: boolean;
  implementationPrice: number | null;
  implementationFreeAnnual: boolean;
  maxChannels: number | null;
  maxProducts: number | null;
  maxUsers: number | null;
  maxWarehouses: number | null;
  features: string[];
  addons: string | null;
  isTrial: boolean;
  trialDays: number | null;
};

// Respaldo si la API no responde: los mismos planes con que parte el sistema.
export const DEFAULT_PLANS: PublicPlan[] = [
  { id: "plan_demo", name: "Demo", description: "Prueba gratis 15 días con todo lo de Crece.", monthlyPrice: 0, annualPrice: null, priceFrom: false, implementationPrice: null, implementationFreeAnnual: false, maxChannels: 5, maxProducts: 5000, maxUsers: 5, maxWarehouses: 3, features: ["POS", "PURCHASES"], addons: null, isTrial: true, trialDays: 15 },
  { id: "plan_emprende", name: "Emprende", description: "Para partir vendiendo en pocos canales.", monthlyPrice: 79000, annualPrice: 790000, priceFrom: false, implementationPrice: 120000, implementationFreeAnnual: true, maxChannels: 2, maxProducts: 1000, maxUsers: 2, maxWarehouses: 1, features: [], addons: null, isTrial: false, trialDays: null },
  { id: "plan_crece", name: "Crece", description: "Tiendas multicanal en crecimiento.", monthlyPrice: 179000, annualPrice: 1790000, priceFrom: false, implementationPrice: 290000, implementationFreeAnnual: false, maxChannels: 5, maxProducts: 5000, maxUsers: 5, maxWarehouses: 3, features: ["POS", "PURCHASES"], addons: null, isTrial: false, trialDays: null },
  { id: "plan_escala", name: "Escala", description: "Operación grande con bodega y despacho.", monthlyPrice: 349000, annualPrice: 3490000, priceFrom: false, implementationPrice: 490000, implementationFreeAnnual: false, maxChannels: 10, maxProducts: 20000, maxUsers: 15, maxWarehouses: null, features: ["POS", "PURCHASES", "PICKING"], addons: "1 a elección", isTrial: false, trialDays: null },
  { id: "plan_corporativo", name: "Corporativo", description: "A medida, sin límites y multiempresa.", monthlyPrice: 590000, annualPrice: null, priceFrom: true, implementationPrice: null, implementationFreeAnnual: false, maxChannels: null, maxProducts: null, maxUsers: null, maxWarehouses: null, features: ["POS", "PURCHASES", "PICKING", "MULTICOMPANY"], addons: "Todos", isTrial: false, trialDays: null },
];

const FEATURE_LABEL: Record<string, string> = {
  POS: "Punto de venta",
  PURCHASES: "Compras y proveedores",
  PICKING: "Picking y packing",
  MULTICOMPANY: "Multiempresa",
};

// Ícono de cada plan (por nombre; si es un plan nuevo, según su posición).
const PLAN_ICONS: Record<string, string> = {
  emprende: "M12 2c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10zM9 15l-2 5 3-1M15 15l2 5-3-1M12 9.5a1.5 1.5 0 1 0 0-.01",
  crece: "M3 17l6-6 4 4 8-8M14 7h7v7",
  escala: "M3 21V9l9-6 9 6v12M3 21h18M9 21v-6h6v6M8 11h.01M16 11h.01",
  corporativo: "M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h4a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4",
};
const ICON_ORDER = ["emprende", "crece", "escala", "corporativo"];
const planIcon = (name: string, i: number) => PLAN_ICONS[name.toLowerCase()] || PLAN_ICONS[ICON_ORDER[Math.min(i, 3)]];

const clp = (n: number) => `$${n.toLocaleString("es-CL")}`;
const limit = (n: number | null, one: string, many: string, fem = false) =>
  n == null ? `${many[0].toUpperCase()}${many.slice(1)} ${fem ? "ilimitadas" : "ilimitados"}` : `${n.toLocaleString("es-CL")} ${n === 1 ? one : many}`;

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Tabla para comparar los planes fila por fila (límites, módulos e implementación).
function CompareTable({ plans, featured }: { plans: PublicPlan[]; featured: string | null }) {
  const features = Array.from(new Set(plans.flatMap((p) => p.features)));
  const num = (n: number | null) => (n == null ? "Ilimitado" : n.toLocaleString("es-CL"));
  const rows: Array<[string, (p: PublicPlan) => ReactNode]> = [
    ["Canales de venta", (p) => num(p.maxChannels)],
    ["Productos", (p) => num(p.maxProducts)],
    ["Usuarios", (p) => num(p.maxUsers)],
    ["Bodegas", (p) => (p.maxWarehouses == null ? "Ilimitadas" : num(p.maxWarehouses))],
    ...features.map((f): [string, (p: PublicPlan) => ReactNode] => [
      FEATURE_LABEL[f] || f,
      (p) => (p.features.includes(f) ? <span className="text-[#0075de]"><Check /></span> : <span className="text-black/25">—</span>),
    ]),
    ["Módulos adicionales", (p) => p.addons || <span className="text-black/25">—</span>],
    ["Implementación", (p) => (p.implementationPrice != null ? clp(p.implementationPrice) : "A convenir")],
  ];
  return (
    <div className="lp-slide mt-4 overflow-x-auto rounded-[12px] bg-white" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
      <table className="w-full min-w-[640px] text-[14px]">
        <thead>
          <tr className="border-b border-black/[0.08]">
            <th className="px-4 py-3 text-left font-medium text-[#757575]" />
            {plans.map((p) => (
              <th key={p.id} className={`px-4 py-3 text-center font-bold ${p.id === featured ? "bg-[#02093a] text-white" : ""}`}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cell]) => (
            <tr key={label} className="border-b border-black/[0.05] last:border-0">
              <td className="px-4 py-2.5 text-[#615d59]">{label}</td>
              {plans.map((p) => (
                <td key={p.id} className={`px-4 py-2.5 text-center ${p.id === featured ? "bg-[#02093a]/[0.04] font-semibold" : ""}`}>
                  <span className="inline-flex items-center justify-center">{cell(p)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pricing({ plans }: { plans: PublicPlan[] }) {
  const [annual, setAnnual] = useState(false);
  const [compare, setCompare] = useState(false);
  // Todos los planes llevan a agendar con un ejecutivo (agenda configurada o WhatsApp).
  const contact = useContact();
  const talk = scheduleHref(contact);
  const trialLink = trialHref(contact);
  const trial = plans.find((p) => p.isTrial);
  const paid = plans.filter((p) => !p.isTrial);
  // Se destaca el plan del medio (el más elegido en la propuesta comercial).
  const featured = paid.length >= 3 ? paid[Math.floor((paid.length - 1) / 2)].id : null;
  const anyAnnual = paid.some((p) => p.annualPrice);

  return (
    <div>
      {anyAnnual && (
        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-full bg-white p-1 text-[14px] font-medium" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
            {[false, true].map((a) => (
              <button key={String(a)} type="button" onClick={() => setAnnual(a)}
                className={`rounded-full px-4 py-1.5 transition-colors duration-200 ${annual === a ? "bg-black text-white" : "text-black/60 hover:text-black"}`}>
                {a ? "Anual · 2 meses gratis" : "Mensual"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${paid.length + (trial ? 1 : 0) >= 5 ? "lg:grid-cols-3 xl:grid-cols-5" : paid.length + (trial ? 1 : 0) === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {/* Prueba gratis como una columna más, al inicio */}
        {trial && (
          <div className="relative flex flex-col rounded-[12px] bg-[#e6f3fe] p-6 text-[#02093a]" style={{ border: "1px solid rgba(0,117,222,0.18)" }}>
            <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-white text-[#0075de]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
              </svg>
            </span>
            <p className="text-[22px] font-bold tracking-[-0.011em]">{trial.name}</p>
            <p className="mt-1 text-[14px] leading-[1.43] text-[#02093a]/70">{trial.description || "Pruébalo sin costo antes de elegir tu plan."}</p>
            <div className="mt-5">
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-[34px] font-semibold tracking-[-0.03em]">Gratis</span>
                {trial.trialDays ? <span className="text-[14px] text-[#02093a]/60">por {trial.trialDays} días</span> : null}
              </p>
              <p className="mt-1 min-h-[1.4em] text-[12px] text-[#02093a]/60">Te la activa un ejecutivo</p>
            </div>
            <Link href={trialLink || "/login"} {...(trialLink?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="lp-btn lp-btn--primary mt-5 w-full">
              Solicitar versión de prueba
            </Link>
            <p className="mt-4 text-[13px] text-[#02093a]/70">
              {limit(trial.maxChannels, "canal", "canales")} · {limit(trial.maxProducts, "producto", "productos")}
            </p>
          </div>
        )}
        {paid.map((p, idx) => {
          const isFeatured = p.id === featured;
          const useAnnual = annual && p.annualPrice != null;
          const price = useAnnual ? Math.round(p.annualPrice! / 12) : p.monthlyPrice;
          return (
            <div key={p.id}
              className={`relative flex flex-col rounded-[12px] p-6 ${isFeatured ? "bg-[#02093a] text-white" : "bg-white"}`}
              style={isFeatured ? undefined : { border: "1px solid rgba(0,0,0,0.08)" }}>
              {isFeatured && (
                <span className="lp-tag absolute -top-3 left-6 bg-[#0075de] text-white">Más elegido</span>
              )}
              <span className={`mb-3 grid h-11 w-11 place-items-center rounded-xl ${isFeatured ? "bg-white/10 text-white" : "bg-[#eceef5] text-[#02093a]"}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={planIcon(p.name, idx)} />
                </svg>
              </span>
              <p className="text-[22px] font-bold tracking-[-0.011em]">{p.name}</p>
              {p.description && (
                <p className={`mt-1 text-[14px] leading-[1.43] ${isFeatured ? "text-white/65" : "text-[#615d59]"}`}>{p.description}</p>
              )}
              <div className="mt-5">
                {price != null ? (
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    {p.priceFrom && <span className={`text-[14px] ${isFeatured ? "text-white/65" : "text-[#757575]"}`}>Desde</span>}
                    <span className="text-[34px] font-semibold tracking-[-0.03em]">{clp(price)}</span>
                    <span className={`text-[14px] ${isFeatured ? "text-white/65" : "text-[#757575]"}`}>/ mes + IVA</span>
                  </p>
                ) : (
                  <p className="text-[28px] font-semibold tracking-[-0.03em]">A cotizar</p>
                )}
                <p className={`mt-1 min-h-[1.4em] text-[12px] ${isFeatured ? "text-white/55" : "text-[#757575]"}`}>
                  {useAnnual
                    ? `${clp(p.annualPrice!)} al año`
                    : p.implementationPrice != null
                      ? `Implementación ${clp(p.implementationPrice)}${p.implementationFreeAnnual ? " · gratis en plan anual" : ""}`
                      : ""}
                </p>
              </div>
              <Link href={talk || "/login"}
                {...(talk?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={`lp-btn mt-5 w-full ${isFeatured ? "lp-btn--light" : "lp-btn--soft"}`}>
                Agenda con un ejecutivo
              </Link>
              <p className={`mt-4 text-[13px] ${isFeatured ? "text-white/70" : "text-[#615d59]"}`}>
                {limit(p.maxChannels, "canal", "canales")} · {limit(p.maxProducts, "producto", "productos")}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex justify-center">
        <button type="button" onClick={() => setCompare((v) => !v)} aria-expanded={compare}
          className="lp-btn lp-btn--soft">
          {compare ? "Ocultar comparación" : "Ver comparación completa"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-300 ${compare ? "rotate-180" : ""}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      {compare && <CompareTable plans={paid} featured={featured} />}

      <p className="mt-4 text-center text-[13px] text-[#757575]">Valores en pesos chilenos. No incluyen IVA.</p>
    </div>
  );
}
