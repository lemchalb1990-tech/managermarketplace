'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type CourierConnectionInfo } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';

type Provider = 'CHILEXPRESS' | 'STARKEN' | 'BLUEXPRESS';
type Field = { key: string; label: string; hint?: string; secret?: boolean; options?: Array<[string, string]> };

const COURIERS: Array<{ id: Provider; name: string; color: string; description: string; credentials: Field[]; advanced?: Field[] }> = [
  {
    id: 'CHILEXPRESS', name: 'Chilexpress', color: '#ffcb05',
    description: 'Cotiza, emite órdenes de transporte con etiqueta y sigue cada envío. Claves del portal developers.wschilexpress.com.',
    credentials: [
      { key: 'environment', label: 'Ambiente', options: [['test', 'Pruebas'], ['prod', 'Producción']] },
      { key: 'customerCardNumber', label: 'Tarjeta Cliente Chilexpress (TCC)', hint: 'Número de cuenta del contrato.' },
      { key: 'coverageKey', label: 'Clave de Coberturas', secret: true },
      { key: 'ratingKey', label: 'Clave del Cotizador', secret: true },
      { key: 'ordersKey', label: 'Clave de Envíos', secret: true },
    ],
  },
  {
    id: 'STARKEN', name: 'Starken', color: '#e30613',
    description: 'Cotiza con el cotizador de Starken y emite órdenes de flete con tu cuenta corriente empresa.',
    credentials: [
      { key: 'rut', label: 'RUT de la empresa (usuario)' },
      { key: 'password', label: 'Clave', secret: true },
      { key: 'apiToken', label: 'Token de API (si Starken lo entrega)', secret: true },
      { key: 'accountCode', label: 'Cuenta corriente' },
      { key: 'centerCode', label: 'Centro de costo' },
    ],
    advanced: [
      { key: 'baseUrl', label: 'URL base', hint: 'Por defecto https://gateway.starken.cl' },
      { key: 'emissionPath', label: 'Ruta de emisión', hint: 'Según lo que entregue Starken.' },
      { key: 'trackingPath', label: 'Ruta de seguimiento', hint: 'Usa {of} para el número de orden de flete.' },
    ],
  },
  {
    id: 'BLUEXPRESS', name: 'Blue Express', color: '#0033a0',
    description: 'Emite órdenes de servicio con etiqueta y sigue cada envío. Credenciales del equipo de integraciones de Blue.',
    credentials: [
      { key: 'token', label: 'BX-TOKEN', secret: true },
      { key: 'userCode', label: 'BX-USERCODE' },
      { key: 'clientAccount', label: 'BX-CLIENT_ACCOUNT' },
    ],
    advanced: [
      { key: 'baseUrl', label: 'URL base', hint: 'Por defecto https://apigw.bluex.cl' },
      { key: 'geoPath', label: 'Ruta de comunas' },
      { key: 'pricingPath', label: 'Ruta de cotización' },
      { key: 'emissionPath', label: 'Ruta de emisión' },
      { key: 'labelPath', label: 'Ruta de etiqueta', hint: 'Usa {os} para el número de envío.' },
      { key: 'trackingPath', label: 'Ruta de seguimiento', hint: 'Usa {os} para el número de envío.' },
    ],
  },
];

const SENDER: Field[] = [
  { key: 'senderName', label: 'Nombre del remitente' },
  { key: 'senderRut', label: 'RUT del remitente' },
  { key: 'senderPhone', label: 'Teléfono' },
  { key: 'senderEmail', label: 'Correo' },
  { key: 'originAddress', label: 'Dirección de retiro (calle)' },
  { key: 'originNumber', label: 'Número' },
  { key: 'originCommune', label: 'Comuna de origen' },
  { key: 'originRegion', label: 'Región' },
];
const PACKAGE: Field[] = [
  { key: 'defaultWeight', label: 'Peso (kg)' },
  { key: 'defaultLength', label: 'Largo (cm)' },
  { key: 'defaultWidth', label: 'Ancho (cm)' },
  { key: 'defaultHeight', label: 'Alto (cm)' },
];

export default function CouriersPage() {
  const { selectedCompanyId } = useAdminCompany();
  const [conns, setConns] = useState<CourierConnectionInfo[]>([]);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<Provider | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; message: string }>>({});

  const companyId = getUser()?.role === 'SUPER_ADMIN' ? selectedCompanyId || undefined : undefined;

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    api.couriers.connections(t, companyId).then(setConns).catch(() => setConns([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  async function test(p: Provider) {
    setTesting(p);
    try {
      const r = await api.couriers.test(p, getToken()!, companyId);
      setTestMsg((m) => ({ ...m, [p]: r }));
    } catch (e) {
      setTestMsg((m) => ({ ...m, [p]: { ok: false, message: (e as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  const current = COURIERS.find((c) => c.id === editing);

  return (
    <div className="max-w-4xl">
      <h1 className="ui-page-title mb-1">Couriers</h1>
      <p className="ui-page-subtitle mb-3">
        Conecta tus cuentas de Chilexpress, Starken y Blue Express para cotizar, crear envíos con etiqueta y seguir cada despacho desde la orden.
      </p>
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
        Integración nueva: las conexiones se validan con el primer cliente de cada courier. Usa <strong>Probar conexión</strong> y crea un envío de prueba antes de usarlo en producción.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COURIERS.map((c) => {
          const conn = conns.find((x) => x.provider === c.id);
          const msg = testMsg[c.id];
          return (
            <div key={c.id} className={`rounded-2xl border-2 bg-white p-5 ${conn?.active ? 'border-green-300' : 'border-gray-200'}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: c.color, color: c.id === 'CHILEXPRESS' ? '#1f2937' : '#fff' }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <h2 className="ui-section-title">{c.name}</h2>
                  <p className={`text-xs font-medium ${conn?.active ? 'text-green-600' : 'text-gray-400'}`}>{conn?.active ? 'Conectado' : 'Sin conectar'}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">{c.description}</p>
              {msg && (
                <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.message}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(c.id)} className={btnPrimary}>{conn ? 'Configurar' : 'Conectar'}</button>
                {conn && (
                  <button type="button" onClick={() => test(c.id)} disabled={testing === c.id} className={btnSecondary}>
                    {testing === c.id ? 'Probando…' : 'Probar conexión'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {current && (
        <CourierForm
          courier={current}
          conn={conns.find((x) => x.provider === current.id)}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function CourierForm({ courier, conn, companyId, onClose, onSaved }: {
  courier: (typeof COURIERS)[number]; conn?: CourierConnectionInfo; companyId?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [creds, setCreds] = useState<Record<string, string>>(() =>
    courier.id === 'CHILEXPRESS' ? { environment: 'test' } : ({} as Record<string, string>));
  const [settings, setSettings] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(conn?.settings || {}).map(([k, v]) => [k, v == null ? '' : String(v)])));
  const [active, setActive] = useState(conn?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAdv, setShowAdv] = useState(false);
  const saved = new Set(conn?.credentialKeys || []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const num = (k: string) => (settings[k] ? Number(settings[k]) : undefined);
      await api.couriers.save(courier.id, {
        companyId, active, credentials: creds,
        settings: { ...settings, defaultWeight: num('defaultWeight'), defaultLength: num('defaultLength'), defaultWidth: num('defaultWidth'), defaultHeight: num('defaultHeight') },
      }, getToken()!);
      onSaved();
    } catch (err) {
      setError((err as Error).message || 'No se pudo guardar');
      setBusy(false);
    }
  }

  const field = (f: Field, value: string, set: (v: string) => void, isCred = false) => (
    <div key={f.key}>
      <label className={labelCls}>{f.label}{isCred && saved.has(f.key) && <span className="ml-1 font-normal text-green-600">· guardado</span>}</label>
      {f.options ? (
        <select value={value || f.options[0][0]} onChange={(e) => set(e.target.value)} className={inputCls}>
          {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input value={value || ''} onChange={(e) => set(e.target.value)} type={f.secret ? 'password' : 'text'} autoComplete="off"
          placeholder={isCred && saved.has(f.key) ? 'Deja vacío para mantener el actual' : ''} className={inputCls} />
      )}
      {f.hint && <p className="mt-0.5 text-[11px] text-gray-400">{f.hint}</p>}
    </div>
  );

  return (
    <Modal title={`${conn ? 'Configurar' : 'Conectar'} ${courier.name}`} size="lg" busy={busy} onClose={onClose} onSubmit={save}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Credenciales</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {courier.credentials.map((f) => field(f, creds[f.key], (v) => setCreds((c) => ({ ...c, [f.key]: v })), true))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Remitente y punto de retiro</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SENDER.map((f) => field(f, settings[f.key], (v) => setSettings((s) => ({ ...s, [f.key]: v }))))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Paquete por defecto</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PACKAGE.map((f) => field(f, settings[f.key], (v) => setSettings((s) => ({ ...s, [f.key]: v }))))}
          </div>
        </section>
        {courier.advanced && (
          <section>
            <button type="button" onClick={() => setShowAdv((v) => !v)} className="text-xs font-medium text-blue-600 hover:underline">
              {showAdv ? 'Ocultar' : 'Mostrar'} configuración avanzada de la API
            </button>
            {showAdv && (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {courier.advanced.map((f) => field(f, settings[f.key], (v) => setSettings((s) => ({ ...s, [f.key]: v }))))}
              </div>
            )}
          </section>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-blue-600" />
          Conexión activa
        </label>
        <FormError message={error} />
      </div>
    </Modal>
  );
}
