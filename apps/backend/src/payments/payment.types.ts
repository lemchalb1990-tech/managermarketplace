// Tipos comunes de las pasarelas de pago (Flow, Mercado Pago).

export type PaymentCredentials = Record<string, string | undefined>;

export interface PaymentSettings {
  // 'test' = sandbox (Flow) / credenciales de prueba (Mercado Pago).
  environment?: 'test' | 'prod';
  [k: string]: unknown;
}

export interface ChargeInput {
  requestId: string;
  amount: number; // CLP, entero
  subject: string;
  email?: string | null;
  expiresAt: Date;
  // URL pública del backend que recibe el aviso de pago (webhook). null si no hay APP_URL https.
  notifyUrl: string | null;
  // Página a la que vuelve el cliente después de pagar.
  returnUrl: string;
  // Solo Flow: URL del backend que recibe el POST de vuelta y redirige a returnUrl.
  flowReturnUrl: string;
}

export interface CreatedCharge {
  url: string;
  providerRef: string;
}

export interface ChargeStatus {
  state: 'PAID' | 'PENDING' | 'REJECTED' | 'CANCELLED';
  paymentId?: string | null;
  amount?: number | null;
  fee?: number | null;
  methodName?: string | null;
  detail?: string | null;
  paidAt?: Date | null;
}

export interface PaymentAdapter {
  createCharge(creds: PaymentCredentials, settings: PaymentSettings, input: ChargeInput): Promise<CreatedCharge>;
  getStatus(creds: PaymentCredentials, settings: PaymentSettings, req: { id: string; providerRef: string | null }): Promise<ChargeStatus>;
  cancel?(creds: PaymentCredentials, settings: PaymentSettings, req: { id: string; providerRef: string | null }): Promise<void>;
  test(creds: PaymentCredentials, settings: PaymentSettings): Promise<{ ok: boolean; message: string }>;
}

// Lee la respuesta como JSON (o texto) y lanza con el mensaje de la pasarela si falla.
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* texto plano */ }
  if (!res.ok) {
    const msg = typeof body === 'object' && body
      ? body.message || body.error_description || body.error || JSON.stringify(body)
      : String(body || res.statusText);
    const err: any = new Error(String(msg).slice(0, 400));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
