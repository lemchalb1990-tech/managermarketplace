import { ChargeInput, ChargeStatus, CreatedCharge, PaymentAdapter, PaymentCredentials, readJson } from '../payment.types';

/**
 * Mercado Pago (Checkout Pro). Credencial: Access Token de la cuenta del cliente (Tus
 * integraciones → Credenciales). Las credenciales de prueba se usan igual que las reales.
 *
 * Flujo: POST /checkout/preferences (external_reference = id de la solicitud) devuelve
 * init_point → el cliente paga ahí → Mercado Pago avisa a notification_url → se buscan los
 * pagos de esa referencia en /v1/payments/search y se toma el aprobado. El aviso no se usa como
 * fuente de verdad: siempre se consulta la API con el token de la empresa.
 *
 * SIN PROBAR con dinero real: validar con credenciales de prueba de un cliente.
 */
const API = 'https://api.mercadopago.com';

function token(c: PaymentCredentials) {
  const t = c.accessToken?.trim();
  if (!t) throw new Error('Falta el Access Token de Mercado Pago');
  return t;
}

async function call(c: PaymentCredentials, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token(c)}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return readJson(res);
}

const TYPE_LABEL: Record<string, string> = {
  credit_card: 'Tarjeta de crédito',
  debit_card: 'Tarjeta de débito',
  prepaid_card: 'Tarjeta prepago',
  account_money: 'Dinero en cuenta',
  bank_transfer: 'Transferencia',
  ticket: 'Efectivo',
  atm: 'Cajero',
};

function methodName(p: any): string {
  const type = TYPE_LABEL[p?.payment_type_id] || p?.payment_type_id || '';
  const brand = p?.payment_method_id && !['account_money'].includes(p.payment_type_id) ? ` (${p.payment_method_id})` : '';
  const inst = Number(p?.installments) > 1 ? ` · ${p.installments} cuotas` : '';
  return `Mercado Pago${type ? ` · ${type}${brand}${inst}` : ''}`;
}

const isHttps = (u?: string | null) => !!u && /^https:\/\//i.test(u);

export const mercadoPagoAdapter: PaymentAdapter = {
  async createCharge(c, _s, input: ChargeInput): Promise<CreatedCharge> {
    const body: any = {
      items: [{ id: input.requestId, title: input.subject.slice(0, 250), quantity: 1, currency_id: 'CLP', unit_price: Math.round(input.amount) }],
      external_reference: input.requestId,
      metadata: { payment_request_id: input.requestId },
      back_urls: { success: input.returnUrl, pending: input.returnUrl, failure: input.returnUrl },
      expires: true,
      expiration_date_to: input.expiresAt.toISOString(),
      ...(input.email ? { payer: { email: input.email } } : {}),
    };
    // Mercado Pago solo acepta avisos y vuelta automática a URLs https públicas.
    if (isHttps(input.notifyUrl)) body.notification_url = input.notifyUrl;
    if (isHttps(input.returnUrl)) body.auto_return = 'approved';
    const r = await call(c, 'POST', '/checkout/preferences', body);
    if (!r?.init_point || !r?.id) throw new Error('Mercado Pago no devolvió el link de pago');
    return { url: r.init_point, providerRef: String(r.id) };
  },

  async getStatus(c, _s, req): Promise<ChargeStatus> {
    const r = await call(c, 'GET', `/v1/payments/search?external_reference=${encodeURIComponent(req.id)}&sort=date_created&criteria=desc&limit=20`);
    const results: any[] = Array.isArray(r?.results) ? r.results : [];
    const approved = results.find((p) => p.status === 'approved');
    if (approved) {
      const fee = (approved.fee_details || []).reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
      return {
        state: 'PAID',
        paymentId: String(approved.id),
        amount: Number(approved.transaction_amount),
        fee: fee || null,
        methodName: methodName(approved),
        paidAt: approved.date_approved ? new Date(approved.date_approved) : null,
      };
    }
    const last = results[0];
    if (!last) return { state: 'PENDING' };
    if (last.status === 'rejected') return { state: 'PENDING', detail: `Último intento rechazado (${last.status_detail || 'rechazado'}); el cliente puede reintentar` };
    if (last.status === 'pending' || last.status === 'in_process') return { state: 'PENDING', detail: 'Pago en proceso en Mercado Pago' };
    return { state: 'PENDING', detail: last.status_detail || last.status || null };
  },

  async cancel(c, _s, req) {
    if (!req.providerRef) return;
    // Vence la preferencia ahora: el link deja de aceptar pagos.
    await call(c, 'PUT', `/checkout/preferences/${encodeURIComponent(req.providerRef)}`, {
      expires: true,
      expiration_date_to: new Date().toISOString(),
    });
  },

  async test(c) {
    try {
      const me = await call(c, 'GET', '/users/me');
      const who = me?.nickname || me?.email || me?.id;
      if (me?.site_id && me.site_id !== 'MLC') {
        return { ok: false, message: `La cuenta ${who} es de ${me.site_id}, no de Chile (MLC)` };
      }
      return { ok: true, message: `Conexión correcta con Mercado Pago (${who})` };
    } catch (e: any) {
      return { ok: false, message: e?.status === 401 ? 'Mercado Pago rechazó el Access Token' : `No se pudo validar con Mercado Pago: ${e?.message || e}` };
    }
  },
};
