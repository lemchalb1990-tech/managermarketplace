// Pie de las tarjetas del dashboard: mini gráfico de tendencia y variación contra el período
// anterior (ayer a la misma hora, o el mes anterior).

export type KpiTrendData = {
  values: number[];            // tendencia (último = período actual)
  current: number;
  previous: number | null;     // período de comparación
  label: string;               // "vs ayer", "vs septiembre"
  tooltip?: string;            // detalle al pasar el mouse
  goodWhenUp?: boolean;        // en gastos, subir es malo
};

export function KpiTrend({ values, current, previous, label, tooltip, goodWhenUp = true }: KpiTrendData) {
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  let delta: { text: string; tone: string } | null = null;
  if (previous != null) {
    if (previous === 0) {
      delta = current > 0 ? { text: 'Nuevo', tone: 'text-[#0075de]' } : { text: 'Sin cambios', tone: 'text-[var(--text-muted)]' };
    } else {
      const pct = ((current - previous) / Math.abs(previous)) * 100;
      const up = pct >= 0;
      const good = up === goodWhenUp;
      const tone = Math.abs(pct) < 0.5 ? 'text-[var(--text-muted)]' : good ? 'text-emerald-600' : 'text-red-600';
      delta = { text: `${up ? '▲' : '▼'} ${Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, tone };
    }
  }
  return (
    <div className="mt-2 flex items-end justify-between gap-2 border-t border-[var(--border-soft)] pt-2" title={tooltip}>
      {/* Barras de la tendencia: la última es el período actual */}
      <div className="hidden h-6 flex-1 items-end gap-[3px] sm:flex" aria-hidden="true">
        {values.map((v, i) => (
          <span key={i}
            className={`w-full max-w-[10px] rounded-sm ${i === values.length - 1 ? 'bg-[var(--brand)]' : 'bg-[#b6d1f6]'}`}
            style={{ height: `${Math.max(8, (Math.abs(v) / max) * 100)}%` }} />
        ))}
      </div>
      {delta && (
        <p className="shrink-0 whitespace-nowrap text-[11px] font-semibold leading-none">
          <span className={delta.tone}>{delta.text}</span>
          <span className="ml-1 font-medium text-[var(--text-muted)]">{label}</span>
        </p>
      )}
    </div>
  );
}
