// Reparte el total cobrado por un combo entre sus líneas, en proporción a su precio de
// referencia (weight × quantity). Devuelve el precio por unidad de cada línea, en pesos
// enteros siempre que se pueda: los pesos que sobran del redondeo los absorben primero las
// líneas de una unidad. Solo si todas las líneas tienen varias unidades y el resto no se
// puede repartir exacto, la última línea queda con decimales para que la suma cuadre.
export function splitComboTotal(
  lines: { id: string; quantity: number; weight: number }[],
  total: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!lines.length) return out;
  const target = Math.round(total);
  const weights = lines.map((l) => Math.max(0, l.weight) * l.quantity);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  // Sin precios de referencia: se reparte por cantidad de unidades.
  const shares = weightSum > 0 ? weights : lines.map((l) => l.quantity);
  const shareSum = shares.reduce((s, w) => s + w, 0);

  for (let i = 0; i < lines.length; i++) {
    out[lines[i].id] = Math.floor((target * shares[i]) / shareSum / lines[i].quantity);
  }
  let rest = target - lines.reduce((s, l) => s + out[l.id] * l.quantity, 0);
  const byQty = [...lines].sort((a, b) => a.quantity - b.quantity);
  for (const l of byQty) {
    if (rest <= 0) break;
    const add = Math.floor(rest / l.quantity);
    if (add > 0) {
      out[l.id] += add;
      rest -= add * l.quantity;
    }
  }
  if (rest > 0) {
    const last = byQty[byQty.length - 1];
    out[last.id] = Math.round((out[last.id] + rest / last.quantity) * 100) / 100;
  }
  return out;
}
