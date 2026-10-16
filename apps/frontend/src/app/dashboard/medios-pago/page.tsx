'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type PaymentConnectionInfo, type PaymentProviderKey } from '@/lib/api';
import { connectorStatus, connectorVisibleTo, VisibilityBadge } from '@/lib/connectors';
import { useReservedPlatforms, usePlatformLogos, resolvePlatformLogo, resolvePlatformName, resolvePlatformDescription, type PlatformLogoSetting } from '@/lib/platformLogos';
import { PlatformEditModal } from '@/components/PlatformEditModal';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog } from '../ConfirmDialog';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { PaymentLogos } from './logos';

type Field = { key: string; label: string; hint?: string; secret?: boolean };

// key = clave de PlatformSetting (logo, nombre, descripción y estado que edita el Super Admin).
const PROVIDERS: Array<{ id: PaymentProviderKey; key: string; name: string; description: string; help: string; fields: Field[] }> = [
  {
    id: 'FLOW', key: 'flow', name: 'Flow',
    description: 'Webpay, tarjetas, transferencias y más medios chilenos a través de tu cuenta Flow.',
    help: 'En flow.cl entra a Mis datos → Integraciones → Credenciales y copia la API Key y la Secret Key. Para pruebas usa las de sandbox.flow.cl.',
    fields: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'secretKey', label: 'Secret Key', secret: true },
    ],
  },
  {
    id: 'MERCADO_PAGO', key: 'mercadopago', name: 'Mercado Pago',
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
  // Nombre, descripción y logo editables (Super Admin), igual que E-commerce, Facturación y Couriers.
  const sharedLogos = usePlatformLogos();
  const [savedLogos, setSavedLogos] = useState<Record<string, PlatformLogoSetting>>({});
  const logoMap = { ...sharedLogos, ...savedLogos };
  const reserved = useReservedPlatforms();
  const [editingInfo, setEditingInfo] = useState<PaymentProviderKey | null>(null);
  const infoProvider = PROVIDERS.find((p) => p.id === editingInfo);

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
        <p className="mb-4 text-sm text-gray-500">Selecciona una empresa en la barra superior para conectar sus cuentas. Puedes editar el nombre, la descripción y el logo con el lápiz.</p>
      )}

      {loaded && !enabled && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          El plan de la empresa no incluye cobros en línea. {isSuperAdmin ? 'Actívalo en el plan o como adicional de la empresa.' : 'Contáctanos para activarlo.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => {
          const conn = conns.find((c) => c.provider === p.id);
          const isActive = !!conn?.active;
          const displayName = resolvePlatformName(logoMap, p.key, p.name);
          const displayDescription = resolvePlatformDescription(logoMap, p.key, p.description);
          const msg = testMsg[p.id];
          // Estado definido por el Super Admin en Sincronizadores.
          const st = connectorStatus(logoMap, p.key);
          if (!isSuperAdmin && st === 'DISABLED' && !conn) return null;
          // Reservado: solo las empresas elegidas (quien ya lo tiene conectado lo sigue viendo).
          if (!connectorVisibleTo(logoMap, p.key, reserved) && !conn) return null;
          const noCompany = isSuperAdmin && !companyId;
          const locked = noCompany || (loaded && !enabled) || (!isSuperAdmin && st !== 'AVAILABLE' && !conn);
          return (
            <div key={p.id} role="button" tabIndex={0}
              onClick={() => { if (!locked) setEditing(p.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !locked) setEditing(p.id); }}
              className={`block group ${locked ? 'cursor-default' : 'cursor-pointer'}`}>
              <div className={`relative bg-white border-2 rounded-2xl p-5 transition-all hover:shadow-md ${isActive ? 'border-green-400' : 'border-gray-200 hover:border-gray-300'} ${locked && !noCompany ? 'opacity-70' : ''}`}>
                {st !== 'AVAILABLE' && (
                  <span className={`absolute left-3 top-3 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st === 'SOON' ? 'bg-[var(--brand)] text-white' : 'bg-gray-700 text-white'}`}>
                    {st === 'SOON' ? 'Próximamente' : 'Desactivado'}
                  </span>
                )}
                {(conn?.settings?.environment === 'test' || isSuperAdmin) && (
                  <div className={`absolute ${isSuperAdmin ? 'right-12' : 'right-3'} top-3 z-10 flex gap-1`}>
                    {isSuperAdmin && <VisibilityBadge map={logoMap} k={p.key} />}
                    {conn?.settings?.environment === 'test' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Modo prueba</span>
                    )}
                  </div>
                )}
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditingInfo(p.id); }}
                    className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors z-10"
                    title="Editar medio de pago"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
                <div className="flex justify-center mb-4">
                  <div className={`w-24 h-16 rounded-lg overflow-hidden transition-all ${isActive ? '' : 'grayscale opacity-50'}`}>
                    {resolvePlatformLogo(logoMap, p.key, PaymentLogos[p.key], displayName)}
                  </div>
                </div>
                <h2 className="ui-section-title mb-1">{displayName}</h2>
                <p className="text-xs text-gray-500 leading-relaxed">{displayDescription}</p>
                {msg && (
                  <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.message}</p>
                )}
                {!noCompany && (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className={`text-xs font-semibold group-hover:underline ${isActive ? 'text-green-600' : 'text-blue-600 group-hover:text-blue-700'}`}>
                      {conn ? (isActive ? 'Gestionar conexión →' : 'Conexión desactivada →') : 'Conectar →'}
                    </p>
                    {conn && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); test(p.id); }} disabled={testing === p.id}
                        className="text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50">
                        {testing === p.id ? 'Probando…' : 'Probar conexión'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {infoProvider && (
        <PlatformEditModal
          platform={infoProvider.key}
          defaultName={infoProvider.name}
          defaultDescription={infoProvider.description}
          current={logoMap[infoProvider.key]}
          fallback={PaymentLogos[infoProvider.key]}
          onClose={() => setEditingInfo(null)}
          onSaved={(u) => { setSavedLogos((m) => ({ ...m, [u.platform]: u })); setEditingInfo(null); }}
        />
      )}

      {current && (
        <ProviderForm
          provider={current}
          displayName={resolvePlatformName(logoMap, current.key, current.name)}
          conn={conns.find((c) => c.provider === current.id)}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProviderForm({ provider, displayName, conn, companyId, onClose, onSaved }: {
  provider: (typeof PROVIDERS)[number]; displayName: string; conn?: PaymentConnectionInfo; companyId?: string;
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
    if (!(await confirmDialog(`¿Quitar la conexión con ${displayName}? Si ya tiene cobros, solo se desactiva.`, { danger: true }))) return;
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
    <Modal title={`${conn ? 'Configurar' : 'Conectar'} ${displayName}`} size="md" busy={busy} onClose={onClose} onSubmit={save}
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
          Las credenciales se guardan cifradas. Los avisos de pago se configuran solos en cada cobro (no hay que registrar ninguna URL en {displayName}).
        </p>
        <FormError message={error} />
      </div>
    </Modal>
  );
}
