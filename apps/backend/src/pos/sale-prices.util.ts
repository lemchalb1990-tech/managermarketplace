import { BadRequestException } from '@nestjs/common';

// Módulo por empresa: productos con precio variable que se confirma al cobrar.
export const VARIABLE_PRICE_MODULE = 'variable_price';

type PricedProduct = { id: string; name: string; price: unknown; variablePrice: boolean; minPrice: unknown | null };

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

// Venta directa del punto de venta: cada línea va al precio de catálogo, salvo los productos
// con precio variable (con el módulo activo), que llevan el precio real confirmado al cobrar:
// mayor que 0 y no menor al mínimo del producto, si lo tiene.
export function assertSalePrices(items: { productId: string; unitPrice: number }[], products: PricedProduct[], variablePriceEnabled: boolean) {
  for (const item of items) {
    const p = products.find((pr) => pr.id === item.productId);
    if (!p) continue;
    if (variablePriceEnabled && p.variablePrice) {
      if (!(item.unitPrice > 0)) throw new BadRequestException(`Ingresa el precio de venta de "${p.name}"`);
      const min = p.minPrice != null ? Number(p.minPrice) : null;
      if (min != null && item.unitPrice < min - 0.005) {
        throw new BadRequestException(`El precio de "${p.name}" (${clp(item.unitPrice)}) es menor al mínimo permitido (${clp(min)})`);
      }
      continue;
    }
    const listPrice = Number(p.price);
    if (Math.abs(item.unitPrice - listPrice) > 0.005) {
      throw new BadRequestException(`El precio de "${p.name}" no coincide con el del catálogo (${clp(listPrice)}). Actualiza la página e intenta de nuevo.`);
    }
  }
}
