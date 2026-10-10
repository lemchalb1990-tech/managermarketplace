"use client";

import { useState } from "react";
import Link from "next/link";

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

const clp = (n: number) => `$${n.toLocaleString("es-CL")}`;
const limit = (n: number | null, one: string, many: string) =>
  n == null ? `${many[0].toUpperCase()}${many.slice(1)} ilimitados` : `${n.toLocaleString("es-CL")} ${n === 1 ? one : many}`;

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Pricing({ plans }: { plans: PublicPlan[] }) {
  const [annual, setAnnual] = useState(false);
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

      <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${paid.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {paid.map((p) => {
          const isFeatured = p.id === featured;
          const useAnnual = annual && p.annualPrice != null;
          const price = useAnnual ? Math.round(p.annualPrice! / 12) : p.monthlyPrice;
          const items = [
            limit(p.maxChannels, "canal de venta", "canales de venta"),
            limit(p.maxProducts, "producto", "productos"),
            limit(p.maxUsers, "usuario", "usuarios"),
            limit(p.maxWarehouses, "bodega", "bodegas"),
            ...p.features.map((f) => FEATURE_LABEL[f] || f),
            ...(p.addons ? [`Módulos adicionales: ${p.addons.toLowerCase()}`] : []),
          ];
          return (
            <div key={p.id}
              className={`relative flex flex-col rounded-[12px] p-6 ${isFeatured ? "bg-[#02093a] text-white" : "bg-white"}`}
              style={isFeatured ? undefined : { border: "1px solid rgba(0,0,0,0.08)" }}>
              {isFeatured && (
                <span className="lp-tag absolute -top-3 left-6 bg-[#0075de] text-white">Más elegido</span>
              )}
              <p className="text-[22px] font-bold tracking-[-0.011em]">{p.name}</p>
              {p.description && (
                <p className={`mt-1 min-h-[2.6em] text-[14px] leading-[1.43] ${isFeatured ? "text-white/65" : "text-[#615d59]"}`}>{p.description}</p>
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
              <Link href="/login"
                className={`lp-btn mt-5 w-full ${isFeatured ? "lp-btn--primary" : "lp-btn--soft"}`}>
                {p.priceFrom ? "Conversemos" : "Empezar"}
              </Link>
              <ul className="mt-6 space-y-2 text-[14px]">
                {items.map((it) => (
                  <li key={it} className="flex items-start gap-2">
                    <span className={`mt-0.5 ${isFeatured ? "text-[#62aef0]" : "text-[#0075de]"}`}><Check /></span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {trial && (
        <div className="mt-4 flex flex-col gap-4 rounded-[12px] bg-[#e6f3fe] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[20px] font-bold tracking-[-0.011em] text-[#02093a]">
              Prueba gratis{trial.trialDays ? ` ${trial.trialDays} días` : ""}
            </p>
            <p className="mt-1 text-[15px] text-[#02093a]/70">{trial.description || "Pruébalo sin costo antes de elegir tu plan."}</p>
          </div>
          <Link href="/login" className="lp-btn lp-btn--primary shrink-0 self-start sm:self-auto">
            Empezar la prueba
          </Link>
        </div>
      )}
      <p className="mt-4 text-center text-[13px] text-[#757575]">Valores en pesos chilenos. No incluyen IVA.</p>
    </div>
  );
}
