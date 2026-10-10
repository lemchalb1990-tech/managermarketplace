// Íconos de los indicadores del panel (reemplazan a los emojis): trazo simple, mismo estilo
// que los íconos de la landing.
const PATHS: Record<string, string> = {
  cart: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4',
  bank: 'M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  trendUp: 'M3 17l6-6 4 4 8-8M14 7h7v7',
  trendDown: 'M3 7l6 6 4-4 8 8M14 17h7v-7',
  chart: 'M3 3v18h18M7 15v2M11 11v6M15 7v10M19 12v5',
};

export function KpiIcon({ name, size = 22 }: { name: string; size?: number }) {
  const d = PATHS[name];
  if (!d) return <span aria-hidden="true">{name}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
