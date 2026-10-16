'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type PaymentConnectionInfo, type PaymentProviderKey } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog } from '../ConfirmDialog';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';

type Field = { key: string; label: string; hint?: string; secret?: boolean };

const PROVIDERS: Array<{ id: PaymentProviderKey; name: string; color: string; initials: string; description: string; help: string; fields: Field[] }> = [
  {
    id: 'FLOW', name: 'Flow', color: '#1f1f7a', initials: 'flow',
    description: 'Webpay, tarjetas, transferencias y más medios chilenos a través de tu cuenta Flow.',
    help: 'En flow.cl entra a Mis datos → Integraciones → Credenciales y copia la API Key y la Secret Key. Para pruebas usa las de sandbox.flow.cl.',
    fields: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'secretKey', label: 'Secret Key', secret: true },
    ],
  },
  {
    id: 'MERCADO_PAGO', name: 'Mercado Pago', color: '#009ee3', initials: 'MP',
    description: 'Tarjetas, dinero en cuenta y cuotas con Checkout Pro de Mercado Pago.',
    help: 'En mercadopago.cl/developers entra a Tus integraciones → tu aplicación → Credenciales de producción y copia el Access Token. Para pruebas usa las credenciales de prueba.',
    fields: [
      { key: 'accessToken', label: 'Access Token', secret: true },
      { key: 'publicKey', label: 'Public Key (opcional)' },
    ],
  },
];

export default function PaymentMethodsPage() {
  const { selectedCompanyId } = useAdminCompany();
  const [conns, setConns] = useState<PaymentConnectionInfo[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<PaymentProviderKey | null>(null);
  const [testing, setTesting] = useState<PaymentProviderKey | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; message: string }>>({});

  // El rol se lee en el navegador (evita diferencias con el render del servidor).
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN'));
    return () => cancelAnimationFrame(id);
  }, []);
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;

  const load = useCallback(() => {
    const t = getToken();
    if (!t || (isSuperAdmin && !companyId)) return;
    api.payments.connections(t, companyId)
      .then((r) => { setConns(r.connections); setEnabled(r.enabled); })
      .catch(() => setConns([]))
      .finally(() => setLoaded(true));
  }, [companyId, isSuperAdmin]);
  useEffect(() => { load(); }, [load]);

  async function test(p: PaymentProviderKey) {
    setTesting(p);
    try {
      const r = await api.payments.test(p, getToken()!, companyId);
      setTestMsg((m) => ({ ...m, [p]: r }));
    } catch (e) {
      setTestMsg((m) => ({ ...m, [p]: { ok: false, message: (e as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  const current = PROVIDERS.find((p) => p.id === editing);

  return (
    <div className="max-w-4xl">
      <h1 className="ui-page-title mb-1">Medios de pago</h1>
      <p className="ui-page-subtitle mb-3">
        Conecta Flow o Mercado Pago para cobrar con link o QR desde el punto de venta y enviar links de pago de las órdenes de trabajo.
        La venta se registra sola cuando el cliente paga.
      </p>
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
        Integración nueva: conéctala primero en modo prueba, usa <strong>Probar conexión</strong> y haz un cobro de prueba antes de cobrar a clientes.
      </div>

      {isSuperAdmin && !companyId && (
        <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>
      )}

      {loaded && !enabled && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          El plan de la empresa no incluye cobros en línea. {isSuperAdmin ? 'Actívalo en el plan o como adicional de la empresa.' : 'Contáctanos para activarlo.'}
        </div>
      )}

      {(!isSuperAdmin || companyId) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PROVIDERS.map((p) => {
            const conn = conns.find((c) => c.provider === p.id);
            const isActive = !!conn?.active;
            const msg = testMsg[p.id];
            const locked = loaded && !enabled;
            return (
              <div key={p.id} role="button" tabIndex={0}
                onClick={() => { if (!locked) setEditing(p.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !locked) setEditing(p.id); }}
                className={`block group ${locked ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
                <div className={`relative bg-white border-2 rounded-2xl p-5 transition-all hover:shadow-md ${isActive ? 'border-green-400' : 'border-gray-200 hover:border-gray-300'}`}>
                  {conn?.settings?.environment === 'test' && (
                    <span className="absolute right-3 top-3 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Modo prueba</span>
                  )}
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold text-white ${isActive ? '' : 'grayscale opacity-60'}`}
                      style={{ background: p.color }}>
                      {p.initials}
                    </div>
                    <div>
                      <h2 className="ui-section-title">{p.name}</h2>
                      <p className={`text-xs font-medium ${isActive ? 'text-green-600' : conn ? 'text-gray-400' : 'text-gray-400'}`}>
                        {isActive ? 'Conectado' : conn ? 'Desactivado' : 'Sin conectar'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{p.description}</p>
                  {msg && (
                    <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.message}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className={`text-xs font-semibold group-hover:underline ${isActive ? 'text-green-600' : 'text-blue-600'}`}>
                      {conn ? 'Gestionar conexión →' : 'Conectar →'}
                    </p>
                    {conn && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); test(p.id); }} disabled={testing === p.id}
                        className="text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50">
                        {testing === p.id ? 'Probando…' : 'Probar conexión'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {current && (
        <ProviderForm
          provider={current}
          conn={conns.find((c) => c.provider === current.id)}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProviderForm({ provider, conn, companyId, onClose, onSaved }: {
  provider: (typeof PROVIDERS)[number]; conn?: PaymentConnectionInfo; companyId?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [environment, setEnvironment] = useState<'test' | 'prod'>(conn?.settings?.environment || 'test');
  const [active, setActive] = useState(conn?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = new Set(conn?.credentialKeys || []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!conn && provider.fields.some((f) => !f.label.includes('opcional') && !creds[f.key]?.trim())) {
      setError('Completa las credenciales');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.payments.save(provider.id, { companyId, active, credentials: creds, settings: { environment } }, getToken()!);
      onSaved();
    } catch (err) {
      setError((err as Error).message || 'No se pudo guardar');
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmDialog(`¿Quitar la conexión con ${provider.name}? Si ya tiene cobros, solo se desactiva.`, { danger: true }))) return;
    setBusy(true);
    setError('');
    try {
      await api.payments.remove(provider.id, getToken()!, companyId);
      onSaved();
    } catch (err) {
      setError((err as Error).message || 'No se pudo quitar');
      setBusy(false);
    }
  }

  return (
    <Modal title={`${conn ? 'Configurar' : 'Conectar'} ${provider.name}`} size="md" busy={busy} onClose={onClose} onSubmit={save}
      footer={(
        <>
          {conn && (
            <button type="button" onClick={remove} disabled={busy} className="mr-auto px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50">
              Quitar conexión
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="space-y-4">
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">{provider.help}</p>
        <div>
          <label className={labelCls}>Ambiente</label>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'test' | 'prod')} className={inputCls}>
            <option value="test">Pruebas</option>
            <option value="prod">Producción</option>
          </select>
          {provider.id === 'MERCADO_PAGO' && (
            <p className="mt-0.5 text-[11px] text-gray-400">En Mercado Pago el ambiente lo definen las credenciales; esta opción solo muestra el aviso de modo prueba.</p>
          )}
        </div>
        {provider.fields.map((f) => (
          <div key={f.key}>
            <label className={labelCls}>{f.label}{saved.has(f.key) && <span className="ml-1 font-normal text-green-600">· guardado</span>}</label>
            <input value={creds[f.key] || ''} onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
              type={f.secret ? 'password' : 'text'} autoComplete="off"
              placeholder={saved.has(f.key) ? 'Deja vacío para mantener el actual' : ''} className={inputCls} />
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-blue-600" />
          Conexión activa (se ofrece en el punto de venta)
        </label>
        <p className="text-[11px] leading-relaxed text-gray-400">
          Las credenciales se guardan cifradas. Los avisos de pago se configuran solos en cada cobro (no hay que registrar ninguna URL en {provider.name}).
        </p>
        <FormError message={error} />
      </div>
    </Modal>
  );
}
