// Barra de avance con % para cualquier importación (catálogo, ventas, archivos).
// `percent` en 0-100; sin `percent` muestra la barra indeterminada.
export function ImportProgress({
  label,
  percent,
  detail,
  color = 'bg-blue-500',
}: {
  label: string;
  percent?: number;
  detail?: string;
  color?: string;
}) {
  const pct = percent === undefined ? undefined : Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{label}</span>
        {pct !== undefined && <span className="font-semibold text-gray-700">{pct}%</span>}
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-200 ${pct === undefined ? 'w-1/3 animate-pulse' : ''}`}
          style={pct === undefined ? undefined : { width: `${pct}%` }}
        />
      </div>
      {detail && <p className="text-xs text-gray-400">{detail}</p>}
    </div>
  );
}
