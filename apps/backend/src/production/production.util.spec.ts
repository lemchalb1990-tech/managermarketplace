import { isMadeToOrder, isProcessService, isStockless, newTrackingToken } from './production.util';
import { readProductionSettings } from './production-config.service';

describe('reglas de fabricación', () => {
  const articulo = { type: 'ARTICULO', dropship: false, supplyMode: 'STOCK', requiresProcess: false };

  it('un artículo de inventario descuenta stock', () => {
    expect(isStockless(articulo, true)).toBe(false);
    expect(isMadeToOrder(articulo, true)).toBe(false);
  });

  it('a pedido no descuenta stock solo con el módulo activo', () => {
    const p = { ...articulo, supplyMode: 'MADE_TO_ORDER' };
    expect(isMadeToOrder(p, true)).toBe(true);
    expect(isStockless(p, true)).toBe(true);
    expect(isMadeToOrder(p, false)).toBe(false);
    expect(isStockless(p, false)).toBe(false);
  });

  it('fabricación para stock se vende como un artículo normal', () => {
    const p = { ...articulo, supplyMode: 'MADE_FOR_STOCK' };
    expect(isStockless(p, true)).toBe(false);
    expect(isMadeToOrder(p, true)).toBe(false);
  });

  it('servicio con proceso abre orden; servicio y dropship nunca descuentan stock', () => {
    const servicio = { ...articulo, type: 'SERVICIO', requiresProcess: true };
    expect(isProcessService(servicio, true)).toBe(true);
    expect(isProcessService(servicio, false)).toBe(false);
    expect(isStockless(servicio, false)).toBe(true);
    expect(isStockless({ ...articulo, dropship: true }, false)).toBe(true);
    // Un servicio marcado «a pedido» por error no cuenta como fabricado.
    expect(isMadeToOrder({ ...servicio, supplyMode: 'MADE_TO_ORDER' }, true)).toBe(false);
  });

  it('el token de seguimiento es aleatorio y apto para URL', () => {
    const a = newTrackingToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a).not.toBe(newTrackingToken());
  });
});

describe('ajustes de fabricación', () => {
  it('por defecto descuenta materiales por etapa y no bloquea por saldo', () => {
    expect(readProductionSettings(null)).toEqual({ consumeMaterialsAt: 'STAGE', blockDispatchWithBalance: false, notifications: { email: false, whatsapp: false } });
  });

  it('los avisos automáticos quedan apagados aunque se intenten activar', () => {
    const s = readProductionSettings({ consumeMaterialsAt: 'END', blockDispatchWithBalance: true, notifications: { email: true, whatsapp: true } });
    expect(s.consumeMaterialsAt).toBe('END');
    expect(s.blockDispatchWithBalance).toBe(true);
    expect(s.notifications).toEqual({ email: false, whatsapp: false });
  });
});
