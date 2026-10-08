'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { confirmDialog } from '../ConfirmDialog';
import { type PreflightCheck, PublishCheckModal, MissingBanner, fieldDomId, fieldBorder, isFieldInvalid, focusField } from './publishCheck';

// Publicación del producto en una tienda de Walmart Chile.
// - Publicado (externalId): estado, precio propio del canal, sincronizar y desvincular.
// - Sin publicar: formulario con los datos que exige Walmart (formato validado en vivo:
//   feed MP_ITEM_INTL 4.46, categoría en español). Walmart procesa el envío de forma
//   asíncrona: "Publicar" lo envía y "Revisar estado" trae el resultado o los errores.

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Publicada', cls: 'bg-green-100 text-green-700' },
  PAUSED: { label: 'Pausada', cls: 'bg-amber-100 text-amber-700' },
  DRAFT: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
  ERROR: { label: 'Rechazada', cls: 'bg-red-100 text-red-700' },
  CLOSED: { label: 'Cerrada', cls: 'bg-gray-200 text-gray-600' },
};

const COUNTRIES = [
  'CN - China', 'CL - Chile', 'AR - Argentina', 'BR - Brasil', 'PE - Perú', 'CO - Colombia', 'MX - México',
  'US - Estados Unidos', 'ES - España', 'IT - Italia', 'DE - Alemania', 'PT - Portugal', 'TR - Turquía',
  'VN - Vietnam', 'IN - India', 'TW - Taiwán', 'KR - Corea del Sur', 'JP - Japón', 'MY - Malasia', 'TH - Tailandia', 'ID - Indonesia',
];

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

type Attrs = Record<string, any>;

function defaultsFrom(product: any): Attrs {
  const g = Number(product.packageWeight ?? 0);
  return {
    category: 'Muebles', gtin: product.barcode || '', brand: '', manufacturer: '', modelNumber: product.sku,
    countryOfOrigin: 'CN - China', condition: 'Nuevo', color: '', material: '', isAssemblyRequired: 'No',
    heightCm: '', widthCm: '', lengthCm: '', weightKg: '',
    shipHeightCm: product.packageHeight ?? '', shipWidthCm: product.packageWidth ?? '', shipDepthCm: product.packageLength ?? '',
    shippingWeightKg: g > 0 ? String(g / 1000) : '',
    warrantyEnabled: true, warrantyText: '', warrantyCondition: '', warrantyMonths: '3', keyFeatures: '',
  };
}

export default function WalmartListingCard({ product, connection, onRefresh, onGoImages }: {
  product: any; connection: any; onRefresh: () => void | Promise<void>; onGoImages?: () => void;
}) {
  const listing = (product.listings || []).find((l: any) => l.connectionId === connection.id);
  const published = !!listing?.externalId && listing.status !== 'DRAFT' && listing.status !== 'ERROR';
  const channelPrice = (product.channelPrices || []).find((cp: any) => cp.connectionId === connection.id);
  const saved: Attrs = listing?.channelAttributes || {};
  const feed = saved.feed || null;

  const [priceInput, setPriceInput] = useState(channelPrice ? String(Number(channelPrice.price)) : '');
  const [skuInput, setSkuInput] = useState('');
  const [title, setTitle] = useState<string>(listing?.title || product.name || '');
  const [description, setDescription] = useState<string>(listing?.description || product.description || '');
  const [attrs, setAttrs] = useState<Attrs>(() => ({ ...defaultsFrom(product), ...saved }));
  const [busy, setBusy] = useState<'' | 'sync' | 'price' | 'link' | 'unlink' | 'save' | 'publish' | 'status'>('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  // Con la verificación iniciada, los obligatorios faltantes se marcan en rojo (en vivo).
  const [verifying, setVerifying] = useState(false);

  const set = (k: string, v: any) => setAttrs((a) => ({ ...a, [k]: v }));
  const token = () => getToken()!;
  const effectivePrice = channelPrice ? Number(channelPrice.price) : Number(product.price);
  const st = listing ? (STATUS[listing.status] || { label: listing.status, cls: 'bg-gray-100 text-gray-600' }) : null;

  async function run(kind: typeof busy, fn: () => Promise<unknown>, okText: string) {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
      await onRefresh();
      setMessage({ ok: true, text: okText });
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'No se pudo completar la acción.' });
    } finally {
      setBusy('');
    }
  }

  const { feed: _omit, ...attrsToSave } = attrs; // el seguimiento del feed lo maneja el servidor
  void _omit;
  const saveDraft = () => api.connections.upsertListing(connection.id, product.id, { title, description, channelAttributes: attrsToSave }, token());

  // ── Verificación antes de publicar (mismos requisitos que valida el servidor + los campos marcados con *)
  const wk = (key: string) => `wm-${connection.id}-${key}`;
  const filled = (v: any) => String(v ?? '').trim() !== '';
  const E = (label: string, ok: boolean, field: string, value?: any, warnOnly = false): PreflightCheck => ({
    label, value: filled(value) ? String(value) : null, status: ok ? 'ok' : warnOnly ? 'warn' : 'error', field: wk(field),
  });
  const gtinDigits = String(attrs.gtin || product.barcode || '').replace(/\D/g, '');
  const imgCount = (listing?.images?.length) || (product.images?.length ?? 0);
  const checks: PreflightCheck[] = [
    E('Título', filled(title), 'title', title),
    E('Descripción corta', filled(description), 'description'),
    E('Descripción larga', filled(attrs.keyFeatures), 'keyFeatures'),
    E('Categoría', filled(attrs.category), 'category', attrs.category),
    E('Código de barras (GTIN/EAN)', gtinDigits.length >= 8, 'gtin', gtinDigits),
    E('Marca', filled(attrs.brand), 'brand', attrs.brand),
    E('Modelo', filled(attrs.modelNumber), 'modelNumber', attrs.modelNumber),
    E('País de origen', filled(attrs.countryOfOrigin), 'countryOfOrigin', attrs.countryOfOrigin),
    E('Color', filled(attrs.color), 'color', attrs.color),
    E('Material', filled(attrs.material), 'material', attrs.material),
    E('Alto armado', Number(attrs.heightCm) > 0, 'heightCm', attrs.heightCm),
    E('Ancho armado', Number(attrs.widthCm) > 0, 'widthCm', attrs.widthCm),
    E('Largo armado', Number(attrs.lengthCm) > 0, 'lengthCm', attrs.lengthCm),
    E('Peso armado', Number(attrs.weightKg) > 0, 'weightKg', attrs.weightKg),
    E('Alto de envío', Number(attrs.shipHeightCm) > 0, 'shipHeightCm', attrs.shipHeightCm),
    E('Ancho de envío', Number(attrs.shipWidthCm) > 0, 'shipWidthCm', attrs.shipWidthCm),
    E('Profundidad de envío', Number(attrs.shipDepthCm) > 0, 'shipDepthCm', attrs.shipDepthCm),
    E('Peso de envío', Number(attrs.shippingWeightKg) > 0, 'shippingWeightKg', attrs.shippingWeightKg, true),
    ...(attrs.warrantyEnabled !== false ? [
      E('Garantía: duración (meses)', Number(attrs.warrantyMonths) > 0, 'warrantyMonths', attrs.warrantyMonths),
      E('Garantía: texto', filled(attrs.warrantyText), 'warrantyText', attrs.warrantyText),
      E('Garantía: condiciones', filled(attrs.warrantyCondition), 'warrantyCondition', attrs.warrantyCondition),
    ] : []),
    { ...E('Fotos (mínimo 2)', imgCount >= 2, 'photos', imgCount > 0 ? `${imgCount} foto(s)` : null), tab: 'images' },
  ];
  const missingCount = checks.filter((c) => c.status === 'error').length;
  const bad = (key: string) => isFieldInvalid(checks, wk(key), verifying);
  function startVerify() { setVerifying(true); setVerifyOpen(true); }
  function goTo(c: PreflightCheck) {
    setVerifyOpen(false);
    if (c.tab === 'images') { onGoImages?.(); return; }
    setTimeout(() => focusField(c.field), 120);
  }

  const input = (k: string, label: string, opts: { type?: string; placeholder?: string; list?: string; hint?: string } = {}) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input id={fieldDomId(wk(k))} type={opts.type || 'text'} value={attrs[k] ?? ''} list={opts.list} placeholder={opts.placeholder}
        onChange={(e) => set(k, e.target.value)}
        className={`w-full px-3 py-2 border ${fieldBorder(bad(k))} rounded-lg text-sm`} />
      {opts.hint && <p className="text-[11px] text-gray-400 mt-0.5">{opts.hint}</p>}
    </div>
  );
  const select = (k: string, label: string, options: string[]) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select value={attrs[k] ?? options[0]} onChange={(e) => set(k, e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-[#0071CE] shrink-0" />
        <p className="font-medium text-gray-900 text-sm mr-auto">{connection.name}</p>
        {st ? (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Sin publicar</span>
        )}
      </div>

      {published ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex justify-between gap-2"><span className="text-gray-500">SKU Walmart</span><span className="font-mono text-gray-800 break-all">{listing.externalId || '—'}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-500">Stock a sincronizar</span><span className="text-gray-800 font-medium">{product.stock} un.</span></div>
            <div className="flex justify-between gap-2 sm:col-span-2"><span className="text-gray-500 shrink-0">Título publicado</span><span className="text-gray-800 text-right">{listing.title || product.name}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-500">Precio en Walmart</span><span className="text-gray-800 font-medium">{fmt(effectivePrice)}{!channelPrice && <span className="text-gray-400 font-normal"> (precio de venta)</span>}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-500">Última sincronización</span>
              <span className="text-gray-800">{listing.syncedAt ? new Date(listing.syncedAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
          </div>
          {listing.externalUrl && (
            <a href={listing.externalUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-blue-600 hover:underline">Ver publicación en Walmart →</a>
          )}
          {listing.errorMsg && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Último error de sincronización: {listing.errorMsg}</p>
          )}
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-100">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Precio de Venta Walmart</label>
              <input type="number" min="0" step="1" value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
                placeholder={`Igual al precio de venta (${fmt(Number(product.price))})`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <button disabled={!!busy}
              onClick={() => run('price', () => (priceInput.trim() === ''
                ? api.catalog.removeChannelPrice(product.id, connection.id, token())
                : api.catalog.setChannelPrice(product.id, connection.id, parseFloat(priceInput), token())), 'Precio de Walmart guardado.')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'price' ? 'Guardando...' : 'Guardar precio'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy}
              onClick={() => run('sync', () => api.connections.sync(connection.id, product.id, token()), 'Stock y precio enviados a Walmart.')}
              className="flex-1 sm:flex-none px-3 py-2 bg-[#0071CE] hover:bg-[#005fa8] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {busy === 'sync' ? 'Sincronizando...' : 'Sincronizar stock y precio ahora'}
            </button>
            <button disabled={!!busy}
              onClick={async () => {
                if (!(await confirmDialog(`¿Desvincular este producto de la publicación ${listing.externalId} en "${connection.name}"? No se borra nada en Walmart; solo deja de sincronizarse.`, { danger: true }))) return;
                await run('unlink', () => api.catalog.deleteListing(product.id, connection.id, token()), 'Producto desvinculado de Walmart.');
              }}
              className="px-3 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium disabled:opacity-50">
              {busy === 'unlink' ? 'Desvinculando...' : 'Desvincular'}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {/* Estado del último envío a Walmart */}
          {feed && (
            <div className={`rounded-lg border px-3 py-2 text-xs space-y-1 ${
              feed.status === 'ERROR' ? 'bg-red-50 border-red-200 text-red-700'
                : feed.status === 'OK' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium mr-auto">
                  {feed.status === 'ERROR' ? 'Walmart rechazó la publicación' : feed.status === 'OK' ? 'Walmart aceptó la publicación'
                    : 'Enviado a Walmart: en proceso (puede tardar unos minutos)'}
                </span>
                <button disabled={!!busy}
                  onClick={() => run('status', () => api.connections.walmartPublishStatus(connection.id, product.id, token()), 'Estado actualizado.')}
                  className="px-2 py-1 rounded border border-current text-[11px] font-medium disabled:opacity-50">
                  {busy === 'status' ? 'Consultando...' : 'Revisar estado'}
                </button>
              </div>
              {Array.isArray(feed.errors) && feed.errors.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {feed.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                </ul>
              )}
              <p className="opacity-70">Envío {feed.feedId}{feed.submittedAt ? ` · ${new Date(feed.submittedAt).toLocaleString('es-CL')}` : ''}</p>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Completa los datos que exige Walmart Chile y presiona <b>Publicar en Walmart</b>. Si el código de barras ya existe en
            el catálogo de Walmart, Walmart usa su propia ficha (nombre y fotos) y agrega tu oferta.
          </p>

          {verifying && !verifyOpen && <MissingBanner count={missingCount} onVerify={() => setVerifyOpen(true)} />}

          <section className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Producto</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Título en Walmart *</label>
              <input id={fieldDomId(wk('title'))} value={title} onChange={(e) => setTitle(e.target.value)} className={`w-full px-3 py-2 border ${fieldBorder(bad('title'))} rounded-lg text-sm`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Descripción corta *</label>
              <textarea id={fieldDomId(wk('description'))} value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                className={`w-full px-3 py-2 border ${fieldBorder(bad('description'))} rounded-lg text-sm`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Descripción larga (una característica por línea) *</label>
              <textarea id={fieldDomId(wk('keyFeatures'))} value={attrs.keyFeatures ?? ''} onChange={(e) => set('keyFeatures', e.target.value)} rows={3}
                placeholder={'Estructura de madera maciza\nTapiz de lino lavable'}
                className={`w-full px-3 py-2 border ${fieldBorder(bad('keyFeatures'))} rounded-lg text-sm`} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {input('category', 'Categoría de Walmart *', { list: 'wm-categories', hint: 'Validada: Muebles' })}
              {input('gtin', 'Código de barras (GTIN/EAN) *', { placeholder: product.barcode || '7801234567890' })}
              {input('brand', 'Marca *')}
              {input('manufacturer', 'Fabricante', { placeholder: 'Igual a la marca si se deja vacío' })}
              {input('modelNumber', 'Modelo *')}
              {input('countryOfOrigin', 'País de origen *', { list: 'wm-countries', hint: 'Formato "CN - China"' })}
              {input('color', 'Color(es) *', { placeholder: 'Blanco, Negro' })}
              {input('material', 'Material(es) *', { placeholder: 'Madera' })}
              {select('isAssemblyRequired', 'Requiere armado *', ['No', 'Sí'])}
              {select('condition', 'Condición *', ['Nuevo'])}
            </div>
            <datalist id="wm-categories"><option value="Muebles" /></datalist>
            <datalist id="wm-countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
          </section>

          <section className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Medidas</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {input('heightCm', 'Alto armado (cm) *', { type: 'number' })}
              {input('widthCm', 'Ancho armado (cm) *', { type: 'number' })}
              {input('lengthCm', 'Largo armado (cm) *', { type: 'number' })}
              {input('weightKg', 'Peso armado (kg) *', { type: 'number' })}
              {input('shipHeightCm', 'Alto envío (cm) *', { type: 'number' })}
              {input('shipWidthCm', 'Ancho envío (cm) *', { type: 'number' })}
              {input('shipDepthCm', 'Profundidad envío (cm) *', { type: 'number' })}
              {input('shippingWeightKg', 'Peso envío (kg) *', { type: 'number' })}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mr-auto">Garantía del vendedor</p>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={attrs.warrantyEnabled !== false} onChange={(e) => set('warrantyEnabled', e.target.checked)} />
                Ofrece garantía
              </label>
            </div>
            {attrs.warrantyEnabled !== false && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {input('warrantyMonths', 'Duración (meses) *', { type: 'number' })}
                {input('warrantyText', 'Garantía *', { placeholder: 'Garantía de 3 meses por defectos de fabricación' })}
                {input('warrantyCondition', 'Condiciones *', { placeholder: 'No cubre mal uso' })}
              </div>
            )}
          </section>

          <p id={fieldDomId(wk('photos'))} className={`text-[11px] ${bad('photos') ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            Fotos: se usan las de la pestaña &quot;Imágenes&quot; ({product.images?.length ?? 0}); Walmart exige al menos 2. Precio:
            {' '}{fmt(effectivePrice)}{channelPrice ? ' (precio propio de Walmart)' : ' (precio de venta)'}.
          </p>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
            <button disabled={!!busy} onClick={() => run('save', saveDraft, 'Datos de Walmart guardados.')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'save' ? 'Guardando...' : 'Guardar borrador'}
            </button>
            <button disabled={!!busy}
              onClick={startVerify}
              className="flex-1 sm:flex-none px-4 py-2 bg-[#0071CE] hover:bg-[#005fa8] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {busy === 'publish' ? 'Enviando...' : 'Publicar en Walmart'}
            </button>
          </div>

          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer">¿Ya está publicado en Walmart? Vincular con su SKU</summary>
            <div className="flex flex-wrap items-end gap-2 mt-2">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">SKU de la publicación en Walmart</label>
                <input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} placeholder="Ej: SKU-000123"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              </div>
              <button disabled={!!busy || !skuInput.trim()}
                onClick={() => run('link', () => api.connections.link(connection.id, product.id, { externalId: skuInput.trim() }, token()), 'Producto vinculado a la publicación de Walmart.')}
                className="px-3 py-2 bg-[#0071CE] hover:bg-[#005fa8] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                {busy === 'link' ? 'Vinculando...' : 'Vincular'}
              </button>
            </div>
          </details>
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
      )}
      {verifyOpen && (
        <PublishCheckModal marketplace="Walmart" checks={checks} busy={busy === 'publish'}
          onGo={goTo} onClose={() => setVerifyOpen(false)}
          onConfirm={() => {
            setVerifyOpen(false);
            setVerifying(false);
            run('publish', async () => {
              await saveDraft();
              await api.connections.walmartPublish(connection.id, product.id, token());
            }, 'Enviado a Walmart. Presiona "Revisar estado" en unos minutos para ver si lo aceptó.');
          }} />
      )}
    </div>
  );
}
