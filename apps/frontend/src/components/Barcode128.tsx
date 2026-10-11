// Código de barras Code 128 en SVG (sin librerías): lo leen todas las pistolas de bodega.
// Usa el subconjunto C (pares de dígitos, el más compacto) cuando el texto es numérico y de largo
// par; si no, el subconjunto B (texto ASCII imprimible).

// Anchos de barra/espacio de cada símbolo 0–106 (106 = parada, con la barra final de 2 módulos).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

// Símbolos del código (inicio + datos + verificador + parada).
export function code128Symbols(text: string): number[] {
  const useC = /^\d+$/.test(text) && text.length % 2 === 0;
  const data: number[] = [];
  if (useC) {
    for (let i = 0; i < text.length; i += 2) data.push(Number(text.slice(i, i + 2)));
  } else {
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error('Code 128 B solo admite caracteres ASCII imprimibles');
      data.push(code - 32);
    }
  }
  const start = useC ? START_C : START_B;
  const checksum = (start + data.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [start, ...data, checksum, STOP];
}

// Anchos alternados (barra, espacio, barra…) en módulos, con margen silencioso de 10 a cada lado.
export function code128Widths(text: string): number[] {
  return code128Symbols(text).flatMap((s) => PATTERNS[s].split('').map(Number));
}

export function Barcode128({ value, height = 48, module = 2, showText = true, className = '' }: {
  value: string; height?: number; module?: number; showText?: boolean; className?: string;
}) {
  const widths = code128Widths(value);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: Array<{ x: number; w: number }> = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  const textH = showText ? 14 : 0;
  return (
    <svg className={className} width={total * module} height={height + textH} viewBox={`0 0 ${total} ${height + textH}`}
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Código de barras ${value}`} shapeRendering="crispEdges">
      <rect width={total} height={height + textH} fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
      {showText && (
        <text x={total / 2} y={height + 11} textAnchor="middle" fontFamily="monospace" fontSize="11" fill="#000">{value}</text>
      )}
    </svg>
  );
}
