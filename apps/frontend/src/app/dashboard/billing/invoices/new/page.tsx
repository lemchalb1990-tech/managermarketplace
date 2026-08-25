'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';

const DTE_TYPES = [
  { value: 'FACTURA', label: 'Factura Electrónica (33)', taxed: true },
  { value: 'BOLETA', label: 'Boleta Electrónica (39)', taxed: false },
  { value: 'FACTURA_EXENTA', label: 'Factura Exenta (34)', taxed: false },
  { value: 'NOTA_CREDITO', label: 'Nota de Crédito (61)', taxed: true },
  { value: 'NOTA_DEBITO', label: 'Nota de Débito (56)', taxed: true },
];

const IVA = 0.19;

interface Item { name: string; longDescription: string; quantity: number; unitPrice: number; discount: number; productId?: string }
const emptyItem = (): Item => ({ name: '', longDescription: '', quantity: 1, unitPrice: 0, discount: 0 });

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const saleId = searchParams.get('saleId');
  const [connections, setConnections] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState('');
  const [sale, setSale] = useState<any>(null);
  const [saleLoading, setSaleLoading] = useState(false);
  const [form, setForm] = useState({
    connectionId: '',
    dteType: 'BOLETA',
    rut: '',
    razonSocial: '',
    giro: '',
    address: '',
    commune: '',
    email: '',
    notes: '',
  });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [saveAsClient, setSaveAsClient] = useState(true);
  const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [expandedDesc, setExpandedDesc] = useState<Set<number>>(new Set());

  useEffect(() => {
    const token = getToken()!;
    api.billing.connections.list(token, {}).then(setConnections).catch(() => {});
    api.clients.list(token).then((data) => setClients(data.filter((c: any) => c.active))).catch(() => {});
    api.billing.profile.get(token).then(setProfile).catch(() => {});
    api.catalog.search({ active: 'true', pageSize: 100, sortBy: 'name', sortDir: 'asc' }, token)
      .then((res) => setCatalogProducts(res.products))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!saleId) return;
    const token = getToken()!;
    setSaleLoading(true);
    api.pos.getSale(saleId, token)
      .then((s) => {
        setSale(s);
        if (s.items?.length > 0) {
          setItems(s.items.map((i: any) => ({
            name: i.product?.name || 'Producto eliminado',
            longDescription: '',
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            discount: 0,
            productId: i.product?.id,
          })));
        }
        setForm((f) => ({
          ...f,
          razonSocial: s.customerName || f.razonSocial,
          email: s.customerEmail || f.email,
          address: s.address || f.address,
          commune: s.commune || f.commune,
        }));
      })
      .catch(() => {})
      .finally(() => setSaleLoading(false));
  }, [saleId]);

  function selectClient(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) {
      setForm((f) => ({
        ...f,
        rut: c.rut || f.rut,
        razonSocial: c.name,
        giro: c.giro || f.giro,
        address: c.address || f.address,
        commune: c.commune || f.commune,
        email: c.email || f.email,
      }));
    }
  }

  const dteInfo = DTE_TYPES.find(d => d.value === form.dteType);
  const isTaxed = dteInfo?.taxed ?? true;

  const itemTotals = items.map(i => {
    const gross = i.unitPrice * i.quantity * (1 - i.discount / 100);
    return gross;
  });
  const grossTotal = itemTotals.reduce((a, b) => a + b, 0);
  const netAmount = isTaxed ? grossTotal : grossTotal / (1 + IVA);
  const tax = isTaxed ? Math.round(netAmount * IVA) : 0;
  const totalAmount = Math.round(isTaxed ? netAmount + tax : grossTotal);

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.round(n));

  function updateItem(idx: number, field: keyof Item, val: string | number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }

  function addItem() { setItems(prev => [...prev, emptyItem()]); }
  function removeItem(idx: number) {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  // Agrega un producto del catálogo como ítem: descripción corta y precio vienen del
  // catálogo; el usuario puede completar una descripción larga aparte si quiere.
  function handleAddProductItem() {
    const product = catalogProducts.find(p => p.id === selectedProductId);
    if (!product) return;
    const newItem: Item = {
      name: product.name,
      longDescription: '',
      quantity: 1,
      unitPrice: Number(product.price),
      discount: 0,
      productId: product.id,
    };
    setItems(prev => {
      const isBlankPlaceholder = prev.length === 1 && !prev[0].name.trim() && prev[0].unitPrice === 0;
      return isBlankPlaceholder ? [newItem] : [...prev, newItem];
    });
    setSelectedProductId('');
    setShowProductModal(false);
  }

  function handleOpenPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!form.connectionId) { setError('Selecciona una conexión de facturación'); return; }
    if (!form.rut.trim() || !form.razonSocial.trim()) { setError('RUT y razón social son requeridos'); return; }
    if (items.some(i => !i.name.trim() || i.unitPrice <= 0)) { setError('Completa todos los ítems'); return; }
    setError('');
    setShowPreview(true);
  }

  function buildPayload() {
    return {
      connectionId: form.connectionId,
      dteType: form.dteType,
      rut: form.rut.trim(),
      razonSocial: form.razonSocial.trim(),
      giro: form.giro.trim() || undefined,
      address: form.address.trim() || undefined,
      commune: form.commune.trim() || undefined,
      email: form.email.trim() || undefined,
      notes: form.notes.trim() || undefined,
      clientId: clientId || undefined,
      saleId: saleId || undefined,
      items: items.map(i => ({
        name: i.longDescription.trim() ? `${i.name} — ${i.longDescription.trim()}` : i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount || undefined,
      })),
    };
  }

  // Si el receptor se tipeó a mano (no viene de "Cliente registrado"), lo guarda como cliente
  // nuevo para no tener que volver a escribir sus datos la próxima vez. Si ya existe un
  // cliente con ese mismo RUT, reutiliza ese en vez de crear uno duplicado.
  async function resolveClientId(token: string): Promise<string | undefined> {
    if (clientId) return clientId;
    if (!saveAsClient || !form.razonSocial.trim()) return undefined;
    const rutTrim = form.rut.trim();
    const existing = rutTrim ? clients.find((c) => c.rut && c.rut.trim() === rutTrim) : undefined;
    if (existing) return existing.id;
    try {
      const created = await api.clients.create({
        name: form.razonSocial.trim(),
        rut: rutTrim || undefined,
        giro: form.giro.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        commune: form.commune.trim() || undefined,
      }, token);
      setClients((prev) => [...prev, created]);
      return created.id;
    } catch {
      return undefined;
    }
  }

  async function handleConfirmIssue() {
    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const resolvedClientId = await resolveClientId(token);
      const invoice = await api.billing.invoices.issue({ ...buildPayload(), clientId: resolvedClientId }, token);
      router.push(`/dashboard/billing/invoices?issued=${invoice.id}`);
    } catch (err: any) {
      setError(err.message || 'Error al emitir el documento');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft() {
    setDraftLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const resolvedClientId = await resolveClientId(token);
      const invoice = await api.billing.invoices.saveDraft({ ...buildPayload(), clientId: resolvedClientId }, token);
      router.push(`/dashboard/billing/invoices?issued=${invoice.id}`);
    } catch (err: any) {
      setError(err.message || 'Error al guardar el borrador');
    } finally {
      setDraftLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <a href="/dashboard/billing" className="text-sm text-gray-400 hover:text-gray-600">Facturación</a>
        <span className="text-gray-300">/</span>
        <a href="/dashboard/billing/invoices" className="text-sm text-gray-400 hover:text-gray-600">Documentos</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Emitir DTE</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Emitir Documento Tributario</h1>

      {saleId && (
        <div className="mb-6 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
          {saleLoading ? (
            'Cargando datos de la venta...'
          ) : sale ? (
            <>
              Facturando la venta del{' '}
              {new Date(sale.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' '}por <strong>${Math.round(Number(sale.total)).toLocaleString('es-CL')}</strong>.
              {' '}Los ítems se precargaron abajo; completa el RUT del receptor.
              {sale.invoices?.length > 0 && (
                <p className="mt-1 text-amber-700">
                  ⚠️ Esta venta ya tiene {sale.invoices.length} documento(s) emitido(s).
                </p>
              )}
            </>
          ) : (
            'No se pudo cargar la venta indicada; completa el documento manualmente.'
          )}
        </div>
      )}

      <form onSubmit={handleOpenPreview} className="space-y-6">
        {/* Sección proveedor y tipo */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Configuración del documento</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de documento *</label>
              <select value={form.dteType} onChange={(e) => setForm(f => ({ ...f, dteType: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                {DTE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor de facturación *</label>
              <select value={form.connectionId} onChange={(e) => setForm(f => ({ ...f, connectionId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">— Selecciona una conexión —</option>
                {connections.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
                ))}
              </select>
              {connections.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  <a href="/dashboard/billing" className="underline">Conecta un proveedor de facturación primero →</a>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Datos del receptor */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Datos del receptor</h2>
          {clients.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Cliente registrado (opcional)</label>
              <select value={clientId} onChange={(e) => selectClient(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">— Ingresar datos manualmente —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.rut ? ` (${c.rut})` : ''}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">Vincula el documento al cliente para llevar el control de deuda por facturas impagas.</p>
            </div>
          )}
          {!clientId && (
            <label className="flex items-center gap-2 mb-4 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={saveAsClient} onChange={(e) => setSaveAsClient(e.target.checked)}
                className="rounded" />
              Guardar estos datos como cliente nuevo (así la próxima vez solo lo seleccionas, sin volver a escribirlos)
            </label>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">RUT *</label>
              <input value={form.rut} onChange={(e) => setForm(f => ({ ...f, rut: e.target.value }))}
                placeholder="Ej: 12345678-9" required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Razón Social *</label>
              <input value={form.razonSocial} onChange={(e) => setForm(f => ({ ...f, razonSocial: e.target.value }))}
                placeholder="Nombre o razón social" required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Giro</label>
              <input value={form.giro} onChange={(e) => setForm(f => ({ ...f, giro: e.target.value }))}
                placeholder="Actividad económica"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="correo@receptor.cl"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
              <input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="Av. Principal 123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comuna</label>
              <input value={form.commune} onChange={(e) => setForm(f => ({ ...f, commune: e.target.value }))}
                placeholder="Santiago"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {/* Ítems */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Ítems</h2>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setShowProductModal(true)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800">+ Agregar producto del catálogo</button>
              <button type="button" onClick={addItem}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700">+ Ítem libre</button>
            </div>
          </div>

          <div className="overflow-x-auto">
          <div className="space-y-3 min-w-[560px]">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 pb-1 border-b border-gray-100">
              <span className="col-span-5">Descripción</span>
              <span className="col-span-2 text-center">Cantidad</span>
              <span className="col-span-2 text-right">Precio unit.</span>
              <span className="col-span-1 text-center">Dscto %</span>
              <span className="col-span-2 text-right">Total</span>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <input value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)}
                      placeholder="Descripción del ítem"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" min={1} value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" min={0} value={item.unitPrice}
                      onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right" />
                  </div>
                  <div className="col-span-1">
                    <input type="number" min={0} max={100} value={item.discount}
                      onChange={(e) => updateItem(idx, 'discount', Number(e.target.value))}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center" />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <span className="text-sm font-medium text-gray-800">{fmt(itemTotals[idx])}</span>
                    {items.length > 1 && (
                      <button type="button" onClick={() => removeItem(idx)}
                        className="text-gray-300 hover:text-red-500 ml-1 text-lg leading-none">×</button>
                    )}
                  </div>
                </div>
                <div>
                  {expandedDesc.has(idx) || item.longDescription ? (
                    <textarea value={item.longDescription} onChange={(e) => updateItem(idx, 'longDescription', e.target.value)}
                      placeholder="Descripción larga (opcional)" rows={2}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 resize-none" />
                  ) : (
                    <button type="button" onClick={() => setExpandedDesc(prev => new Set(prev).add(idx))}
                      className="text-xs text-gray-400 hover:text-blue-600">+ Agregar descripción larga</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          </div>

          {/* Totales */}
          <div className="mt-6 border-t border-gray-100 pt-4 space-y-1.5">
            {isTaxed && (
              <>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Neto</span>
                  <span>{fmt(netAmount)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>IVA (19%)</span>
                  <span>{fmt(tax)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
              <span>Total</span>
              <span>{fmt(totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Observaciones */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <label className="block text-xs font-medium text-gray-600 mb-1">Observaciones (opcional)</label>
          <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notas adicionales para el documento..."
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-3">
          <button type="submit"
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm">
            Vista previa y emitir →
          </button>
          <a href="/dashboard/billing/invoices"
            className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 font-medium">
            Cancelar
          </a>
        </div>
      </form>

      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900 text-base">Vista previa del documento</h2>
              <button onClick={() => setShowPreview(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold">
                ×
              </button>
            </div>

            {/* "Hoja" de la factura */}
            <div className="flex-1 overflow-y-auto px-6 py-6 bg-gray-100">
              <div className="bg-white mx-auto max-w-2xl shadow-sm border border-gray-200 rounded-lg p-8 text-gray-800">
                {/* Encabezado: emisor + recuadro tipo documento */}
                <div className="flex items-start justify-between gap-6 pb-5 mb-5 border-b-2 border-gray-800">
                  <div className="flex items-start gap-3 min-w-0">
                    {profile?.logoUrl && (
                      <img src={imgUrl(profile.logoUrl)} alt="Logo" className="w-14 h-14 object-contain shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 text-lg leading-tight">{profile?.razonSocial || 'Tu empresa'}</p>
                      {profile?.giro && <p className="text-gray-500 text-xs mt-0.5">{profile.giro}</p>}
                      {(profile?.address || profile?.commune || profile?.city) && (
                        <p className="text-gray-500 text-xs">{[profile?.address, profile?.commune, profile?.city].filter(Boolean).join(', ')}</p>
                      )}
                      {(profile?.phone || profile?.email) && (
                        <p className="text-gray-500 text-xs">{[profile?.phone, profile?.email].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 border-2 border-red-700 rounded-md px-4 py-3 text-center w-56">
                    <p className="text-red-700 font-bold text-xs tracking-wide">R.U.T. {profile?.rut || '—'}</p>
                    <p className="text-red-700 font-extrabold text-sm mt-1 uppercase leading-snug">{dteInfo?.label ?? form.dteType}</p>
                    <p className="text-gray-400 text-xs mt-1">N° folio pendiente de emisión</p>
                    {profile?.resolutionNumber && (
                      <p className="text-gray-400 text-[10px] mt-1">
                        Res. {profile.resolutionNumber}
                        {profile.resolutionDate && ` del ${new Date(profile.resolutionDate).toLocaleDateString('es-CL')}`}
                      </p>
                    )}
                  </div>
                </div>

                {/* Receptor */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-6 pb-5 border-b border-gray-200">
                  <div className="col-span-2">
                    <span className="text-gray-400">Señor(es): </span>
                    <span className="font-semibold text-gray-900">{form.razonSocial || '—'}</span>
                  </div>
                  <div><span className="text-gray-400">R.U.T.: </span><span className="text-gray-800 font-medium">{form.rut || '—'}</span></div>
                  <div><span className="text-gray-400">Giro: </span><span className="text-gray-800">{form.giro || '—'}</span></div>
                  <div className="col-span-2">
                    <span className="text-gray-400">Dirección: </span>
                    <span className="text-gray-800">{[form.address, form.commune].filter(Boolean).join(', ') || '—'}</span>
                  </div>
                  {form.email && <div className="col-span-2"><span className="text-gray-400">Contacto: </span><span className="text-gray-800">{form.email}</span></div>}
                  {!clientId && saveAsClient && (
                    <p className="col-span-2 text-emerald-600 mt-1">✓ Se guardará como cliente nuevo para tus próximas facturas</p>
                  )}
                </div>

                {/* Ítems */}
                <table className="w-full text-xs mb-6">
                  <thead>
                    <tr className="border-b-2 border-gray-800 text-gray-500">
                      <th className="text-left font-semibold py-1.5">Descripción</th>
                      <th className="text-center font-semibold py-1.5 w-16">Cant.</th>
                      <th className="text-right font-semibold py-1.5 w-24">P. Unit.</th>
                      <th className="text-center font-semibold py-1.5 w-14">Dscto</th>
                      <th className="text-right font-semibold py-1.5 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2 pr-2 text-gray-800">
                          {item.name}
                          {item.longDescription.trim() && (
                            <span className="block text-gray-400 text-[11px] mt-0.5">{item.longDescription.trim()}</span>
                          )}
                        </td>
                        <td className="py-2 text-center text-gray-600">{item.quantity}</td>
                        <td className="py-2 text-right text-gray-600">{fmt(item.unitPrice)}</td>
                        <td className="py-2 text-center text-gray-600">{item.discount > 0 ? `${item.discount}%` : '—'}</td>
                        <td className="py-2 text-right font-medium text-gray-900">{fmt(itemTotals[idx])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totales */}
                <div className="flex justify-end mb-6">
                  <div className="w-56 space-y-1 text-xs">
                    {isTaxed && (
                      <>
                        <div className="flex justify-between text-gray-500">
                          <span>Neto</span><span>{fmt(netAmount)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>IVA (19%)</span><span>{fmt(tax)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between font-bold text-gray-900 text-sm pt-1.5 border-t-2 border-gray-800">
                      <span>TOTAL</span><span>{fmt(totalAmount)}</span>
                    </div>
                  </div>
                </div>

                {form.notes && (
                  <p className="text-xs text-gray-500 pt-3 border-t border-dashed border-gray-200 mb-2">
                    <span className="text-gray-400">Observaciones: </span>{form.notes}
                  </p>
                )}

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                  <span>{profile?.footerText || 'Documento generado electrónicamente'}</span>
                  <span>{connections.find(c => c.id === form.connectionId)?.name} · {connections.find(c => c.id === form.connectionId)?.provider}</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 shrink-0">
              <p className="text-xs text-gray-400 mb-3">
                Esta es una vista previa. Al confirmar, se emitirá el documento real ante {connections.find(c => c.id === form.connectionId)?.provider || 'el proveedor'} y no se puede deshacer.
              </p>
              {error && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
              )}
              <div className="flex gap-3">
                <button onClick={handleConfirmIssue} disabled={loading || draftLoading}
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm">
                  {loading ? 'Emitiendo...' : 'Confirmar y emitir'}
                </button>
                <button onClick={handleSaveDraft} disabled={loading || draftLoading}
                  title="Guarda el documento sin emitirlo ante el proveedor; podrás emitirlo después desde Documentos"
                  className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 font-medium disabled:opacity-50">
                  {draftLoading ? 'Guardando...' : 'Guardar como borrador'}
                </button>
                <button onClick={() => setShowPreview(false)} disabled={loading || draftLoading}
                  className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 font-medium disabled:opacity-50">
                  Volver a editar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 text-base">Agregar producto del catálogo</h2>
              <button onClick={() => { setShowProductModal(false); setSelectedProductId(''); }}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold">
                ×
              </button>
            </div>
            <div className="p-6 space-y-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Producto o servicio *</label>
              <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">— Selecciona un producto o servicio —</option>
                {catalogProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}) — {new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Number(p.price))}
                  </option>
                ))}
              </select>
              {catalogProducts.length === 0 && (
                <p className="text-xs text-gray-400">No hay productos activos en el catálogo.</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => { setShowProductModal(false); setSelectedProductId(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
                Cancelar
              </button>
              <button onClick={handleAddProductItem} disabled={!selectedProductId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
