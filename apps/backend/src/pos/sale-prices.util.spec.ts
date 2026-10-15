import { BadRequestException } from '@nestjs/common';
import { assertSalePrices } from './sale-prices.util';

const fixed = { id: 'a', name: 'Fijo', price: '1000', variablePrice: false, minPrice: null };
const variable = { id: 'b', name: 'Variable', price: '5000', variablePrice: true, minPrice: '3000' };
const variableNoMin = { id: 'c', name: 'Sin piso', price: '2000', variablePrice: true, minPrice: null };
const products = [fixed, variable, variableNoMin];

describe('assertSalePrices', () => {
  it('acepta el precio de catálogo en productos sin precio variable', () => {
    expect(() => assertSalePrices([{ productId: 'a', unitPrice: 1000 }], products, true)).not.toThrow();
  });

  it('rechaza cambiar el precio de un producto sin precio variable', () => {
    expect(() => assertSalePrices([{ productId: 'a', unitPrice: 900 }], products, true)).toThrow(BadRequestException);
  });

  it('acepta un precio distinto en productos con precio variable sobre el mínimo', () => {
    expect(() => assertSalePrices([{ productId: 'b', unitPrice: 3500 }, { productId: 'c', unitPrice: 1 }], products, true)).not.toThrow();
  });

  it('rechaza precios bajo el mínimo o en cero', () => {
    expect(() => assertSalePrices([{ productId: 'b', unitPrice: 2999 }], products, true)).toThrow(/mínimo/);
    expect(() => assertSalePrices([{ productId: 'c', unitPrice: 0 }], products, true)).toThrow(/Ingresa el precio/);
  });

  it('sin el módulo, el precio variable no aplica y exige el precio de catálogo', () => {
    expect(() => assertSalePrices([{ productId: 'b', unitPrice: 3500 }], products, false)).toThrow(/catálogo/);
    expect(() => assertSalePrices([{ productId: 'b', unitPrice: 5000 }], products, false)).not.toThrow();
  });
});
