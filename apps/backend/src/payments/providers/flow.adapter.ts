import { createHmac } from 'crypto';
import { ChargeInput, ChargeStatus, CreatedCharge, PaymentAdapter, PaymentCredentials, PaymentSettings, readJson } from '../payment.types';

/**
 * Flow (flow.cl), API REST v2. Credenciales: apiKey y secretKey (Integraciones → Credenciales).
 *
 * Firma (según el cliente oficial PHP de Flow): parámetros ordenados alfabéticamente por
 * nombre, concatenados como nombre+valor sin separador, HMAC-SHA256 con la secretKey en hex,
 * enviado en el parámetro `s`. GET lleva todo en la query; POST como formulario.
 *
 * Flujo: payment/create devuelve url + token → el cliente paga en `${url}?token=${token}` →
 * Flow hace POST de `token` a urlConfirmation (aviso) y a urlReturn (navegador del cliente) →
 * se consulta payment/getStatus (status 1 pendiente, 2 pagada, 3 rechazada, 4 anulada).
 *
 * SIN PROBAR con dinero real: validar con las credenciales de sandbox de un cliente.
 */
const BASE = { prod: 'https://www.flow.cl/api', test: 'https://sandbox.flow.cl/api' };
const base = (s: PaymentSettings) => (s.environment === 'test' ? BASE.test : BASE.prod);

function creds(c: PaymentCredentials) {
  const apiKey = c.apiKey?.trim();
  const secretKey = c.secretKey?.trim();
  if (!apiKey || !secretKey) throw new Error('Faltan la API Key o la Secret Key de Flow');
  return { apiKey, secretKey };
}

export function flowSign(params: Record<string, string>, secretKey: string): string {
  const toSign = Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha256', secretKey).update(toSign).digest('hex');
}

async function call(c: PaymentCredentials, s: PaymentSettings, method: 'GET' | 'POST', service: string, params: Record<string, string | number | undefined>) {
  const { apiKey, secretKey } = creds(c);
  const clean: Record<string, string> = { apiKey };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') clean[k] = String(v);
  const body = new URLSearchParams({ ...clean, s: flowSign(clean, secretKey) });
  const url = `${base(s)}/${service}`;
  const res = method === 'GET'
    ? await fetch(`${url}?${body.toString()}`)
    : await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  return readJson(res);
}

const STATE: Record<number, ChargeStatus['state']> = { 1: 'PENDING', 2: 'PAID', 3: 'REJECTED', 4: 'CANCELLED' };

export const flowAdapter: PaymentAdapter = {
  async createCharge(c, s, input: ChargeInput): Promise<CreatedCharge> {
    // Flow exige el correo del pagador (ahí le llega el comprobante).
    if (!input.email) throw new Error('Flow necesita un correo para el cobro');
    const timeout = Math.max(300, Math.round((input.expiresAt.getTime() - Date.now()) / 1000));
    const r = await call(c, s, 'POST', 'payment/create', {
      commerceOrder: input.requestId,
      subject: input.subject.slice(0, 250),
      currency: 'CLP',
      amount: Math.round(input.amount),
      email: input.email,
      paymentMethod: 9, // todos los medios habilitados en la cuenta
      urlConfirmation: input.notifyUrl ?? undefined,
      urlReturn: input.flowReturnUrl,
      timeout,
    });
    if (!r?.url || !r?.token) throw new Error('Flow no devolvió el link de pago');
    return { url: `${r.url}?token=${r.token}`, providerRef: String(r.token) };
  },

  async getStatus(c, s, req): Promise<ChargeStatus> {
    // Por commerceOrder (= id de la solicitud): sirve aunque no tengamos el token.
    const r = await call(c, s, 'GET', 'payment/getStatusByCommerceId', { commerceId: req.id });
    const pd = r?.paymentData || {};
    const state = STATE[Number(r?.status)] ?? 'PENDING';
    return {
      state,
      paymentId: r?.flowOrder != null ? String(r.flowOrder) : null,
      amount: r?.amount != null ? Number(r.amount) : null,
      fee: pd.fee != null && pd.fee !== '' ? Number(pd.fee) : null,
      methodName: pd.media ? `Flow · ${pd.media}` : 'Flow',
      detail: state === 'REJECTED' ? 'Pago rechazado (el cliente puede reintentar)' : null,
      paidAt: state === 'PAID' && pd.date ? new Date(String(pd.date).replace(' ', 'T')) : null,
    };
  },

  async test(c, s) {
    try {
      // Una orden que no existe: con credenciales válidas Flow responde "no encontrada";
      // con credenciales malas, error de apiKey o de firma.
      await call(c, s, 'GET', 'payment/getStatusByCommerceId', { commerceId: `test-${Date.now()}` });
      return { ok: true, message: 'Conexión correcta con Flow' };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (e?.status === 401 || /api ?key|sign|firma|unauthori/i.test(msg)) {
        return { ok: false, message: `Flow rechazó las credenciales: ${msg}` };
      }
      if (e?.status === 400) return { ok: true, message: `Credenciales aceptadas por Flow (${s.environment === 'test' ? 'sandbox' : 'producción'})` };
      return { ok: false, message: `No se pudo validar con Flow: ${msg}` };
    }
  },
};
