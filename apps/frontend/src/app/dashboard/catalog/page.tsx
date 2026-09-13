'use client';

import { useEffect, useState, FormEvent, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api, imgUrl, ApiError } from '@/lib/api';
import { hasModule } from '@/lib/modules';
import { useAdminCompany } from '../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { confirmDialog, alertDialog } from '../ConfirmDialog';
import MergeModal from './MergeModal';

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

interface LinkModalState {
  connectionId: string;
  connectionName: string;
  externalId: string;
  externalUrl: string;
}

function LinkListingModal({ state, onChange, onSubmit, onClose, loading, error }: {
  state: LinkModalState;
  onChange: (next: LinkModalState) => void;
  onSubmit: () => void;
  onClose: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-base">Vincular publicación existente</h2>
          <p className="text-xs text-gray-400 mt-0.5">{state.connectionName}</p>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500">
            Usa esto cuando el producto ya está publicado en la plataforma (fuera del sistema) y solo querés
            asociarlo, sin crear una publicación nueva ni pasar por el flujo de importación.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ID de la publicación en la plataforma *</label>
            <input value={state.externalId}
              onChange={(e) => onChange({ ...state, externalId: e.target.value })}
              placeholder="Ej: MLC123456789"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL de la publicación (opcional)</label>
            <input value={state.externalUrl}
              onChange={(e) => onChange({ ...state, externalUrl: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            Cancelar
          </button>
          <button onClick={onSubmit} disabled={loading || !state.externalId.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
            {loading ? 'Vinculando...' : 'Vincular'}
          </button>
        </div>
      </div>
    </div>
  );
}

type CheckStatus = 'ok' | 'warn' | 'error';
interface PreflightCheck { label: string; value?: string | null; status: CheckStatus; }
interface SaleTermOption { id: string; name: string; valueType: string; required: boolean; values: { id: string; name: string }[]; }
interface PublishModalState {
  connectionId: string;
  phase: 'preflight' | 'publishing' | 'error';
  checks: PreflightCheck[];
  mlErrors: string[];
  isRepublish: boolean;
  // Condiciones de venta (p.ej. garantía) que exige la categoría — algunas cuentas de ML
  // las requieren y si no se mandan, rechazan la publicación con un error críptico.
  saleTerms: SaleTermOption[];
  saleTermsLoading: boolean;
  saleTermsValues: Record<string, { value_id?: string; value_name?: string }>;
}

const checkIcon: Record<CheckStatus, string> = { ok: '✅', warn: '⚠️', error: '❌' };

function PrePublishModal({ state, onConfirm, onClose, onSaleTermChange }: {
  state: PublishModalState;
  onConfirm: () => void;
  onClose: () => void;
  onSaleTermChange: (id: string, value: { value_id?: string; value_name?: string }) => void;
}) {
  const hasErrors = state.checks.some(c => c.status === 'error');
  const isError = state.phase === 'error';
  const isPublishing = state.phase === 'publishing';
  const missingSaleTerm = state.saleTerms.some((t) => t.required && !state.saleTermsValues[t.id]);

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

          {!isError && state.saleTermsLoading && (
            <p className="text-xs text-gray-400">Consultando condiciones de venta de la categoría...</p>
          )}

          {!isError && !state.saleTermsLoading && state.saleTerms.length > 0 && (
            <div className="pt-2 mt-2 border-t border-gray-100 space-y-2.5">
              <p className="text-xs font-semibold text-gray-600">Condiciones de venta que exige esta categoría</p>
              {state.saleTerms.map((t) => {
                const current = state.saleTermsValues[t.id];
                return (
                  <div key={t.id}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {t.name}{t.required ? ' *' : ''}
                    </label>
                    {t.values.length > 0 ? (
                      <select
                        value={current?.value_id || ''}
                        onChange={(e) => {
                          const opt = t.values.find((v) => v.id === e.target.value);
                          if (opt) onSaleTermChange(t.id, { value_id: opt.id, value_name: opt.name });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        <option value="">— Selecciona —</option>
                        {t.values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : (
                      <input
                        value={current?.value_name || ''}
                        onChange={(e) => onSaleTermChange(t.id, { value_name: e.target.value })}
                        placeholder={t.name}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!isError && (hasErrors || missingSaleTerm) && (
          <div className="px-5 pb-2">
            <p className="text-xs text-red-600 font-medium">
              {hasErrors && missingSaleTerm
                ? 'Completa los campos obligatorios (❌) y las condiciones de venta antes de publicar.'
                : hasErrors
                  ? 'Completa los campos obligatorios (❌) antes de publicar.'
                  : 'Completa las condiciones de venta obligatorias (*) antes de publicar.'}
            </p>
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            {isError ? 'Cerrar' : 'Cancelar'}
          </button>
          {!isError && (
            <button onClick={onConfirm} disabled={hasErrors || missingSaleTerm || isPublishing || state.saleTermsLoading}
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
  const [mode, setMode] = useState<'search' | 'browse'>('search');

  // Modo "Buscar" (texto)
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<any>(null);

  // Modo "Explorar" (árbol paso a paso) — para cuando la búsqueda por texto no trae
  // resultados que sirvan. Sin id = raíces del árbol (ya excluye avisos clasificados).
  const [browsePath, setBrowsePath] = useState<{ id: string; name: string }[]>([]);
  const [browseChildren, setBrowseChildren] = useState<{ id: string; name: string }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseStarted, setBrowseStarted] = useState(false);

  function search(q: string) {
    setQuery(q);
    clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const token = getToken()!;
        // Siempre filtrado a categorías de producto normal — los avisos clasificados
        // (Vehículos/Inmuebles/Empleos/Servicios) no se pueden publicar desde esta app.
        const data = await api.marketplace.searchCategories(q, token, 'PRODUCTO');
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

  async function loadBrowse(id?: string) {
    setBrowseLoading(true);
    try {
      const token = getToken()!;
      const data = await api.marketplace.browseCategories(id, token);
      setBrowsePath(data.path);
      setBrowseChildren(data.children);
      return data;
    } catch {
      setBrowseChildren([]);
      return null;
    } finally {
      setBrowseLoading(false);
    }
  }

  function switchToBrowse() {
    setMode('browse');
    if (!browseStarted) { setBrowseStarted(true); loadBrowse(undefined); }
  }

  async function selectChild(child: { id: string; name: string }) {
    const data = await loadBrowse(child.id);
    if (data?.isLeaf) onChange(child.id);
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

      <div className="flex gap-1 mb-1.5">
        <button type="button" onClick={() => setMode('search')}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${mode === 'search' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Buscar
        </button>
        <button type="button" onClick={switchToBrowse}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${mode === 'browse' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Explorar categorías
        </button>
      </div>

      {mode === 'search' ? (
        <>
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
        </>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 px-2.5 py-1.5 bg-gray-50 border-b border-gray-200 text-xs">
            <button type="button" onClick={() => loadBrowse(undefined)} className="text-blue-600 hover:underline font-medium">
              Inicio
            </button>
            {browsePath.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <span className="text-gray-300">/</span>
                <button type="button" onClick={() => loadBrowse(p.id)} className="text-blue-600 hover:underline">
                  {p.name}
                </button>
              </span>
            ))}
          </div>
          <div className="max-h-52 overflow-y-auto">
            {browseLoading && <p className="text-xs text-gray-400 text-center py-4">Cargando...</p>}
            {!browseLoading && browsePath.length > 0 && (
              <button type="button" onClick={() => onChange(browsePath[browsePath.length - 1].id)}
                className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 border-b border-gray-100">
                Usar "{browsePath[browsePath.length - 1].name}" tal cual (sin elegir una subcategoría)
              </button>
            )}
            {!browseLoading && browseChildren.map((c) => (
              <button key={c.id} type="button" onClick={() => selectChild(c)}
                className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-0 flex items-center justify-between gap-2">
                <span className="text-gray-700 truncate">{c.name}</span>
                <span className="text-gray-300 text-xs shrink-0">›</span>
              </button>
            ))}
            {!browseLoading && browseChildren.length === 0 && browsePath.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No se pudo cargar el árbol de categorías.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Tab = 'edit' | 'images' | 'ml' | 'stock';

const emptyForm = {
  sku: '', name: '', type: 'ARTICULO', description: '', price: '', mlPrice: '', cost: '', supplierPrice: '',
  stock: '', criticalStock: '', category: '', mlCategoryId: '', mlDescription: '', mlAttributes: [] as any[], warehouseId: '',
  packageHeight: '', packageWidth: '', packageLength: '', packageWeight: '',
};

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n);

const MARKETPLACE_LABELS: Record<string, string> = {
  MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify', WOOCOMMERCE: 'WooCommerce',
  JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella', PARIS: 'Paris',
  HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart',
};

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

// Chip de publicación por tienda en la fila del catálogo: solo color + nombre de la tienda
// (sin la palabra del estado) — verde activo, amarillo pausado, rojo el resto (borrador,
// error, cerrado). El texto del estado queda disponible como tooltip.
const listingChipColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-amber-100 text-amber-700',
};
const listingChipDefaultColor = 'bg-red-100 text-red-700';

export default function CatalogPage() {
  const searchParams = useSearchParams();
  const { selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [genericConnections, setGenericConnections] = useState<any[]>([]);
  const [publishTargets, setPublishTargets] = useState<Record<string, boolean>>({});
  // Conexiones que el usuario eligió al crear el producto pero que quedaron pendientes de
  // publicar porque todavía no hay ninguna imagen (requisito para publicar en marketplaces).
  const [pendingPublishTargets, setPendingPublishTargets] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkFailed, setBulkFailed] = useState<{ id: string; name: string; reason: string; canForce?: boolean }[]>([]);
  const [forceDeleteLoading, setForceDeleteLoading] = useState<string | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<{ products: any[]; connectionConflicts: any[] } | null>(null);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTemplateLoading, setImportTemplateLoading] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<{ updated: number; skipped: number; errors: { row: number; sku: string; reason: string }[] } | null>(null);
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [listingStatusFilter, setListingStatusFilter] = useState('');
  const [stockFilter, setStockFilter] = useState(() => searchParams.get('stock') === 'critical' ? 'critical' : '');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN';
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const hasMlModule = hasModule(currentUser, 'ecommerce_ml');
  const hasPosModule = hasModule(currentUser, 'pos');
  const hasPurchasesModule = hasModule(currentUser, 'purchases');
  const hasDropshippingModule = hasModule(currentUser, 'dropshipping');

  const activeConnections = [...connections, ...genericConnections].filter((c) => c.active);
  const mlChecked = connections.some((c) => publishTargets[c.id]);

  const [selected, setSelected] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('edit');
  const [editForm, setEditForm] = useState<any>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [mlLoading, setMlLoading] = useState<Record<string, boolean>>({});
  const [mlWarning, setMlWarning] = useState('');
  const [listNotice, setListNotice] = useState('');
  const [listNoticeIsWarning, setListNoticeIsWarning] = useState(false);
  const [mlCategoryAttrs, setMlCategoryAttrs] = useState<any[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);
  const [categorySupportsHtml, setCategorySupportsHtml] = useState(false);
  const [publishModal, setPublishModal] = useState<PublishModalState | null>(null);
  const [linkModal, setLinkModal] = useState<LinkModalState | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const originalFormRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [stockMovLoading, setStockMovLoading] = useState(false);

  async function loadProducts(p = 1, sortOverride?: { sortBy: string; sortDir: 'asc' | 'desc' }) {
    const token = getToken();
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) {
      setProducts([]);
      setTotal(0);
      setPages(1);
      return;
    }
    setLoading(true);
    try {
      const res = await api.catalog.search({
        page: p,
        search: search || undefined,
        warehouseId: warehouseFilter || undefined,
        category: categoryFilter || undefined,
        type: typeFilter || undefined,
        active: activeFilter || undefined,
        listingStatus: listingStatusFilter || undefined,
        stockFilter: stockFilter || undefined,
        companyId: isSuperAdmin ? selectedCompanyId : undefined,
        sortBy: (sortOverride?.sortBy ?? sortBy) || undefined,
        sortDir: sortOverride?.sortDir ?? sortDir,
      }, token);
      setProducts(res.products);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
      setSelectedIds(new Set());
    } catch {}
    setLoading(false);
  }

  function handleSort(field: string) {
    const nextDir: 'asc' | 'desc' = sortBy === field && sortDir === 'asc' ? 'desc' : 'asc';
    setSortBy(field);
    setSortDir(nextDir);
    loadProducts(1, { sortBy: field, sortDir: nextDir });
  }

  function sortIndicator(field: string) {
    if (sortBy !== field) return <span className="text-gray-300 text-[10px] ml-1">↕</span>;
    return <span className="text-blue-600 text-[10px] ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  async function load() {
    const token = getToken();
    if (!token) return;
    const me = await api.me(token).catch(() => null);
    setCurrentUser(me);
    const [conns, generic, whs, cats] = await Promise.all([
      api.marketplace.connections(token, selectedCompanyId || undefined).catch(() => []),
      api.connections.list(token, selectedCompanyId ? { companyId: selectedCompanyId } : undefined).catch(() => []),
      api.warehouses.list(token, selectedCompanyId || undefined).catch(() => []),
      api.catalog.categories(token, selectedCompanyId || undefined).catch(() => []),
    ]);
    setConnections(conns);
    setGenericConnections(generic);
    setWarehouses(whs);
    setCategories(cats);
    await loadProducts(1);
  }

  // La empresa activa (para Super Admin) ya está fijada antes de que esta página se
  // monte —AdminCompanyContext remonta todo el módulo al cambiarla—, así que un solo
  // load() al montar alcanza; no hace falta re-cargar en un efecto aparte.
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
      await loadProducts(page);
    } catch (err: any) {
      setBulkError(err.message || 'Error al actualizar los productos seleccionados.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkDeleteListings() {
    if (selectedIds.size === 0) return;
    if (!(await confirmDialog(
      `¿Eliminar la publicación de ${selectedIds.size} producto(s) seleccionado(s)?\n\n` +
      `Esto solo borra el vínculo interno con Mercado Libre (u otra plataforma): la publicación seguirá viva en el marketplace, pero dejará de estar asociada a estos productos en el sistema.`,
      { danger: true },
    ))) return;
    setBulkLoading(true);
    setBulkError('');
    try {
      const token = getToken()!;
      await api.catalog.bulkDeleteListings(Array.from(selectedIds), token);
      setSelectedIds(new Set());
      await loadProducts(page);
    } catch (err: any) {
      setBulkError(err.message || 'Error al eliminar las publicaciones seleccionadas.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function openMergeModal() {
    if (selectedIds.size < 2) return;
    setMergeLoading(true);
    setMergeError('');
    try {
      const token = getToken()!;
      const result = await api.catalog.mergePreview(Array.from(selectedIds), token);
      setMergeCandidates(result);
    } catch (err: any) {
      setListNotice(err.message || 'No se pudo cargar la vista previa de unificación.');
      setListNoticeIsWarning(true);
    } finally {
      setMergeLoading(false);
    }
  }

  async function handleConfirmMerge(dto: {
    productIds: string[];
    survivorId: string;
    fieldSources: Record<string, string>;
    imagesFromProductId: string | null;
    dropshipFromProductId: string | null;
  }) {
    setMergeSubmitting(true);
    setMergeError('');
    try {
      const token = getToken()!;
      await api.catalog.merge(dto, token);
      setMergeCandidates(null);
      setSelectedIds(new Set());
      await loadProducts(1);
      setListNotice('Productos unificados correctamente.');
      setListNoticeIsWarning(false);
    } catch (err: any) {
      setMergeError(err.message || 'No se pudo unificar los productos.');
    } finally {
      setMergeSubmitting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!(await confirmDialog(`¿Eliminar ${selectedIds.size} producto(s) seleccionado(s)? Esta acción no se puede deshacer.`, { danger: true }))) return;
    setBulkLoading(true);
    setBulkError('');
    setBulkFailed([]);
    try {
      const token = getToken()!;
      const result = await api.catalog.bulkDelete(Array.from(selectedIds), token);
      setSelectedIds(new Set());
      await loadProducts(page);
      if (result.failed.length > 0) {
        setBulkError(`${result.deleted} eliminado(s). ${result.failed.length} no se pudieron eliminar:`);
        setBulkFailed(result.failed);
      }
    } catch (err: any) {
      setBulkError(err.message || 'Error al eliminar los productos seleccionados.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleForceDelete(id: string, name: string) {
    if (!(await confirmDialog(`¿Eliminar definitivamente "${name}"? Esto borra también su historial de movimientos de stock (no ventas, esas ya no existen). Esta acción no se puede deshacer.`, { danger: true }))) return;
    setForceDeleteLoading(id);
    try {
      const token = getToken()!;
      await api.catalog.forceDelete(id, token);
      setBulkFailed((prev) => prev.filter((f) => f.id !== id));
      await loadProducts(page);
    } catch (err: any) {
      await alertDialog(err.message || 'Error al forzar la eliminación');
    } finally {
      setForceDeleteLoading(null);
    }
  }

  useEffect(() => {
    if (!originalFormRef.current || !selected) return;
    const orig = originalFormRef.current;
    const dirty =
      editForm.sku !== orig.sku ||
      editForm.name !== orig.name ||
      editForm.type !== orig.type ||
      editForm.description !== orig.description ||
      editForm.price !== orig.price ||
      editForm.mlPrice !== orig.mlPrice ||
      editForm.cost !== orig.cost ||
      editForm.supplierPrice !== orig.supplierPrice ||
      editForm.stock !== orig.stock ||
      editForm.criticalStock !== orig.criticalStock ||
      editForm.category !== orig.category ||
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
    setPendingPublishTargets([]);
    const existingAttrs = product.mlAttributes || [];
    setEditForm({
      sku: product.sku,
      name: product.name,
      type: product.type || 'ARTICULO',
      description: product.description || '',
      price: String(Number(product.price)),
      mlPrice: product.mlPrice != null ? String(Number(product.mlPrice)) : '',
      cost: product.cost != null ? String(Number(product.cost)) : '',
      supplierPrice: product.supplierPrice != null ? String(Number(product.supplierPrice)) : '',
      stock: String(product.stock),
      criticalStock: product.criticalStock != null ? String(Number(product.criticalStock)) : '',
      category: product.category || '',
      mlCategoryId: product.mlCategoryId || '',
      mlDescription: product.mlDescription || '',
      mlAttributes: existingAttrs,
      warehouseId: product.warehouseId || '',
      packageHeight: product.packageHeight != null ? String(Number(product.packageHeight)) : '',
      packageWidth: product.packageWidth != null ? String(Number(product.packageWidth)) : '',
      packageLength: product.packageLength != null ? String(Number(product.packageLength)) : '',
      packageWeight: product.packageWeight != null ? String(Number(product.packageWeight)) : '',
    });
    setTab('edit');
    setEditError('');
    setMlWarning('');
    setIsDirty(false);
    originalFormRef.current = {
      sku: product.sku,
      name: product.name,
      type: product.type || 'ARTICULO',
      description: product.description || '',
      price: String(Number(product.price)),
      mlPrice: product.mlPrice != null ? String(Number(product.mlPrice)) : '',
      cost: product.cost != null ? String(Number(product.cost)) : '',
      supplierPrice: product.supplierPrice != null ? String(Number(product.supplierPrice)) : '',
      stock: String(product.stock),
      criticalStock: product.criticalStock != null ? String(Number(product.criticalStock)) : '',
      category: product.category || '',
      mlCategoryId: product.mlCategoryId || '',
      mlDescription: product.mlDescription || '',
      mlAttributes: JSON.stringify(existingAttrs),
      warehouseId: product.warehouseId || '',
      packageHeight: product.packageHeight != null ? String(Number(product.packageHeight)) : '',
      packageWidth: product.packageWidth != null ? String(Number(product.packageWidth)) : '',
      packageLength: product.packageLength != null ? String(Number(product.packageLength)) : '',
      packageWeight: product.packageWeight != null ? String(Number(product.packageWeight)) : '',
    };
    setMlCategoryAttrs([]);
    setCategorySupportsHtml(false);
    if (product.mlCategoryId) fetchCategoryAttrs(product.mlCategoryId, existingAttrs);
  }

  function openCreateModal() {
    setSelected({ id: null, sku: '', name: '', active: true, images: [], listings: [] });
    setEditForm(emptyForm);
    setTab('edit');
    setEditError('');
    setMlWarning('');
    setListNotice('');
    setIsDirty(false);
    originalFormRef.current = null;
    setMlCategoryAttrs([]);
    setCategorySupportsHtml(false);
    setPublishTargets({});
    setPendingPublishTargets([]);
  }

  async function refreshSelected(id: string) {
    const token = getToken()!;
    const refreshed = await api.catalog.get(id, token);
    setSelected(refreshed);
    setProducts(ps => ps.map(p => p.id === refreshed.id ? refreshed : p));
    return refreshed;
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditError('');
    setEditLoading(true);
    try {
      const token = getToken()!;
      const payload = {
        sku: editForm.sku,
        name: editForm.name,
        type: editForm.type || 'ARTICULO',
        description: editForm.description || undefined,
        price: parseFloat(editForm.price),
        mlPrice: editForm.mlPrice !== '' ? parseFloat(editForm.mlPrice) : undefined,
        cost: editForm.cost !== '' ? parseFloat(editForm.cost) : undefined,
        supplierPrice: hasDropshippingModule && editForm.supplierPrice !== '' ? parseFloat(editForm.supplierPrice) : undefined,
        stock: parseInt(editForm.stock),
        criticalStock: editForm.criticalStock !== '' ? parseInt(editForm.criticalStock) : undefined,
        category: editForm.category || undefined,
        mlCategoryId: editForm.mlCategoryId || undefined,
        mlDescription: editForm.mlDescription || undefined,
        mlAttributes: editForm.mlAttributes?.length ? editForm.mlAttributes : undefined,
        warehouseId: editForm.warehouseId || undefined,
        packageHeight: editForm.packageHeight !== '' ? parseFloat(editForm.packageHeight) : undefined,
        packageWidth: editForm.packageWidth !== '' ? parseFloat(editForm.packageWidth) : undefined,
        packageLength: editForm.packageLength !== '' ? parseFloat(editForm.packageLength) : undefined,
        packageWeight: editForm.packageWeight !== '' ? parseFloat(editForm.packageWeight) : undefined,
        ...(isSuperAdmin && !selected.id ? { companyId: selectedCompanyId } : {}),
      };
      if (selected.id) {
        const updated = await api.catalog.update(selected.id, payload, token);
        await refreshSelected(selected.id);
        setIsDirty(false);
        setSelected(null);
        setListNoticeIsWarning(false);
        setListNotice(`Cambios guardados en "${updated?.name ?? editForm.name}".`);
      } else {
        const created = await api.catalog.create(payload, token);
        const targetIds = Object.entries(publishTargets).filter(([, checked]) => checked).map(([id]) => id);
        await loadProducts(1);

        if (targetIds.length) {
          // Un producto sin fotos no se publica en marketplaces: se deja creado (visible
          // en el catálogo, sin publicar) y el modal pasa a la pestaña de Imágenes — recién
          // con al menos una foto se puede completar la publicación con "Publicar ahora".
          await refreshSelected(created.id);
          setIsDirty(false);
          setPendingPublishTargets(targetIds);
          setTab('images');
          setListNoticeIsWarning(true);
          setListNotice(`Producto "${created.name}" creado. Sube al menos una foto y presiona "Publicar ahora" para completar la publicación en ${targetIds.length} marketplace${targetIds.length > 1 ? 's' : ''}.`);
        } else {
          setSelected(null);
          setListNoticeIsWarning(false);
          setListNotice(`Producto "${created.name}" creado.`);
        }
      }
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  async function handlePublishPending() {
    if (!selected?.id || !pendingPublishTargets.length) return;
    setEditLoading(true);
    setEditError('');
    try {
      const token = getToken()!;
      const publishErrors: string[] = [];
      for (const connId of pendingPublishTargets) {
        const isMl = connections.some((c) => c.id === connId);
        try {
          if (isMl) await api.marketplace.publish(selected.id, connId, token);
          else await api.connections.publish(connId, selected.id, token);
        } catch (err: any) {
          const conn = activeConnections.find((c) => c.id === connId);
          publishErrors.push(`${conn?.name ?? connId}: ${err.message}`);
        }
      }
      setPendingPublishTargets([]);
      await loadProducts(page);
      setSelected(null);
      if (publishErrors.length) {
        setListNoticeIsWarning(true);
        setListNotice(`No se pudo publicar en: ${publishErrors.join(' · ')}`);
      } else {
        setListNoticeIsWarning(false);
        setListNotice('Producto publicado correctamente.');
      }
    } finally {
      setEditLoading(false);
    }
  }

  function openImportModal() {
    setImportModalOpen(true);
    setImportFile(null);
    setImportError('');
    setImportResult(null);
  }

  async function handleDownloadTemplate() {
    setImportTemplateLoading(true);
    setImportError('');
    try {
      const token = getToken()!;
      await api.catalog.downloadBulkTemplate(token, isSuperAdmin ? selectedCompanyId : undefined);
    } catch (err: any) {
      setImportError(err.message || 'No se pudo descargar la plantilla');
    } finally {
      setImportTemplateLoading(false);
    }
  }

  async function handleImportSubmit() {
    if (!importFile) return;
    setImportLoading(true);
    setImportError('');
    setImportResult(null);
    try {
      const token = getToken()!;
      const result = await api.catalog.bulkImport(importFile, token, isSuperAdmin ? selectedCompanyId : undefined);
      setImportResult(result);
      setImportFile(null);
      await loadProducts(page);
    } catch (err: any) {
      setImportError(err.message || 'No se pudo procesar el archivo');
    } finally {
      setImportLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadLoading(true);
    const errors: string[] = [];
    try {
      const token = getToken()!;
      for (const file of files) {
        try {
          await api.catalog.uploadImage(selected.id, file, token);
        } catch (err: any) {
          errors.push(`${file.name}: ${err.message}`);
        }
      }
      await refreshSelected(selected.id);
      if (errors.length) await alertDialog(`Algunas imágenes no se pudieron subir:\n${errors.join('\n')}`);
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
    const mlPrice = editForm.mlPrice || editForm.price;
    const checks: PreflightCheck[] = [
      {
        label: 'Categoría ML',
        value: editForm.mlCategoryId || null,
        status: editForm.mlCategoryId ? 'ok' : 'error',
      },
      {
        label: 'Precio ML',
        value: mlPrice ? `$${Number(mlPrice).toLocaleString('es-CL')}` : null,
        status: Number(mlPrice) > 0 ? 'ok' : 'error',
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
      if (!(await confirmDialog('Tienes cambios sin guardar. ¿Salir sin guardar?', { danger: true }))) return;
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
    setPublishModal({
      connectionId, phase: 'preflight', checks: buildPreflightChecks(), mlErrors: [], isRepublish,
      saleTerms: [], saleTermsLoading: !!editForm.mlCategoryId, saleTermsValues: {},
    });
    if (!editForm.mlCategoryId) return;
    const token = getToken()!;
    api.marketplace.getSaleTerms(connectionId, editForm.mlCategoryId, token)
      .then((terms) => {
        // Precarga un valor por defecto en los campos de lista para no obligar a elegir
        // cuando ya hay una opción obvia (p.ej. una sola alternativa).
        const defaults: Record<string, { value_id?: string; value_name?: string }> = {};
        for (const t of terms) {
          if (t.values.length === 1) defaults[t.id] = { value_id: t.values[0].id, value_name: t.values[0].name };
        }
        setPublishModal((m) => m ? { ...m, saleTerms: terms, saleTermsLoading: false, saleTermsValues: { ...defaults, ...m.saleTermsValues } } : m);
      })
      .catch(() => setPublishModal((m) => m ? { ...m, saleTerms: [], saleTermsLoading: false } : m));
  }

  function updateSaleTermValue(id: string, value: { value_id?: string; value_name?: string }) {
    setPublishModal((m) => m ? { ...m, saleTermsValues: { ...m.saleTermsValues, [id]: value } } : m);
  }

  async function confirmPublish() {
    if (!publishModal) return;
    const { connectionId } = publishModal;
    const saleTerms = Object.entries(publishModal.saleTermsValues)
      .filter(([, v]) => v.value_id || v.value_name)
      .map(([id, v]) => ({ id, ...v }));
    setPublishModal(m => m ? { ...m, phase: 'publishing' } : m);
    setMlWarning('');
    try {
      const token = getToken()!;
      const result = await api.marketplace.publish(selected.id, connectionId, token, saleTerms);
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
      await alertDialog(err.message);
    } finally {
      setMlLoading(l => ({ ...l, [`sync_${connectionId}`]: false }));
    }
  }

  const [syncAllLoading, setSyncAllLoading] = useState<string | null>(null);

  async function handleSyncAll(productId: string) {
    setSyncAllLoading(productId);
    try {
      const token = getToken()!;
      const result = await api.marketplace.syncAll(productId, token);
      if (selected?.id === productId) {
        await refreshSelected(productId);
        const warnings = result.results.flatMap(r => r.warnings);
        const errors = result.results.filter(r => !r.success).map(r => `${r.connectionName}: ${r.error}`);
        setMlWarning([...warnings, ...errors].join(' | '));
      } else {
        await loadProducts(page);
        if (result.failedCount > 0) {
          const errors = result.results.filter(r => !r.success).map(r => `${r.connectionName}: ${r.error}`);
          await alertDialog(`${result.syncedCount} sincronizada(s), ${result.failedCount} con error:\n${errors.join('\n')}`);
        }
      }
    } catch (err: any) {
      await alertDialog(err.message);
    } finally {
      setSyncAllLoading(null);
    }
  }

  async function handleToggleListing(connectionId: string) {
    setMlLoading(l => ({ ...l, [`toggle_${connectionId}`]: true }));
    try {
      const token = getToken()!;
      await api.marketplace.toggleListing(selected.id, connectionId, token);
      await refreshSelected(selected.id);
    } catch (err: any) {
      await alertDialog(err.message);
    } finally {
      setMlLoading(l => ({ ...l, [`toggle_${connectionId}`]: false }));
    }
  }

  async function handleDeleteListing(connectionId: string) {
    if (!(await confirmDialog('¿Eliminar el vínculo con esta publicación? La publicación seguirá viva en Mercado Libre (u otra plataforma); el sistema solo dejará de rastrearla.', { danger: true }))) return;
    setMlLoading(l => ({ ...l, [`delete_${connectionId}`]: true }));
    try {
      const token = getToken()!;
      await api.catalog.deleteListing(selected.id, connectionId, token);
      await refreshSelected(selected.id);
    } catch (err: any) {
      await alertDialog(err.message);
    } finally {
      setMlLoading(l => ({ ...l, [`delete_${connectionId}`]: false }));
    }
  }

  function openLinkModal(connectionId: string, connectionName: string) {
    const listing = selected.listings?.find((l: any) => l.connectionId === connectionId);
    setLinkError('');
    setLinkModal({
      connectionId,
      connectionName,
      externalId: listing?.externalId || '',
      externalUrl: listing?.externalUrl || '',
    });
  }

  async function handleLinkSubmit() {
    if (!linkModal) return;
    setLinkLoading(true);
    setLinkError('');
    try {
      const token = getToken()!;
      await api.connections.link(linkModal.connectionId, selected.id, {
        externalId: linkModal.externalId.trim(),
        externalUrl: linkModal.externalUrl.trim() || undefined,
      }, token);
      await refreshSelected(selected.id);
      setLinkModal(null);
    } catch (err: any) {
      setLinkError(err.message || 'No se pudo vincular la publicación.');
    } finally {
      setLinkLoading(false);
    }
  }

  const primaryImage = (p: any) => p.images?.find((i: any) => i.isPrimary) || p.images?.[0];
  const costLockedByLots = hasPurchasesModule && !!selected?.id && (selected?._count?.purchaseItems ?? 0) > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo de productos</h1>
        {(!isSuperAdmin || selectedCompanyId) && (
          <div className="flex gap-2">
            <button onClick={openImportModal}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cargar stock/precios
            </button>
            <button onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              + Nuevo producto
            </button>
          </div>
        )}
      </div>

      {listNotice && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-5 text-center">
              <div className={`w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl ${
                listNoticeIsWarning ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'
              }`}>
                {listNoticeIsWarning ? '⚠' : '✓'}
              </div>
              <p className="text-sm text-gray-800">{listNotice}</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-center">
              <button onClick={() => setListNotice('')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {importModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Cargar stock y precios</h2>
              <button onClick={() => setImportModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-xs text-gray-500">
                Descarga la plantilla con tu catálogo actual, edita las columnas <b>Precio</b> y/o <b>Stock</b> y súbela de vuelta.
                Solo se actualizan productos que ya existen (por SKU) — esto nunca crea productos nuevos.
              </p>
              <button type="button" onClick={handleDownloadTemplate} disabled={importTemplateLoading}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                {importTemplateLoading ? 'Generando...' : '⬇ Descargar plantilla'}
              </button>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Archivo Excel (.xlsx) editado</label>
                <input type="file" accept=".xlsx"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="w-full text-sm" />
              </div>
              {importError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{importError}</p>
              )}
              {importResult && (
                <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 space-y-1.5">
                  <p className="text-green-700 font-medium">{importResult.updated} producto(s) actualizado(s).</p>
                  {importResult.skipped > 0 && (
                    <p className="text-gray-500">{importResult.skipped} fila(s) sin cambios (omitidas).</p>
                  )}
                  {importResult.errors.length > 0 && (
                    <div className="text-amber-700">
                      <p className="font-medium">{importResult.errors.length} fila(s) con error:</p>
                      <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                        {importResult.errors.map((e, i) => (
                          <li key={i}>Fila {e.row} ({e.sku}): {e.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setImportModalOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cerrar
              </button>
              <button onClick={handleImportSubmit} disabled={!importFile || importLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {importLoading ? 'Subiendo...' : 'Subir y actualizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">Selecciona una empresa para ver su catálogo de productos.</p>
        </div>
      ) : (
      <>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 block mb-1">Buscar por nombre o SKU</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadProducts(1); }}
            placeholder="Nombre o SKU del producto..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Bodega</label>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
          >
            <option value="">Todas</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Categoría</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tipo</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
          >
            <option value="">Todos</option>
            <option value="ARTICULO">Artículos</option>
            <option value="SERVICIO">Servicios</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Estado</label>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            title="Activos: marcado activo y con stock disponible (los servicios no requieren stock). Inactivos: desactivado o sin stock."
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </div>
        {activeConnections.length > 0 && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Publicación</label>
            <select
              value={listingStatusFilter}
              onChange={(e) => setListingStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
            >
              <option value="">Todas</option>
              <option value="ACTIVE">Activa</option>
              <option value="PAUSED">Pausada</option>
              <option value="ERROR_CLOSED">Con error o cerrada</option>
              <option value="NONE">Sin publicar</option>
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Stock</label>
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
          >
            <option value="">Todos</option>
            <option value="critical">Stock crítico</option>
            <option value="out">Sin stock</option>
          </select>
        </div>
        <button
          onClick={() => loadProducts(1)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          Filtrar
        </button>
        <button
          onClick={() => { setSearch(''); setWarehouseFilter(''); setCategoryFilter(''); setTypeFilter(''); setActiveFilter(''); setListingStatusFilter(''); setStockFilter(''); }}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
        >
          Limpiar
        </button>
        <span className="ml-auto text-xs text-gray-500 self-center">{total} producto(s)</span>
      </div>
      {stockFilter === 'critical' && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <span>⚠️ Mostrando solo productos activos con stock igual o menor a su umbral de stock crítico.</span>
        </div>
      )}
      {stockFilter === 'out' && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <span>⚠️ Mostrando solo artículos con stock agotado (no incluye servicios ni productos dropship).</span>
        </div>
      )}
      <datalist id="category-suggestions">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      {isAdmin && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
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
          {(currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN') && (
            <button onClick={handleBulkDeleteListings} disabled={bulkLoading}
              title="Borra el vínculo interno con el marketplace sin afectar la publicación real"
              className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
              Eliminar publicaciones
            </button>
          )}
          {(currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN') && selectedIds.size >= 2 && (
            <button onClick={openMergeModal} disabled={bulkLoading || mergeLoading}
              title="Fusiona productos duplicados (p.ej. importados de distintas cuentas de marketplace) en un solo SKU"
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
              {mergeLoading ? 'Cargando...' : 'Unificar'}
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-blue-600 hover:text-blue-800">
            Limpiar selección
          </button>
        </div>
      )}
      {bulkError && (
        <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 space-y-2">
          <p>{bulkError}</p>
          {bulkFailed.length > 0 && (
            <ul className="space-y-1.5">
              {bulkFailed.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 bg-white/60 rounded-lg px-3 py-1.5">
                  <span><strong>{f.name}</strong>: {f.reason}</span>
                  {f.canForce && (
                    <button onClick={() => handleForceDelete(f.id, f.name)} disabled={forceDeleteLoading === f.id}
                      className="shrink-0 px-2.5 py-1 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                      {forceDeleteLoading === f.id ? 'Eliminando...' : 'Forzar eliminación'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
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
              <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                onClick={() => handleSort('sku')}>
                SKU{sortIndicator('sku')}
              </th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                onClick={() => handleSort('name')}>
                Producto{sortIndicator('name')}
              </th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                onClick={() => handleSort('cost')}>
                Costo{sortIndicator('cost')}
              </th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                onClick={() => handleSort('price')}>
                Precio Venta - Tienda Física{sortIndicator('price')}
              </th>
              {activeConnections.length > 0 && (
                <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                  onClick={() => handleSort('mlPrice')}>
                  Precio ML{sortIndicator('mlPrice')}
                </th>
              )}
              <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                onClick={() => handleSort('stock')}>
                Stock{sortIndicator('stock')}
              </th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none hover:text-gray-900"
                onClick={() => handleSort('warehouse')}>
                Bodega{sortIndicator('warehouse')}
              </th>
              {activeConnections.length > 0 && (
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Publicaciones</th>
              )}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && products.map((p) => {
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
                    {p.type === 'SERVICIO' && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        Servicio
                      </span>
                    )}
                    {!p.active && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.cost != null ? fmtCLP(Number(p.cost)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{fmtCLP(Number(p.price))}</td>
                  {activeConnections.length > 0 && (
                    <td className="px-4 py-3 text-gray-700">
                      {p.mlPrice != null ? fmtCLP(Number(p.mlPrice)) : <span className="text-gray-300">—</span>}
                    </td>
                  )}
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
                  {activeConnections.length > 0 && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.listings?.length > 0
                          ? p.listings.map((l: any) => (
                              <span key={l.id}
                                title={statusLabel[l.status] || l.status}
                                className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${listingChipColor[l.status] || listingChipDefaultColor}`}>
                                {l.connection?.name || 'ML'}
                              </span>
                            ))
                          : <span className="text-gray-400 text-xs">Sin publicar</span>
                        }
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right space-x-3">
                    {p.listings?.some((l: any) => l.status === 'ACTIVE' || l.status === 'PAUSED') && (
                      <button onClick={() => handleSyncAll(p.id)} disabled={syncAllLoading === p.id}
                        className="text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50">
                        {syncAllLoading === p.id ? 'Sincronizando...' : 'Resincronizar'}
                      </button>
                    )}
                    <button onClick={() => openModal(p)}
                      className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                      Gestionar
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && products.length === 0 && (
              <tr><td colSpan={(isAdmin ? 9 : 8) + (activeConnections.length > 0 ? 2 : 0)} className="px-4 py-8 text-center text-gray-400">Sin productos que coincidan con los filtros.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={(isAdmin ? 9 : 8) + (activeConnections.length > 0 ? 2 : 0)} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
            )}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => loadProducts(page - 1)}
              disabled={page <= 1}
              className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
            >
              ← Anterior
            </button>
            <span className="text-sm text-gray-500">Página {page} de {pages}</span>
            <button
              onClick={() => loadProducts(page + 1)}
              disabled={page >= pages}
              className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>
      </>
      )}

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-12 px-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                {selected.id ? (
                  <>
                    <p className="font-mono text-xs text-gray-400 mb-0.5">{selected.sku}</p>
                    <h3 className="font-semibold text-gray-900">{selected.name}</h3>
                  </>
                ) : (
                  <h3 className="font-semibold text-gray-900">Nuevo producto</h3>
                )}
              </div>
              <button onClick={() => { setSelected(null); setPendingPublishTargets([]); }}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </div>

            <div className="flex items-center border-b border-gray-200 px-6">
              {(selected.id
                ? (['edit', 'images', 'ml', 'stock'] as Tab[]).filter((t) => t !== 'ml' || hasMlModule)
                : (['edit'] as Tab[])
              ).map((t) => (
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

            {pendingPublishTargets.length > 0 && (
              <div className="mx-6 mt-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
                <span>
                  Falta publicar en {pendingPublishTargets.length} conexión{pendingPublishTargets.length > 1 ? 'es' : ''}.
                  {' '}Sube al menos una foto en la pestaña "Imágenes" para poder publicar.
                </span>
                <button
                  onClick={handlePublishPending}
                  disabled={!selected?.images?.length || editLoading}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shrink-0"
                >
                  {editLoading ? 'Publicando...' : 'Publicar ahora'}
                </button>
              </div>
            )}

            <div className="p-6 max-h-[65vh] overflow-y-auto">

              {tab === 'edit' && (
                <form onSubmit={handleEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {!selected.id && activeConnections.length > 0 && (
                  <div className="col-span-2 border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Publicar en marketplaces</p>
                    <div className="space-y-1.5">
                      {activeConnections.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={!!publishTargets[c.id]}
                            onChange={(e) => setPublishTargets((p) => ({ ...p, [c.id]: e.target.checked }))} />
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs text-gray-400">({MARKETPLACE_LABELS[c.marketplace] ?? c.marketplace})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">SKU *</label>
                    <input value={editForm.sku || ''}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, sku: e.target.value }))}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tipo *</label>
                    <select
                      value={editForm.type || 'ARTICULO'}
                      onChange={(e) => setEditForm((f: any) => ({
                        ...f,
                        type: e.target.value,
                        ...(e.target.value === 'SERVICIO' ? { stock: '0', warehouseId: '' } : {}),
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      <option value="ARTICULO">Artículo</option>
                      <option value="SERVICIO">Servicio</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
                    <input value={editForm.category || ''}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, category: e.target.value }))}
                      list="category-suggestions"
                      placeholder="Ej: Electrónica"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {hasPosModule ? 'Precio Venta - Tienda Física *' : 'Precio *'}
                    </label>
                    <input type="number" step="0.01" min="0" value={editForm.price}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, price: e.target.value }))}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  {hasMlModule && (selected.id || mlChecked) && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Precio venta ML</label>
                      <input type="number" step="0.01" min="0" value={editForm.mlPrice}
                        onChange={(e) => setEditForm((f: any) => ({ ...f, mlPrice: e.target.value }))}
                        placeholder="Igual al de venta directa si se deja vacío"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Costo
                      {costLockedByLots && <span className="ml-1 text-gray-400 font-normal">(calculado por lotes)</span>}
                    </label>
                    <input type="number" step="0.01" min="0" value={editForm.cost}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, cost: e.target.value }))}
                      disabled={costLockedByLots}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400" placeholder="0.00" />
                    {costLockedByLots && (
                      <p className="text-xs text-gray-400 mt-1">
                        Este producto ya tiene compras registradas — el costo se recalcula automáticamente. Ver <a href="/dashboard/purchases" className="underline hover:text-gray-600">Compras</a>.
                      </p>
                    )}
                  </div>
                  {hasDropshippingModule && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Precio proveedor <span className="text-gray-400 font-normal">(dropshipping)</span>
                      </label>
                      <input type="number" step="0.01" min="0" value={editForm.supplierPrice}
                        onChange={(e) => setEditForm((f: any) => ({ ...f, supplierPrice: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0.00" />
                      <p className="text-xs text-gray-400 mt-1">
                        Lo que cobra el proveedor que despacha. Distinto del precio de venta. Ver <a href="/dashboard/dropshipping" className="underline hover:text-gray-600">Dropshipping</a>.
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Stock
                      {editForm.type === 'SERVICIO' && <span className="ml-1 text-gray-400 font-normal">(no aplica a servicios)</span>}
                    </label>
                    <input type="number" min="0" value={editForm.stock}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, stock: e.target.value }))}
                      disabled={editForm.type === 'SERVICIO'}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Stock crítico
                      {editForm.type === 'SERVICIO' && <span className="ml-1 text-gray-400 font-normal">(no aplica a servicios)</span>}
                    </label>
                    <input type="number" min="0" value={editForm.criticalStock}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, criticalStock: e.target.value }))}
                      disabled={editForm.type === 'SERVICIO'}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400" />
                    <p className="text-xs text-gray-400 mt-1">Al llegar a este stock, las ventas de marketplaces pausan la publicación.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bodega</label>
                    <select
                      value={editForm.warehouseId || ''}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, warehouseId: e.target.value }))}
                      disabled={editForm.type === 'SERVICIO'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="">— Sin bodega asignada —</option>
                      {warehouses.filter((w) => w.active).map((w: any) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  {hasMlModule && (selected.id || mlChecked) && (
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
                  )}
                  {hasMlModule && (selected.id || mlChecked) && (
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Dimensiones del paquete de envío (opcional)
                      </label>
                      <div className="grid grid-cols-4 gap-2">
                        <input type="number" min={0} step="0.1" value={editForm.packageHeight}
                          onChange={(e) => setEditForm((f: any) => ({ ...f, packageHeight: e.target.value }))}
                          placeholder="Alto (cm)"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" min={0} step="0.1" value={editForm.packageWidth}
                          onChange={(e) => setEditForm((f: any) => ({ ...f, packageWidth: e.target.value }))}
                          placeholder="Ancho (cm)"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" min={0} step="0.1" value={editForm.packageLength}
                          onChange={(e) => setEditForm((f: any) => ({ ...f, packageLength: e.target.value }))}
                          placeholder="Largo (cm)"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" min={0} step="1" value={editForm.packageWeight}
                          onChange={(e) => setEditForm((f: any) => ({ ...f, packageWeight: e.target.value }))}
                          placeholder="Peso (g)"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Algunas categorías de Mercado Libre las exigen para calcular el envío. Si las dejas vacías, se manda un paquete genérico chico (15×15×10 cm, 500 g) al publicar.
                      </p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Descripción corta</label>
                    <textarea value={editForm.description}
                      onChange={(e) => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                      rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  {hasMlModule && (selected.id || mlChecked) && (
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
                  )}

                  {hasMlModule && (selected.id || mlChecked) && (
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
                  )}
                  {editError && <p className="col-span-2 text-red-600 text-sm">{editError}</p>}
                  <div className="col-span-2">
                    <button type="submit" disabled={editLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                      {selected.id
                        ? (editLoading ? 'Guardando...' : 'Guardar cambios')
                        : (editLoading ? 'Creando...' : 'Crear producto')}
                    </button>
                  </div>
                </fieldset>
                </form>
              )}

              {tab === 'images' && (
                <div>
                  {selected.images?.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
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
                      Subir imágenes (JPG, PNG, WebP · máx. 5 MB c/u · puedes elegir varias a la vez)
                    </label>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
                      onChange={handleUpload} disabled={uploadLoading}
                      className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50" />
                    {uploadLoading && <p className="text-xs text-gray-400 mt-2">Subiendo imágenes...</p>}
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
                              {new Date(mov.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz })}
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
                  {selected.listings?.filter((l: any) => l.status === 'ACTIVE' || l.status === 'PAUSED').length > 1 && (
                    <div className="flex justify-end">
                      <button onClick={() => handleSyncAll(selected.id)} disabled={syncAllLoading === selected.id}
                        className="px-3 py-1.5 border border-amber-300 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50">
                        {syncAllLoading === selected.id ? 'Sincronizando todas...' : 'Sincronizar todas las publicaciones'}
                      </button>
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
                        {listing?.externalId && (
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-400">ID:</span>
                            <code className="text-xs font-mono bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">
                              {listing.externalId}
                            </code>
                            <button type="button"
                              onClick={() => navigator.clipboard.writeText(listing.externalId)}
                              className="text-xs text-blue-500 hover:text-blue-700">
                              Copiar
                            </button>
                          </div>
                        )}
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
                          <button onClick={() => openLinkModal(conn.id, conn.name)}
                            title="Asociar este producto a una publicación que ya existe en la plataforma, sin crear una nueva ni importar catálogo"
                            className="px-3 py-1.5 border border-gray-300 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50">
                            {listing ? 'Editar vínculo' : 'Vincular manualmente'}
                          </button>
                          {listing && (currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN') && (
                            <button onClick={() => handleDeleteListing(conn.id)}
                              disabled={mlLoading[`delete_${conn.id}`]}
                              title="Borra el vínculo interno con el marketplace sin afectar la publicación real"
                              className="px-3 py-1.5 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50">
                              {mlLoading[`delete_${conn.id}`] ? 'Eliminando...' : 'Eliminar publicación'}
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
          onSaleTermChange={updateSaleTermValue}
        />
      )}
      {linkModal && (
        <LinkListingModal
          state={linkModal}
          onChange={setLinkModal}
          onSubmit={handleLinkSubmit}
          onClose={() => setLinkModal(null)}
          loading={linkLoading}
          error={linkError}
        />
      )}
      {mergeCandidates && (
        <MergeModal
          products={mergeCandidates.products}
          connectionConflicts={mergeCandidates.connectionConflicts}
          onClose={() => { setMergeCandidates(null); setMergeError(''); }}
          onConfirm={handleConfirmMerge}
          submitting={mergeSubmitting}
          error={mergeError}
        />
      )}
    </div>
  );
}
