import {
  addPayload, daysBetween, deleteQuery, estimate, friendlyError, minPriceForMargin, priceRange, promoKeyOf, propose, topPriceFor, validateApply,
} from './ml-promotions.logic';

describe('promociones ML: cálculo de precios y márgenes', () => {
  it('estima la ganancia sin IVA con comisión y costo', () => {
    // 11.900 con IVA → 10.000 neto; comisión 13% = 1.547 → 1.300 neto; costo 5.950 → 5.000 neto.
    const e = estimate({ price: 11900, cost: 5950, feePct: 13, feeFixed: 0 });
    expect(e.revenue).toBe(10000);
    expect(e.fee).toBe(1300);
    expect(e.cost).toBe(5000);
    expect(e.profit).toBe(3700);
    expect(e.marginPct).toBe(37);
  });

  it('suma la bonificación de ML en las co-fondeadas', () => {
    const e = estimate({ price: 7000, originalPrice: 10000, meliPct: 10, cost: null });
    expect(e.revenue).toBe(Math.round((8000 / 1.19) * 100) / 100);
    expect(e.profit).toBeNull();
  });

  it('descuento porcentual dentro del rango', () => {
    const p = propose({ type: 'PRICE_DISCOUNT', originalPrice: 10000, mode: 'PERCENT', percent: 15, cost: 4000, feePct: 13 });
    expect(p.price).toBe(8500);
    expect(p.discountPct).toBe(15);
    expect(p.status).toBe('ok');
  });

  it('ajusta al mínimo que permite ML y avisa', () => {
    const p = propose({ type: 'DEAL', originalPrice: 10000, minPrice: 7000, maxPrice: 9500, mode: 'PERCENT', percent: 50, cost: 2000, feePct: 13 });
    expect(p.price).toBe(7000);
    expect(p.status).toBe('warn');
  });

  it('ajusta al máximo creíble cuando el descuento es muy chico', () => {
    const p = propose({ type: 'DEAL', originalPrice: 10000, minPrice: 7000, maxPrice: 9500, mode: 'PERCENT', percent: 2, cost: 2000, feePct: 13 });
    expect(p.price).toBe(9500);
  });

  it('rango invertido (oferta del día) se ordena', () => {
    expect(priceRange({ type: 'DOD', originalPrice: 4000, minPrice: 3960, maxPrice: 1200 })).toEqual({ lo: 1200, hi: 3960 });
  });

  it('descuento individual sin rango usa 5%–80%', () => {
    expect(priceRange({ type: 'PRICE_DISCOUNT', originalPrice: 10000 })).toEqual({ lo: 2000, hi: 9500 });
  });

  it('mayor descuento que respeta el margen mínimo', () => {
    const floor = minPriceForMargin(5000, 20, 13, 0)!;
    // (p − 0,13p − 5000) / p ≥ 0,20 → p ≥ 5000 / 0,67
    expect(floor).toBe(Math.ceil(5000 / 0.67));
    const p = propose({ type: 'PRICE_DISCOUNT', originalPrice: 12000, mode: 'BEST_MARGIN', minMarginPct: 20, cost: 5000, feePct: 13 });
    expect(p.price).toBe(floor);
    expect(p.estimate!.marginPct!).toBeGreaterThanOrEqual(20 - 0.01);
  });

  it('marca error si el margen pedido no cabe en el rango de ML', () => {
    const p = propose({ type: 'PRICE_DISCOUNT', originalPrice: 6000, mode: 'BEST_MARGIN', minMarginPct: 30, cost: 5000, feePct: 13 });
    expect(p.status).toBe('error');
  });

  it('error si se vende con pérdida', () => {
    const p = propose({ type: 'PRICE_DISCOUNT', originalPrice: 10000, mode: 'PERCENT', percent: 50, cost: 6000, feePct: 13 });
    expect(p.status).toBe('error');
    expect(p.messages.join(' ')).toMatch(/Pierdes/);
  });

  it('error bajo el margen mínimo', () => {
    const p = propose({ type: 'PRICE_DISCOUNT', originalPrice: 10000, mode: 'PERCENT', percent: 30, cost: 5000, feePct: 13, minMarginPct: 20 });
    expect(p.status).toBe('error');
  });

  it('advierte sin costo', () => {
    const p = propose({ type: 'PRICE_DISCOUNT', originalPrice: 10000, mode: 'PERCENT', percent: 10 });
    expect(p.status).toBe('warn');
    expect(p.estimate!.profit).toBeNull();
  });

  it('co-fondeada usa el precio de ML', () => {
    const p = propose({ type: 'MARKETPLACE_CAMPAIGN', originalPrice: 10000, mlPrice: 7000, meliPct: 5, mode: 'PERCENT', percent: 1, cost: 3000, feePct: 13 });
    expect(p.price).toBe(7000);
    expect(p.status).toBe('ok');
  });

  it('precio para compradores leales respeta la diferencia mínima', () => {
    expect(topPriceFor(10000, 8500, 3).error).toBeTruthy();
    expect(topPriceFor(10000, 8500, 5).topPrice).toBe(8000);
    expect(topPriceFor(10000, 6000, 5).error).toBeTruthy(); // general 40% → mínimo 10 puntos
    expect(topPriceFor(10000, 6000, 10).topPrice).toBe(5000);
  });

  it('arma los payloads según el tipo', () => {
    expect(addPayload({ type: 'PRICE_DISCOUNT', price: 8500, startDate: '2026-10-12', finishDate: '2026-10-20' }))
      .toEqual({ promotion_type: 'PRICE_DISCOUNT', deal_price: 8500, start_date: '2026-10-12T00:00:00', finish_date: '2026-10-20T00:00:00' });
    expect(addPayload({ type: 'SMART', promotionId: 'P-1', offerId: 'CANDIDATE-1' }))
      .toEqual({ promotion_type: 'SMART', promotion_id: 'P-1', offer_id: 'CANDIDATE-1' });
    expect(addPayload({ type: 'LIGHTNING', price: 9000, stock: 3 })).toEqual({ promotion_type: 'LIGHTNING', deal_price: 9000, stock: 3 });
    expect(addPayload({ type: 'DEAL', promotionId: 'P-2', price: 9000, topPrice: 8000 }))
      .toEqual({ promotion_type: 'DEAL', promotion_id: 'P-2', deal_price: 9000, top_deal_price: 8000 });
  });

  it('arma el query para quitar', () => {
    expect(deleteQuery({ type: 'PRICE_DISCOUNT' })).toBe('promotion_type=PRICE_DISCOUNT&app_version=v2');
    expect(deleteQuery({ type: 'MARKETPLACE_CAMPAIGN', promotionId: 'P-1', offerId: 'OFFER-1' }))
      .toBe('promotion_type=MARKETPLACE_CAMPAIGN&app_version=v2&promotion_id=P-1&offer_id=OFFER-1');
    expect(deleteQuery({ type: 'SELLER_CAMPAIGN', promotionId: 'C-1', offerId: 'x' })).toBe('promotion_type=SELLER_CAMPAIGN&app_version=v2&promotion_id=C-1');
  });

  it('valida antes de aplicar', () => {
    expect(validateApply({ type: 'PRICE_DISCOUNT', price: 9800, originalPrice: 10000, startDate: '2026-10-12', finishDate: '2026-10-13' })).toMatch(/5%/);
    expect(validateApply({ type: 'PRICE_DISCOUNT', price: 9000, originalPrice: 10000, startDate: '2026-10-01', finishDate: '2026-10-20' })).toMatch(/14 días/);
    expect(validateApply({ type: 'PRICE_DISCOUNT', price: 9000, originalPrice: 10000, startDate: '2026-10-01', finishDate: '2026-10-14' })).toBeNull();
    expect(validateApply({ type: 'LIGHTNING', price: 9000, originalPrice: 10000, stock: 1, stockMin: 2 })).toMatch(/al menos 2/);
    expect(validateApply({ type: 'SMART', promotionId: 'P-1' })).toMatch(/offer_id/);
  });

  it('cuenta los días incluyendo inicio y fin', () => {
    expect(daysBetween('2026-10-01', '2026-10-14')).toBe(14);
  });

  it('clave de la promoción', () => {
    expect(promoKeyOf('PRICE_DISCOUNT', 'P-9')).toBe('PRICE_DISCOUNT');
    expect(promoKeyOf('DEAL', 'P-9')).toBe('P-9');
  });

  it('traduce errores de ML', () => {
    expect(friendlyError('The price is not credible.')).toMatch(/creíble/);
    expect(friendlyError('The name already exists.')).toMatch(/nombre/);
  });
});
