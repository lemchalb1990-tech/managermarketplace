// Reglas de negocio de las promociones de Mercado Libre (/seller-promotions, app_version=v2),
// sin acceso a la base ni a la API, para poder probarlas por separado.
//
// Montos en pesos CON IVA (como los muestra ML); la ganancia se informa SIN IVA, igual que el
// desglose de ventas (ver sale-breakdown.ts). Product.cost viene con IVA.

import { sinIva, round2 } from '../platforms/sale-breakdown';

export const PROMO_TYPES = [
  'PRICE_DISCOUNT', 'SELLER_CAMPAIGN', 'VOLUME', 'DEAL', 'MARKETPLACE_CAMPAIGN', 'SMART', 'PRICE_MATCHING',
  'PRE_NEGOTIATED', 'UNHEALTHY_STOCK', 'DOD', 'LIGHTNING',
] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

type TypeMeta = {
  label: string;
  // SELLER: el vendedor define el precio dentro del rango de ML. ML: precio/descuento fijado por ML (solo se acepta).
  pricing: 'SELLER' | 'ML';
  // Origen: invitación de ML o promoción creada por el vendedor.
  origin: 'INVITATION' | 'OWN';
  // Acepta precio para compradores leales (Mercado Puntos 3 a 6).
  top: boolean;
  // Requiere stock reservado (oferta relámpago).
  stock: boolean;
  // Se acepta con el offer_id del candidato.
  offer: boolean;
  // Una vez activa, ML no permite quitarla (solo pausar la publicación).
  lockedWhenStarted: boolean;
  // Para editarla hay que quitarla y volver a aplicarla.
  editByReapply: boolean;
};

export const TYPE_META: Record<PromoType, TypeMeta> = {
  PRICE_DISCOUNT: { label: 'Descuento individual', pricing: 'SELLER', origin: 'OWN', top: true, stock: false, offer: false, lockedWhenStarted: false, editByReapply: true },
  SELLER_CAMPAIGN: { label: 'Campaña del vendedor', pricing: 'SELLER', origin: 'OWN', top: true, stock: false, offer: false, lockedWhenStarted: false, editByReapply: false },
  VOLUME: { label: 'Descuento por cantidad', pricing: 'ML', origin: 'OWN', top: false, stock: false, offer: false, lockedWhenStarted: false, editByReapply: false },
  DEAL: { label: 'Campaña tradicional', pricing: 'SELLER', origin: 'INVITATION', top: true, stock: false, offer: false, lockedWhenStarted: false, editByReapply: false },
  MARKETPLACE_CAMPAIGN: { label: 'Campaña co-fondeada', pricing: 'ML', origin: 'INVITATION', top: false, stock: false, offer: false, lockedWhenStarted: false, editByReapply: false },
  SMART: { label: 'Co-fondeada automatizada', pricing: 'ML', origin: 'INVITATION', top: false, stock: false, offer: true, lockedWhenStarted: false, editByReapply: false },
  PRICE_MATCHING: { label: 'Precios competitivos', pricing: 'ML', origin: 'INVITATION', top: false, stock: false, offer: true, lockedWhenStarted: false, editByReapply: false },
  PRE_NEGOTIATED: { label: 'Descuento pre-acordado', pricing: 'ML', origin: 'INVITATION', top: false, stock: false, offer: true, lockedWhenStarted: false, editByReapply: false },
  UNHEALTHY_STOCK: { label: 'Liquidación stock Full', pricing: 'ML', origin: 'INVITATION', top: false, stock: false, offer: true, lockedWhenStarted: false, editByReapply: false },
  DOD: { label: 'Oferta del día', pricing: 'SELLER', origin: 'INVITATION', top: false, stock: false, offer: false, lockedWhenStarted: true, editByReapply: true },
  LIGHTNING: { label: 'Oferta relámpago', pricing: 'SELLER', origin: 'INVITATION', top: false, stock: true, offer: false, lockedWhenStarted: true, editByReapply: true },
};

export const isPromoType = (t: unknown): t is PromoType => PROMO_TYPES.includes(t as PromoType);

// Estados en que la publicación está (o quedará) con la promoción.
export const ACTIVE_STATUSES = ['started', 'pending', 'sync_requested'];
export const isActiveStatus = (s?: string | null) => ACTIVE_STATUSES.includes(String(s || '').toLowerCase());

// Duración máxima que ML permite a las promociones que crea el vendedor.
export const MAX_OWN_DAYS = 14;
// Descuento individual: entre 5% y 80%.
export const PRICE_DISCOUNT_MIN_PCT = 5;
export const PRICE_DISCOUNT_MAX_PCT = 80;

// Clave de la promoción dentro de la publicación: el id de la campaña, o el tipo cuando no tiene
// (el descuento individual es uno solo por publicación).
export function promoKeyOf(type: string, promotionId?: string | null) {
  return type === 'PRICE_DISCOUNT' ? 'PRICE_DISCOUNT' : String(promotionId || type);
}

export const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const discountPct = (original: number | null | undefined, price: number | null | undefined) =>
  original && price != null && original > 0 ? round2((1 - price / original) * 100) : null;

// Comisión de ML (con IVA) a un precio dado: porcentaje + cargo fijo.
export function feeAt(price: number, feePct: number | null | undefined, feeFixed: number | null | undefined) {
  if (feePct == null) return null;
  return Math.round(price * (feePct / 100) + (feeFixed || 0));
}

export type Estimate = {
  revenue: number;       // lo que recibe el vendedor por la venta, sin IVA (precio + bonificación de ML)
  fee: number | null;    // comisión sin IVA (null si no se conoce)
  cost: number | null;   // costo sin IVA (null si el producto no tiene costo)
  profit: number | null; // revenue − fee − cost (null sin costo)
  marginPct: number | null;
};

// Ganancia estimada vendiendo a `price`. En las co-fondeadas ML devuelve su parte del
// descuento (meliPct sobre el precio original), así que suma al ingreso. No incluye el envío.
export function estimate(o: {
  price: number; originalPrice?: number | null; meliPct?: number | null;
  cost?: number | null; feePct?: number | null; feeFixed?: number | null;
}): Estimate {
  const bonus = o.meliPct && o.originalPrice ? (o.originalPrice * o.meliPct) / 100 : 0;
  const revenue = sinIva(o.price + bonus);
  const feeGross = feeAt(o.price, o.feePct, o.feeFixed);
  const fee = feeGross != null ? sinIva(feeGross) : null;
  const cost = o.cost != null && o.cost > 0 ? sinIva(o.cost) : null;
  const profit = cost != null ? round2(revenue - (fee ?? 0) - cost) : null;
  const marginPct = profit != null && revenue > 0 ? round2((profit / revenue) * 100) : null;
  return { revenue, fee, cost, profit, marginPct };
}

export type PriceMode = 'PERCENT' | 'SUGGESTED' | 'BEST_MARGIN' | 'MANUAL';

export type ProposalInput = {
  type: PromoType;
  originalPrice: number | null;
  minPrice?: number | null;      // precio más bajo permitido (mayor descuento)
  maxPrice?: number | null;      // precio más alto que ML considera creíble
  suggestedPrice?: number | null;
  mlPrice?: number | null;       // precio fijado por ML (co-fondeadas y similares)
  meliPct?: number | null;
  cost?: number | null;
  feePct?: number | null;
  feeFixed?: number | null;
  mode: PriceMode;
  percent?: number | null;
  minMarginPct?: number | null;
  manualPrice?: number | null;
};

export type Proposal = {
  price: number | null;
  discountPct: number | null;
  status: 'ok' | 'warn' | 'error';
  messages: string[];
  estimate: Estimate | null;
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

// Rango de precios permitido. ML no siempre informa min/max (y en algunas campañas los nombres
// vienen invertidos), así que se ordenan; sin rango, el descuento individual usa 5%–80%.
export function priceRange(i: Pick<ProposalInput, 'type' | 'originalPrice' | 'minPrice' | 'maxPrice'>) {
  const a = num(i.minPrice);
  const b = num(i.maxPrice);
  if (a != null && b != null && a > 0 && b > 0) return { lo: Math.min(a, b), hi: Math.max(a, b) };
  if (i.originalPrice && (i.type === 'PRICE_DISCOUNT' || i.type === 'SELLER_CAMPAIGN')) {
    return {
      lo: Math.ceil(i.originalPrice * (1 - PRICE_DISCOUNT_MAX_PCT / 100)),
      hi: Math.floor(i.originalPrice * (1 - PRICE_DISCOUNT_MIN_PCT / 100)),
    };
  }
  if (a != null && a > 0) return { lo: a, hi: i.originalPrice ? i.originalPrice - 1 : a };
  if (b != null && b > 0) return { lo: 1, hi: b };
  return null;
}

// Precio más bajo que todavía deja `minMarginPct` de margen (sobre el ingreso sin IVA):
// (p − p·f − F − costo) / p ≥ m  →  p ≥ (F + costo) / (1 − f − m)
export function minPriceForMargin(cost: number, minMarginPct: number, feePct: number | null | undefined, feeFixed: number | null | undefined) {
  const f = (feePct || 0) / 100;
  const m = minMarginPct / 100;
  const k = 1 - f - m;
  if (k <= 0) return null;
  return Math.ceil(((feeFixed || 0) + cost) / k);
}

export function propose(i: ProposalInput): Proposal {
  const messages: string[] = [];
  const meta = TYPE_META[i.type];
  const original = num(i.originalPrice);
  const cost = num(i.cost);
  let price: number | null = null;
  let status: Proposal['status'] = 'ok';
  const fail = (msg: string): Proposal => ({ price, discountPct: discountPct(original, price), status: 'error', messages: [...messages, msg], estimate: null });

  if (!original || original <= 0) return fail('No se conoce el precio actual de la publicación');

  if (meta.pricing === 'ML') {
    price = num(i.mlPrice) ?? num(i.suggestedPrice);
    if (price == null || price <= 0) return fail('Mercado Libre no informó el precio de la promoción');
  } else {
    const range = priceRange({ ...i, originalPrice: original });
    if (i.mode === 'PERCENT') {
      const pct = num(i.percent);
      if (pct == null || pct <= 0 || pct >= 100) return fail('Indica un porcentaje de descuento válido');
      price = Math.round(original * (1 - pct / 100));
    } else if (i.mode === 'SUGGESTED') {
      price = num(i.suggestedPrice) ?? range?.hi ?? null;
      if (price == null) return fail('Mercado Libre no sugirió un precio para esta publicación');
    } else if (i.mode === 'MANUAL') {
      price = num(i.manualPrice);
      if (price == null || price <= 0) return fail('Indica el precio de la promoción');
    } else {
      const minMargin = num(i.minMarginPct) ?? 0;
      if (cost == null || cost <= 0) return fail('El producto no tiene costo cargado: no se puede calcular el margen');
      const floor = minPriceForMargin(cost, minMargin, i.feePct, i.feeFixed);
      if (floor == null) return fail('El margen pedido es imposible con la comisión de esta publicación');
      // El mayor descuento que respeta el margen, sin bajar del mínimo de ML.
      price = Math.max(floor, range?.lo ?? floor);
      if (range && price > range.hi) return fail(`Para dejar ${minMargin}% de margen el precio debería ser al menos ${fmt(floor)}, sobre el máximo que acepta ML (${fmt(range.hi)})`);
    }
    if (range) {
      if (price < range.lo) {
        messages.push(`Ajustado al precio mínimo que permite Mercado Libre (${fmt(range.lo)})`);
        price = range.lo;
        status = 'warn';
      } else if (price > range.hi) {
        messages.push(`Ajustado al precio máximo que Mercado Libre considera un descuento creíble (${fmt(range.hi)})`);
        price = range.hi;
        status = 'warn';
      }
    }
    if (price >= original) return fail('El precio de la promoción debe ser menor al precio actual');
  }

  const est = estimate({ price, originalPrice: original, meliPct: i.meliPct, cost, feePct: i.feePct, feeFixed: i.feeFixed });
  if (est.profit == null) {
    messages.push('Sin costo cargado: no se puede calcular la ganancia');
    if (status === 'ok') status = 'warn';
  } else if (est.profit < 0) {
    messages.push(`Pierdes ${fmt(-est.profit)} por unidad`);
    status = 'error';
  } else if (i.minMarginPct != null && est.marginPct != null && est.marginPct < i.minMarginPct) {
    messages.push(`Margen ${est.marginPct}% bajo el mínimo de ${i.minMarginPct}%`);
    status = 'error';
  }
  if (est.fee == null) messages.push('Comisión de ML no disponible: ganancia sin comisión');
  return { price, discountPct: discountPct(original, price), status, messages, estimate: est };
}

// Precio para compradores leales (Mercado Puntos 3 a 6): `extraPts` puntos porcentuales más de
// descuento que el general. ML exige al menos 5 puntos más (10 si el general supera 35%).
export function topPriceFor(original: number, price: number, extraPts: number | null | undefined) {
  if (!extraPts || extraPts <= 0) return { topPrice: null as number | null, error: null as string | null };
  const general = (1 - price / original) * 100;
  const minGap = general > 35 ? 10 : 5;
  if (extraPts < minGap) return { topPrice: null, error: `Para compradores leales el descuento debe ser al menos ${minGap} puntos mayor` };
  const top = general + extraPts;
  if (top >= PRICE_DISCOUNT_MAX_PCT) return { topPrice: null, error: `El descuento para compradores leales no puede llegar a ${PRICE_DISCOUNT_MAX_PCT}%` };
  return { topPrice: Math.round(original * (1 - top / 100)), error: null };
}

// Fecha local para ML ("YYYY-MM-DDT00:00:00"): en las promociones propias ML solo toma el día.
export function mlDay(date: string, end = false) {
  const d = /^\d{4}-\d{2}-\d{2}/.exec(String(date || ''))?.[0];
  if (!d) throw new Error('Fecha inválida');
  return `${d}T${end ? '23:59:59' : '00:00:00'}`;
}

export function daysBetween(start: string, finish: string) {
  const a = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${finish.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

export type AddInput = {
  type: PromoType;
  promotionId?: string | null;
  offerId?: string | null;
  price?: number | null;
  topPrice?: number | null;
  stock?: number | null;
  startDate?: string | null;
  finishDate?: string | null;
};

// Cuerpo del POST /seller-promotions/items/{item} según el tipo (documentación oficial).
export function addPayload(i: AddInput): Record<string, unknown> {
  const body: Record<string, unknown> = { promotion_type: i.type };
  switch (i.type) {
    case 'PRICE_DISCOUNT':
      body.deal_price = i.price;
      if (i.topPrice) body.top_deal_price = i.topPrice;
      body.start_date = mlDay(String(i.startDate));
      body.finish_date = mlDay(String(i.finishDate));
      break;
    case 'DEAL':
    case 'SELLER_CAMPAIGN':
      body.promotion_id = i.promotionId;
      body.deal_price = i.price;
      if (i.topPrice) body.top_deal_price = i.topPrice;
      break;
    case 'DOD':
      body.deal_price = i.price;
      break;
    case 'LIGHTNING':
      body.deal_price = i.price;
      body.stock = i.stock;
      break;
    case 'SMART':
    case 'PRICE_MATCHING':
    case 'PRE_NEGOTIATED':
    case 'UNHEALTHY_STOCK':
      body.promotion_id = i.promotionId;
      body.offer_id = i.offerId;
      break;
    case 'MARKETPLACE_CAMPAIGN':
    case 'VOLUME':
      body.promotion_id = i.promotionId;
      break;
  }
  return body;
}

// Query del DELETE /seller-promotions/items/{item} según el tipo.
export function deleteQuery(i: { type: PromoType; promotionId?: string | null; offerId?: string | null }) {
  const q = new URLSearchParams({ promotion_type: i.type, app_version: 'v2' });
  if (!['PRICE_DISCOUNT', 'DOD', 'LIGHTNING'].includes(i.type)) {
    if (i.promotionId) q.set('promotion_id', i.promotionId);
    if (i.offerId && i.type !== 'DEAL' && i.type !== 'SELLER_CAMPAIGN') q.set('offer_id', i.offerId);
  }
  return q.toString();
}

// Valida lo que se va a aplicar antes de llamar a ML (los mismos motivos que rechaza la API).
export function validateApply(i: AddInput & { originalPrice?: number | null; stockAvailable?: number | null; stockMin?: number | null; stockMax?: number | null }): string | null {
  const meta = TYPE_META[i.type];
  if (meta.pricing === 'SELLER') {
    if (!i.price || i.price <= 0) return 'Falta el precio de la promoción';
    if (i.originalPrice && i.price >= i.originalPrice) return 'El precio de la promoción debe ser menor al precio actual';
  }
  if (i.type === 'PRICE_DISCOUNT' && i.originalPrice && i.price) {
    const pct = (1 - i.price / i.originalPrice) * 100;
    if (pct < PRICE_DISCOUNT_MIN_PCT - 0.01 || pct > PRICE_DISCOUNT_MAX_PCT + 0.01) return `El descuento individual debe estar entre ${PRICE_DISCOUNT_MIN_PCT}% y ${PRICE_DISCOUNT_MAX_PCT}%`;
  }
  if (i.type === 'PRICE_DISCOUNT') {
    if (!i.startDate || !i.finishDate) return 'Faltan las fechas del descuento';
    const days = daysBetween(i.startDate, i.finishDate);
    if (days < 1) return 'La fecha de término debe ser posterior al inicio';
    if (days > MAX_OWN_DAYS) return `Mercado Libre permite hasta ${MAX_OWN_DAYS} días`;
  }
  if ((i.type === 'DEAL' || i.type === 'SELLER_CAMPAIGN' || i.type === 'MARKETPLACE_CAMPAIGN' || i.type === 'VOLUME') && !i.promotionId) return 'Falta la campaña';
  if (meta.offer && (!i.promotionId || !i.offerId)) return 'Falta la invitación de Mercado Libre (offer_id)';
  if (meta.stock) {
    if (!i.stock || i.stock <= 0) return 'Indica las unidades reservadas para la oferta';
    if (i.stockMin && i.stock < i.stockMin) return `Mercado Libre pide al menos ${i.stockMin} unidades`;
    if (i.stockMax && i.stock > i.stockMax) return `Mercado Libre permite hasta ${i.stockMax} unidades`;
    if (i.stockAvailable != null && i.stock > i.stockAvailable) return `Solo hay ${i.stockAvailable} unidades en stock`;
  }
  if (i.topPrice && i.price && i.topPrice >= i.price) return 'El precio para compradores leales debe ser menor al precio general';
  return null;
}

// Mensajes de error de ML en palabras simples.
const ERRORS: Array<[RegExp, string]> = [
  [/credib/i, 'El descuento no es suficiente para que ML lo considere creíble: aumenta el descuento'],
  [/buyer_discount_not_in_range|must be in range \(5, 80\)/i, 'El descuento debe estar entre 5% y 80%'],
  [/10%? difference|below_10_percent/i, 'Para compradores leales el descuento debe ser al menos 10 puntos mayor (descuento general sobre 35%)'],
  [/5%? difference|below_5_percent/i, 'Para compradores leales el descuento debe ser al menos 5 puntos mayor'],
  [/locked|423/i, 'La publicación está ocupada en ML; se reintentó sin éxito. Prueba de nuevo en unos minutos'],
  [/reputation/i, 'La cuenta necesita reputación verde para ofrecer descuentos'],
  [/not.*active|inactive|paused/i, 'La publicación no está activa en Mercado Libre'],
  [/condition/i, 'Solo productos nuevos pueden tener descuento'],
  [/free listing|listing_type|exposure/i, 'Las publicaciones gratuitas no pueden tener descuento'],
  [/suggested|deal_price/i, 'El precio no cumple el rango que pide Mercado Libre para esta campaña'],
  [/stock/i, 'El stock no cumple lo que pide Mercado Libre para la oferta'],
  [/name already exists/i, 'Ya existe una campaña con ese nombre'],
  [/already|exists/i, 'La publicación ya está en esta promoción'],
  [/not.*candidate|not eligible/i, 'La publicación ya no es candidata a esta promoción'],
  [/forbidden|403|scope/i, 'La aplicación de ML no tiene permiso para promociones: revisa los permisos de la app en Mercado Libre'],
];

export function friendlyError(message: string) {
  const m = String(message || '');
  for (const [re, text] of ERRORS) if (re.test(m)) return `${text} (${m.slice(0, 140)})`;
  return m || 'Error desconocido de Mercado Libre';
}
