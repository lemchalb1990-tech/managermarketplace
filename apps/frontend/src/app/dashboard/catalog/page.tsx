'use client';

import { useEffect, useState, FormEvent, useRef } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl, ApiError } from '@/lib/api';

function MlDescriptionEditor({ value, productId, onChange, images }: {
  value: string; productId: string; onChange: (html: string) => void; images: any[];
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastId = useRef('');

  useEffect(() => {
    if (editorRef.current && productId !== lastId.current) {
      editorRef.current.innerHTML = value || '';
      lastId.current = productId;
    }
  });

  function exec(cmd: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false);
  }

  function insertImg(url: string) {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false,
      `<img src="${url}" style="max-width:100%;display:block;margin:8px auto" />`
    );
    onChange(editorRef.current?.innerHTML || '');
  }

  return (
    <div className="border border-gray-300 rounded-xl overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }}
          className="px-2 py-1 rounded hover:bg-gray-200 text-sm font-bold">B</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }}
          className="px-2 py-1 rounded hover:bg-gray-200 text-sm italic">I</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }}
          className="px-2 py-1 rounded hover:bg-gray-200 text-xs">• Lista</button>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        {images.length > 0 ? (
          <>
            <span className="text-xs text-gray-400 mr-0.5">Insertar imagen:</span>
            {images.map((img: any, i: number) => (
              <button key={img.id} type="button"
                onMouseDown={e => { e.preventDefault(); insertImg(imgUrl(img.url)); }}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 text-xs text-blue-600 border border-blue-200">
                <img src={imgUrl(img.url)} className="w-4 h-4 object-cover rounded" alt="" />
                {img.isPrimary ? 'Principal' : `Img ${i + 1}`}
              </button>
            ))}
          </>
        ) : (
          <span className="text-xs text-amber-600 italic">
            Sube imágenes en la pestaña "Imágenes" para poder insertarlas aquí
          </span>
        )}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML || '')}
        className="min-h-[140px] p-3 text-sm focus:outline-none [&_img]:max-w-full [&_img]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}

type CheckStatus = 'ok' | 'warn' | 'error';
interface PreflightCheck { label: string; value?: string | null; status: CheckStatus; }
interface PublishModalState {
  connectionId: string;
  phase: 'preflight' | 'publishing' | 'error';
  checks: PreflightCheck[];
  mlErrors: string[];
  isRepublish: boolean;
}

const checkIcon: Record<CheckStatus, string> = { ok: '✅', warn: '⚠️', error: '❌' };

function PrePublishModal({ state, onConfirm, onClose }: {
  state: PublishModalState;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const hasErrors = state.checks.some(c => c.status === 'error');
  const isError = state.phase === 'error';
  const isPublishing = state.phase === 'publishing';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-base">
            {isError ? 'Mercado Libre rechazó la publicación' : 'Verificación antes de publicar'}
          </h2>
        </div>

        {state.isRepublish && !isError && (
          <div className="mx-5 mt-4 px-3 py-2 bg-yellow-50 border border-yellow-300 rounded-lg text-xs text-yellow-800 flex gap-2 items-start">
            <span className="shrink-0">⚠️</span>
            <span>Esta acción <strong>republicará</strong> el producto en Mercado Libre, reemplazando la publicación actual.</span>
          </div>
        )}

        <div className="p-5 space-y-2.5 overflow-y-auto">
          {isError ? (
            <div className="space-y-2">
              {state.mlErrors.map((e, i) => (
                <div key={i} className="flex gap-2 items-start text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <span className="text-red-500 shrink-0 mt-0.5">•</span>
                  <span className="text-red-800">{e}</span>
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-1">Corrige los campos y vuelve a intentarlo.</p>
            </div>
          ) : (
            state.checks.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-base leading-none">{checkIcon[c.status]}</span>
                <span className="text-gray-700 flex-1">{c.label}</span>
                {c.value && <span className="text-gray-400 text-xs text-right max-w-[140px] truncate">{c.value}</span>}
              </div>
            ))
          )}
        </div>

        {!isError && hasErrors && (
          <div className="px-5 pb-2">
            <p className="text-xs text-red-600 font-medium">
              Completa los campos obligatorios (❌) antes de publicar.
            </p>
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            {isError ? 'Cerrar' : 'Cancelar'}
          </button>
          {!isError && (
            <button onClick={onConfirm} disabled={hasErrors || isPublishing}
              className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 rounded-lg text-sm font-semibold">
              {isPublishing ? 'Publicando...' : 'Publicar ahora'}
            </button>
          )}
          {isError && (
            <button onClick={onConfirm}
              className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold">
              Reintentar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<any>(null);

  function search(q: string) {
    setQuery(q);
    clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const token = getToken()!;
        const data = await api.marketplace.searchCategories(q, token);
        setResults(data);
        setOpen(data.length > 0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 350);
  }

  function select(item: { id: string; name: string }) {
    onChange(item.id);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      {value && (
        <div className="flex items-center gap-2 mb-1.5 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs">
          <span className="font-mono text-blue-700 font-semibold">{value}</span>
          <button type="button" onClick={() => onChange('')}
            className="text-blue-400 hover:text-blue-700 ml-auto leading-none text-base">×</button>
        </div>
      )}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => search(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value ? 'Buscar otra categoría...' : 'Buscar categoría ML...'}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">buscando...</span>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {results.map((r) => (
            <button key={r.id} type="button" onMouseDown={() => select(r)}
              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-0">
              <span className="font-mono text-blue-600 text-xs mr-2">{r.id}</span>
              <span className="text-gray-700">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'edit' | 'images' | 'ml' | 'stock';

const emptyForm = { sku: '', name: '', description: '', price: '', cost: '', stock: '', mlCategoryId: '', warehouseId: '' };

const statusLabel: Record<string, string> = {
  ACTIVE: 'Activo', PAUSED: 'Pausado', DRAFT: 'Borrador', ERROR: 'Error', CLOSED: 'Cerrado',
};
const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  DRAFT: 'bg-gray-100 text-gray-600',
  ERROR: 'bg-red-100 text-red-600',
  CLOSED: 'bg-gray-200 text-gray-500',
};

export default function CatalogPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState('');

  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN';

  const [selected, setSelected] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('edit');
  const [editForm, setEditForm] = useState<any>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [mlLoading, setMlLoading] = useState<Record<string, boolean>>({});
  const [mlWarning, setMlWarning] = useState('');
  const [mlCategoryAttrs, setMlCategoryAttrs] = useState<any[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);
  const [categorySupportsHtml, setCategorySupportsHtml] = useState(false);
  const [publishModal, setPublishModal] = useState<PublishModalState | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const originalFormRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [stockMovLoading, setStockMovLoading] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    const [me, prods, conns, whs] = await Promise.all([
      api.me(token).catch(() => null),
      api.catalog.list(token),
      api.marketplace.connections(token).catch(() => []),
      api.warehouses.list(token).catch(() => []),
    ]);
    setCurrentUser(me);
    setProducts(prods);
    setConnections(conns);
    setWarehouses(whs);
  }

  useEffect(() => { load(); }, []);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === products.length ? new Set() : new Set(products.map((p) => p.id)),
    );
  }

  async function handleBulkSetActive(active: boolean) {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError('');
    try {
      const token = getToken()!;
      await api.catalog.bulkSetActive(Array.from(selectedIds), active, token);
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setBulkError(err.message || 'Error al actualizar los productos seleccionados.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`¿Eliminar ${selectedIds.size} producto(s) seleccionado(s)? Esta acción no se puede deshacer.`)) return;
    setBulkLoading(true);
    setBulkError('');
    try {
      const token = getToken()!;
      const result = await api.catalog.bulkDelete(Array.from(selectedIds), token);
      setSelectedIds(new Set());
      await load();
      if (result.failed.length > 0) {
        setBulkError(
          `${result.deleted} eliminado(s). ${result.failed.length} no se pudieron eliminar: ` +
          result.failed.map((f) => `"${f.name}" (${f.reason})`).join(' · '),
        );
      }
    } catch (err: any) {
      setBulkError(err.message || 'Error al eliminar los productos seleccionados.');
    } finally {
      setBulkLoading(false);
    }
  }

  useEffect(() => {
    if (!originalFormRef.current || !selected) return;
    const orig = originalFormRef.current;
    const dirty =
      editForm.name !== orig.name ||
      editForm.description !== orig.description ||
      editForm.price !== orig.price ||
      editForm.cost !== orig.cost ||
      editForm.stock !== orig.stock ||
      editForm.mlCategoryId !== orig.mlCategoryId ||
      editForm.mlDescription !== orig.mlDescription ||
      JSON.stringify(editForm.mlAttributes) !== orig.mlAttributes ||
      editForm.warehouseId !== orig.warehouseId;
    setIsDirty(dirty);
  }, [editForm]);

  async function fetchCategoryAttrs(categoryId: string, existingAttrs: any[] = []) {
    if (!categoryId) { setMlCategoryAttrs([]); setCategorySupportsHtml(false); return; }
    setAttrLoading(true);
    try {
      const token = getToken()!;
      const { attributes, supportsHtml } = await api.marketplace.getCategoryAttributes(categoryId, token);
      setMlCategoryAttrs(attributes);
      setCategorySupportsHtml(supportsHtml);
      setEditForm((f: any) => {
        const existing: any[] = existingAttrs.length ? existingAttrs : (f.mlAttributes || []);
        const required = attributes.map((a: any) => {
          const found = existing.find((e: any) => e.id === a.id);
          return { id: a.id, value_name: found?.value_name || '' };
        });
        const extras = existing.filter((e: any) => !attributes.find((a: any) => a.id === e.id));
        return { ...f, mlAttributes: [...required, ...extras] };
      });
    } catch { setMlCategoryAttrs([]); setCategorySupportsHtml(false); }
    finally { setAttrLoading(false); }
  }

  function openModal(product: any) {
    setSelected(product);
    const existingAttrs = product.mlAttributes || [];
    setEditForm({
      name: product.name,
      description: product.description || '',
      price: String(Number(product.price)),
      cost: product.cost != null ? String(Number(product.cost)) : '',
      stock: String(product.stock),
      mlCategoryId: product.mlCategoryId || '',
      mlDescription: product.mlDescription || '',
      mlAttributes: existingAttrs,
      warehouseId: product.warehouseId || '',
    });
    setTab('edit');
    setEditError('');
    setMlWarning('');
    setIsDirty(false);
    originalFormRef.current = {
      name: product.name,
      description: product.description || '',
      price: String(Number(product.price)),
      cost: product.cost != null ? String(Number(product.cost)) : '',
      stock: String(product.stock),
      mlCategoryId: product.mlCategoryId || '',
      mlDescription: product.mlDescription || '',
      mlAttributes: JSON.stringify(existingAttrs),
      warehouseId: product.warehouseId || '',
    };
    setMlCategoryAttrs([]);
    setCategorySupportsHtml(false);
    if (product.mlCategoryId) fetchCategoryAttrs(product.mlCategoryId, existingAttrs);
  }

  async function refreshSelected(id: string) {
    const token = getToken()!;
    const refreshed = await api.catalog.get(id, token);
    setSelected(refreshed);
    setProducts(ps => ps.map(p => p.id === refreshed.id ? refreshed : p));
    return refreshed;
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = getToken()!;
      await api.catalog.create({
        sku: form.sku,
        name: form.name,
        description: form.description || undefined,
        price: parseFloat(form.price),
        cost: form.cost ? parseFloat(form.cost) : undefined,
        stock: parseInt(form.stock),
        mlCategoryId: form.mlCategoryId || undefined,
        warehouseId: form.warehouseId || undefined,
      }, token);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditError('');
    setEditLoading(true);
    try {
      const token = getToken()!;
      await api.catalog.update(selected.id, {
        name: editForm.name,
        description: editForm.description || undefined,
        price: parseFloat(editForm.price),
        cost: editForm.cost !== '' ? parseFloat(editForm.cost) : undefined,
        stock: parseInt(editForm.stock),
        mlCategoryId: editForm.mlCategoryId || undefined,
        mlDescription: editForm.mlDescription || undefined,
        mlAttributes: editForm.mlAttributes?.length ? editForm.mlAttributes : undefined,
        warehouseId: editForm.warehouseId || undefined,
      }, token);
      await refreshSelected(selected.id);
      setIsDirty(false);
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadLoading(true);
    try {
      const token = getToken()!;
      await api.catalog.uploadImage(selected.id, file, token);
      await refreshSelected(selected.id);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUploadLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDeleteImage(imageId: string) {
    const token = getToken()!;
    await api.catalog.deleteImage(selected.id, imageId, token);
    await refreshSelected(selected.id);
  }

  async function handleSetPrimary(imageId: string) {
    const token = getToken()!;
    await api.catalog.setPrimaryImage(selected.id, imageId, token);
    await refreshSelected(selected.id);
  }

  function buildPreflightChecks(): PreflightCheck[] {
    const attrs = editForm.mlAttributes || [];
    const requiredAttrs = mlCategoryAttrs.filter((a: any) => a.required);
    const checks: PreflightCheck[] = [
      {
        label: 'Categoría ML',
        value: editForm.mlCategoryId || null,
        status: editForm.mlCategoryId ? 'ok' : 'error',
      },
      {
        label: 'Precio',
        value: editForm.price ? `$${Number(editForm.price).toLocaleString('es-CL')}` : null,
        status: Number(editForm.price) > 0 ? 'ok' : 'error',
      },
      {
        label: 'Stock',
        value: `${editForm.stock ?? 0} unidades`,
        status: Number(editForm.stock) > 0 ? 'ok' : 'warn',
      },
      {
        label: 'Imagen principal',
        value: selected?.images?.length > 0 ? `${selected.images.length} imagen(es)` : null,
        status: selected?.images?.length > 0 ? 'ok' : 'warn',
      },
      ...requiredAttrs.map((a: any) => {
        const found = attrs.find((x: any) => x.id === a.id && x.value_name);
        return { label: a.name, value: found?.value_name || null, status: (found ? 'ok' : 'error') as CheckStatus };
      }),
      {
        label: 'Descripción detallada ML',
        value: editForm.mlDescription ? 'Configurada' : null,
        status: (editForm.mlDescription ? 'ok' : 'warn') as CheckStatus,
      },
    ];
    return checks;
  }

  async function changeTab(newTab: Tab) {
    if (newTab !== tab && tab === 'edit' && isDirty) {
      if (!window.confirm('Tienes cambios sin guardar. ¿Salir sin guardar?')) return;
    }
    setTab(newTab);
    if (newTab === 'stock' && selected) {
      setStockMovLoading(true);
      try {
        const token = getToken()!;
        const movs = await api.pos.stockMovements(selected.id, token);
        setStockMovements(movs);
      } catch { setStockMovements([]); }
      finally { setStockMovLoading(false); }
    }
  }

  function openPublishModal(connectionId: string, isRepublish: boolean) {
    setPublishModal({ connectionId, phase: 'preflight', checks: buildPreflightChecks(), mlErrors: [], isRepublish });
  }

  async function confirmPublish() {
    if (!publishModal) return;
    const { connectionId } = publishModal;
    setPublishModal(m => m ? { ...m, phase: 'publishing' } : m);
    setMlWarning('');
    try {
      const token = getToken()!;
      const result = await api.marketplace.publish(selected.id, connectionId, token);
      if (result?.descriptionWarning) setMlWarning(result.descriptionWarning);
      await refreshSelected(selected.id);
      setPublishModal(null);
    } catch (err: any) {
      const mlErrors = (err instanceof ApiError && err.mlErrors?.length)
        ? err.mlErrors
        : [err.message || 'Error desconocido'];
      setPublishModal(m => m ? { ...m, phase: 'error', mlErrors } : m);
    }
  }

  async function handleSync(connectionId: string) {
    setMlLoading(l => ({ ...l, [`sync_${connectionId}`]: true }));
    try {
      const token = getToken()!;
      const result = await api.marketplace.sync(selected.id, connectionId, token);
      await refreshSelected(selected.id);
      if (result?.warnings?.length) {
        setMlWarning(result.warnings.join(' | '));
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setMlLoading(l => ({ ...l, [`sync_${connectionId}`]: false }));
    }
  }

  async function handleToggleListing(connectionId: string) {
    setMlLoading(l => ({ ...l, [`toggle_${connectionId}`]: true }));
    try {
      const token = getToken()!;
      await api.marketplace.toggleListing(selected.id, connectionId, token);
      await refreshSelected(selected.id);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setMlLoading(l => ({ ...l, [`toggle_${connectionId}`]: false }));
    }
  }

  const primaryImage = (p: any) => p.images?.find((i: any) => i.isPrimary) || p.images?.[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo de productos</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + Nuevo producto
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nuevo producto</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SKU *</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Costo</label>
              <input type="number" step="0.01" min="0" value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Precio *</label>
              <input type="number" step="0.01" min="0" value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Stock inicial *</label>
              <input type="number" min="0" value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Categoría ML</label>
              <CategoryPicker value={form.mlCategoryId} onChange={(id) => setForm({ ...form, mlCategoryId: id })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Bodega *
              </label>
              <select
                value={form.warehouseId}
                onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">— Selecciona una bodega —</option>
                {warehouses.filter((w) => w.active).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {warehouses.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  <a href="/dashboard/warehouses" className="underline">Crea una bodega primero →</a>
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Descripción corta</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            {error && <p className="col-span-3 text-red-600 text-sm">{error}</p>}
            <div className="col-span-3 flex gap-2">
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Guardando...' : 'Crear producto'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm); }}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {isAdmin && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
          <span className="text-sm text-blue-800 font-medium">{selectedIds.size} seleccionado(s)</span>
          <button onClick={() => handleBulkSetActive(true)} disabled={bulkLoading}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
            Activar
          </button>
          <button onClick={() => handleBulkSetActive(false)} disabled={bulkLoading}
            className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-medium hover:bg-gray-700 disabled:opacity-50">
            Desactivar
          </button>
          <button onClick={handleBulkDelete} disabled={bulkLoading}
            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
            Eliminar
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-blue-600 hover:text-blue-800">
            Limpiar selección
          </button>
        </div>
      )}
      {bulkError && (
        <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {bulkError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {isAdmin && (
                <th className="px-4 py-3 w-10">
                  <input type="checkbox"
                    checked={products.length > 0 && selectedIds.size === products.length}
                    onChange={toggleSelectAll} />
                </th>
              )}
              <th className="px-4 py-3 w-14"></th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">SKU</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Producto</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Costo</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Precio</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Stock</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Bodega</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Publicaciones ML</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((p) => {
              const img = primaryImage(p);
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  {isAdmin && (
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)} />
                    </td>
                  )}
                  <td className="px-4 py-2">
                    {img ? (
                      <img src={imgUrl(img.url)} alt={p.name}
                        className="w-10 h-10 rounded-lg object-cover border border-gray-100" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs">
                        —
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-400 text-xs">{p.sku}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {p.name}
                    {!p.active && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.cost != null ? `$${Number(p.cost).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700">${Number(p.price).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={p.stock === 0 ? 'text-red-500 font-semibold' : 'text-gray-800 font-semibold'}>
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.warehouse
                      ? <span className="text-xs text-gray-600 font-medium">{p.warehouse.name}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.listings?.length > 0
                        ? p.listings.map((l: any) => (
                            <span key={l.id} className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusColor[l.status] || 'bg-gray-100'}`}>
                              {l.connection?.name || 'ML'}: {statusLabel[l.status] || l.status}
                            </span>
                          ))
                        : <span className="text-gray-400 text-xs">Sin publicar</span>
                      }
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openModal(p)}
                      className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                      Gestionar
                    </button>
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-gray-400">Sin productos en el catálogo</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-12 px-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <p className="font-mono text-xs text-gray-400 mb-0.5">{selected.sku}</p>
                <h3 className="font-semibold text-gray-900">{selected.name}</h3>
              </div>
              <button onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </div>

            <div className="flex items-center border-b border-gray-200 px-6">
              {(['edit', 'images', 'ml', 'stock'] as Tab[]).map((t) => (
                <button key={t} onClick={() => changeTab(t)}
                  className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  {t === 'edit' ? 'Información' : t === 'images' ? `Imágenes (${selected.images?.length ?? 0})` : t === 'ml' ? 'Mercado Libre' : 'Movimientos'}
                  {t === 'edit' && isDirty && (
                    <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-orange-400 align-middle" title="Cambios sin guardar" />
                  )}
                </button>
              ))}
            </div>

            <div className="p-6 max-h-[65vh] overflow-y-auto">

              {tab === 'edit' && (
                <form onSubmit={handleEdit} className="grid grid-cols-2 gap-4">
                {!selected.active && (
                  <div className="col-span-2 flex gap-3 px-4 py-3 bg-red-50 border border-red-300 rounded-xl text-sm text-red-800">
                    <span className="text-red-500 text-lg leading-none shrink-0">🔒</span>
                    <div>
                      <p className="font-semibold mb-0.5">Producto inactivo</p>
                      <p className="text-xs">Este producto está inactivo y no puede ser modificado. Reactívalo desde el listado para editar sus datos.</p>
                    </div>
                  </div>
                )}
                <fieldset disabled={!selected.active} className="contents">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                    <input value={editForm.name}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, name: e.target.value }))}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Costo</label>
                    <input type="number" step="0.01" min="0" value={editForm.cost}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, cost: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Precio *</label>
                    <input type="number" step="0.01" min="0" value={editForm.price}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, price: e.target.value }))}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Stock</label>
                    <input type="number" min="0" value={editForm.stock}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, stock: e.target.value }))}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bodega</label>
                    <select
                      value={editForm.warehouseId || ''}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, warehouseId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      <option value="">— Sin bodega asignada —</option>
                      {warehouses.filter((w) => w.active).map((w: any) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Categoría ML</label>
                    <CategoryPicker
                      value={editForm.mlCategoryId}
                      onChange={(id) => {
                        setEditForm((f: any) => ({ ...f, mlCategoryId: id, mlAttributes: [] }));
                        fetchCategoryAttrs(id, []);
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Descripción corta</label>
                    <textarea value={editForm.description}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                      rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Atributos requeridos por ML
                      {attrLoading && <span className="ml-2 text-gray-400 text-xs font-normal">cargando...</span>}
                    </label>
                    {!editForm.mlCategoryId && (
                      <p className="text-xs text-gray-400 mb-1">Selecciona una categoría ML para ver los atributos requeridos.</p>
                    )}
                    {editForm.mlCategoryId && !attrLoading && mlCategoryAttrs.length === 0 && (
                      <p className="text-xs text-gray-400 mb-1">No hay atributos requeridos para esta categoría.</p>
                    )}
                    <div className="space-y-2">
                      {mlCategoryAttrs.map((attr: any) => {
                        const val = (editForm.mlAttributes || []).find((a: any) => a.id === attr.id)?.value_name || '';
                        const updateAttr = (v: string) => {
                          setEditForm((f: any) => {
                            const list = [...(f.mlAttributes || [])];
                            const idx = list.findIndex((a: any) => a.id === attr.id);
                            if (idx >= 0) list[idx] = { ...list[idx], value_name: v };
                            else list.push({ id: attr.id, value_name: v });
                            return { ...f, mlAttributes: list };
                          });
                        };
                        return (
                          <div key={attr.id} className="flex gap-2 items-center">
                            <span className="w-44 shrink-0 text-xs text-gray-600 font-medium truncate">
                              {attr.name}{attr.required && <span className="text-red-500 ml-0.5">*</span>}
                            </span>
                            {attr.values.length > 0 ? (
                              <select value={val} onChange={e => updateAttr(e.target.value)}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs">
                                <option value="">Seleccionar...</option>
                                {attr.values.map((v: any) => (
                                  <option key={v.id} value={v.name}>{v.name}</option>
                                ))}
                              </select>
                            ) : (
                              <input value={val} onChange={e => updateAttr(e.target.value)}
                                placeholder={attr.name}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                            )}
                          </div>
                        );
                      })}
                      {(editForm.mlAttributes || []).map((attr: any, gIdx: number) => {
                        if (mlCategoryAttrs.find((r: any) => r.id === attr.id)) return null;
                        return (
                          <div key={`extra-${gIdx}`} className="flex gap-2 items-center">
                            <input
                              value={attr.id}
                              onChange={e => {
                                const list = [...(editForm.mlAttributes || [])];
                                list[gIdx] = { ...list[gIdx], id: e.target.value.toUpperCase() };
                                setEditForm((f: any) => ({ ...f, mlAttributes: list }));
                              }}
                              placeholder="ID (ej: MODEL)"
                              className="w-44 shrink-0 px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono"
                            />
                            <input
                              value={attr.value_name}
                              onChange={e => {
                                const list = [...(editForm.mlAttributes || [])];
                                list[gIdx] = { ...list[gIdx], value_name: e.target.value };
                                setEditForm((f: any) => ({ ...f, mlAttributes: list }));
                              }}
                              placeholder="Valor"
                              className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                            />
                            <button type="button"
                              onClick={() => setEditForm((f: any) => ({ ...f, mlAttributes: f.mlAttributes.filter((_: any, j: number) => j !== gIdx) }))}
                              className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
                          </div>
                        );
                      })}
                      <button type="button"
                        onClick={() => setEditForm((f: any) => ({ ...f, mlAttributes: [...(f.mlAttributes || []), { id: '', value_name: '' }] }))}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        + Agregar atributo extra
                      </button>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Descripción detallada para Mercado Libre
                    </label>
                    {editForm.mlCategoryId && !attrLoading && !categorySupportsHtml && (
                      <div className="flex gap-2 items-start px-3 py-2 mb-2 bg-orange-50 border border-orange-300 rounded-lg text-xs text-orange-800">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>Esta categoría no soporta descripción con imágenes ni formato HTML. Solo se enviará texto plano a Mercado Libre.</span>
                      </div>
                    )}
                    {categorySupportsHtml ? (
                      <MlDescriptionEditor
                        value={editForm.mlDescription}
                        productId={selected.id}
                        images={selected.images || []}
                        onChange={(html) => setEditForm((f: any) => ({ ...f, mlDescription: html }))}
                      />
                    ) : (
                      <textarea
                        value={editForm.mlDescription || ''}
                        onChange={(e) => setEditForm((f: any) => ({ ...f, mlDescription: e.target.value }))}
                        rows={5}
                        placeholder={editForm.mlCategoryId ? 'Descripción en texto plano para esta categoría...' : 'Selecciona una categoría ML para habilitar la descripción'}
                        disabled={!editForm.mlCategoryId}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    )}
                  </div>
                  {editError && <p className="col-span-2 text-red-600 text-sm">{editError}</p>}
                  <div className="col-span-2">
                    <button type="submit" disabled={editLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                      {editLoading ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                  </div>
                </fieldset>
                </form>
              )}

              {tab === 'images' && (
                <div>
                  {selected.images?.length > 0 ? (
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      {selected.images.map((img: any) => (
                        <div key={img.id} className="relative group rounded-xl overflow-hidden border border-gray-200 aspect-square">
                          <img src={imgUrl(img.url)} alt="" className="w-full h-full object-cover" />
                          {img.isPrimary && (
                            <span className="absolute top-1.5 left-1.5 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-md font-medium">
                              Principal
                            </span>
                          )}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            {!img.isPrimary && (
                              <button onClick={() => handleSetPrimary(img.id)}
                                className="text-xs bg-white text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100 font-medium">
                                Principal
                              </button>
                            )}
                            <button onClick={() => handleDeleteImage(img.id)}
                              className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600 font-medium">
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-gray-400 text-sm py-6 mb-4">Sin imágenes cargadas</p>
                  )}
                  <div className="border-t border-gray-100 pt-4">
                    <label className="block text-xs font-medium text-gray-600 mb-2">
                      Subir imagen (JPG, PNG, WebP · máx. 5 MB)
                    </label>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                      onChange={handleUpload} disabled={uploadLoading}
                      className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50" />
                    {uploadLoading && <p className="text-xs text-gray-400 mt-2">Subiendo imagen...</p>}
                  </div>
                </div>
              )}

              {tab === 'stock' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-gray-600 font-medium">
                      Últimos 100 movimientos · Stock actual:
                      <span className={`ml-1 font-bold ${selected.stock === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {selected.stock} uds
                      </span>
                    </p>
                    <button
                      onClick={() => changeTab('stock')}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Actualizar
                    </button>
                  </div>
                  {stockMovLoading ? (
                    <p className="text-sm text-gray-400 text-center py-8">Cargando movimientos...</p>
                  ) : stockMovements.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Sin movimientos registrados para este producto.</p>
                  ) : (
                    <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                      {stockMovements.map((mov) => {
                        const isPositive = mov.quantity > 0;
                        const typeLabel: Record<string, string> = {
                          SALE: 'Venta',
                          RETURN: 'Devolución',
                          ADJUSTMENT: 'Ajuste',
                          INITIAL: 'Inicial',
                        };
                        const channelLabel: Record<string, string> = {
                          POS: 'POS',
                          MERCADO_LIBRE: 'Mercado Libre',
                          MANUAL: 'Manual',
                        };
                        const saleChannel = mov.saleItem?.sale?.channel;
                        return (
                          <div key={mov.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-gray-50">
                            <span className={`text-sm font-bold w-10 text-right shrink-0 ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                              {isPositive ? '+' : ''}{mov.quantity}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-800">
                                {typeLabel[mov.type] || mov.type}
                                {saleChannel && <span className="ml-1 text-gray-400">· {channelLabel[saleChannel] || saleChannel}</span>}
                              </p>
                              {mov.reason && <p className="text-xs text-gray-400 truncate">{mov.reason}</p>}
                              {mov.user && <p className="text-xs text-gray-400">Por: {mov.user.name}</p>}
                            </div>
                            <p className="text-xs text-gray-400 shrink-0">
                              {new Date(mov.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {tab === 'ml' && (
                <div className="space-y-3">
                  {mlWarning && (
                    <div className="flex gap-3 px-4 py-3 bg-yellow-50 border border-yellow-300 rounded-xl text-sm text-yellow-800">
                      <span className="text-yellow-500 text-lg leading-none">⚠</span>
                      <div>
                        <p className="font-semibold mb-0.5">Advertencia: descripción HTML rechazada</p>
                        <p>{mlWarning}</p>
                      </div>
                    </div>
                  )}
                  {connections.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-sm mb-1">No hay cuentas de Mercado Libre conectadas.</p>
                      <p className="text-xs">Ve a <strong>Mercado Libre</strong> en el menú para conectar una cuenta.</p>
                    </div>
                  ) : connections.map((conn) => {
                    const listing = selected.listings?.find((l: any) => l.connectionId === conn.id);
                    const publishBusy = publishModal?.connectionId === conn.id && publishModal?.phase === 'publishing';
                    const syncBusy = mlLoading[`sync_${conn.id}`];
                    const toggleBusy = mlLoading[`toggle_${conn.id}`];
                    const isActive = listing?.status === 'ACTIVE';
                    const isPaused = listing?.status === 'PAUSED';
                    const canToggle = listing && (isActive || isPaused);
                    return (
                      <div key={conn.id} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{conn.name}</p>
                            <p className="text-xs text-gray-400">Mercado Libre</p>
                          </div>
                          {listing ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[listing.status]}`}>
                              {statusLabel[listing.status]}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                              Sin publicar
                            </span>
                          )}
                        </div>
                        {listing?.externalUrl && (
                          <a href={listing.externalUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline block mb-3 truncate">
                            {listing.externalUrl}
                          </a>
                        )}
                        {listing?.errorMsg && (
                          <div className="flex gap-2 items-start mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                            <span className="shrink-0 mt-0.5">❌</span>
                            <span>{listing.errorMsg}</span>
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => openPublishModal(conn.id, !!listing)} disabled={publishBusy}
                            className="px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-xs font-semibold disabled:opacity-50">
                            {publishBusy ? 'Publicando...' : listing ? 'Republicar' : 'Publicar'}
                          </button>
                          {listing && (
                            <button onClick={() => handleSync(conn.id)} disabled={syncBusy}
                              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
                              {syncBusy ? 'Sincronizando...' : 'Sincronizar'}
                            </button>
                          )}
                          {canToggle && (
                            <button
                              onClick={() => handleToggleListing(conn.id)}
                              disabled={toggleBusy}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors ${
                                isActive
                                  ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100'
                                  : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
                              }`}
                            >
                              {toggleBusy
                                ? (isActive ? 'Pausando...' : 'Activando...')
                                : (isActive ? 'Pausar publicación' : 'Activar publicación')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {publishModal && (
        <PrePublishModal
          state={publishModal}
          onConfirm={confirmPublish}
          onClose={() => setPublishModal(null)}
        />
      )}
    </div>
  );
}
