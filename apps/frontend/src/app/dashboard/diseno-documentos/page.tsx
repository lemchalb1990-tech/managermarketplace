'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { useAdminCompany } from '../AdminCompanyContext';
import { DesignedDocument, type PrintDocData } from '@/app/imprimir/DesignedDocument';
import { PRINT_FORMAT_LABEL, type PrintFormat } from '@/app/imprimir/printLayout';
import {
  PRINT_DOC_LABEL, blockLabel, defaultLayout, resolveLayout,
  type PrintBlock, type PrintDoc, type PrintLayouts, type BlockAlign, type BlockSize, type BlockSep, type BlockZone,
} from '@/lib/printDesign';

const DOCS: PrintDoc[] = ['SALE', 'WORK_ORDER'];
const FORMATS: PrintFormat[] = ['TICKET', 'TICKET_58', 'CARTA'];

const SIZE_OPTS: [BlockSize, string][] = [['S', 'Chico'], ['M', 'Normal'], ['L', 'Grande'], ['XL', 'Muy grande']];
const ALIGN_OPTS: [BlockAlign, string][] = [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']];
const SEP_OPTS: [BlockSep, string][] = [['dash', '- - -'], ['solid', '———'], ['double', '═══']];
const ZONE_OPTS: [BlockZone, string][] = [['izq', 'Enc. izquierdo'], ['der', 'Enc. derecho'], ['cuerpo', 'Cuerpo'], ['pie', 'Pie']];

// Datos de ejemplo para la vista previa (el membrete es el real de la empresa).
function sampleData(doc: PrintDoc, commercialName: string, profile: unknown): PrintDocData {
  const items = [
    { id: '1', name: 'Audífonos Bluetooth TWS Pro', sku: 'AUD-TWS-01', quantity: 1, unitPrice: 19990 },
    { id: '2', name: 'Cable USB-C carga rápida 2 m', sku: 'CAB-UC-2M', quantity: 2, unitPrice: 4990 },
    { id: '3', name: 'Soporte celular para auto', sku: 'SOP-AUT-03', quantity: 1, unitPrice: 7990 },
  ];
  const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const header = {
    commercialName, profile, title: doc === 'SALE' ? 'Venta' : 'Orden de trabajo', folio: '0158',
    date: '14-10-2026', time: '17:42', seller: 'Camila Rojas', payment: doc === 'SALE' ? 'Débito' : 'Por definir',
  };
  if (doc === 'SALE') {
    return {
      header, subtitle: 'Comprobante de venta', items, total,
      client: { name: 'Javiera Soto', rut: '18.765.432-1' },
      notes: 'Entregar con caja de regalo.',
      scan: { code: '0158', label: 'Venta N° 0158' },
      legend: { ticket: 'Comprobante interno, no válido como boleta.', carta: 'Comprobante interno de venta, no constituye boleta ni factura.' },
    };
  }
  return {
    header, subtitle: 'Presupuesto / Orden de trabajo · Presupuesto pendiente', status: 'Presupuesto pendiente', items, total,
    client: { name: 'Javiera Soto', phone: '+56 9 8765 4321', email: 'javiera@correo.cl' },
    notes: 'Revisar conector de carga.',
    legend: {
      ticket: 'Presupuesto/orden de trabajo, no constituye boleta ni factura.',
      carta: 'Este documento es un presupuesto/orden de trabajo, no constituye una boleta ni factura.',
    },
  };
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div>
      <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] p-1">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
            className={`flex-1 min-w-[56px] rounded-md px-2 py-1.5 text-xs ${value === v ? 'bg-[var(--navy)] text-white font-semibold' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// Diseño de documentos: editor por bloques del comprobante de venta y de la orden de trabajo,
// cada uno por separado. El mismo diseño se usa en ticket 80 mm, 58 mm y hoja carta.
export default function PrintDesignPage() {
  const { isSuperAdmin, selectedCompanyId, companyId, companies } = useAdminCompany();
  const noCompany = isSuperAdmin && !selectedCompanyId;
  // El diseño es de cada empresa: el Super Admin edita el de la empresa que está gestionando.
  const companyLabel = isSuperAdmin ? companies.find((c) => c.id === selectedCompanyId)?.name : null;
  const [doc, setDoc] = useState<PrintDoc>('SALE');
  const [layouts, setLayouts] = useState<Record<PrintDoc, PrintBlock[]> | null>(null);
  const [format, setFormat] = useState<PrintFormat>('TICKET');
  const [profile, setProfile] = useState<unknown>(null);
  const [selected, setSelected] = useState<string>('total');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token || noCompany) return;
    let alive = true;
    Promise.all([
      api.pos.settings.get(token, companyId).catch(() => null),
      api.billing.profile.get(token, companyId).catch(() => null),
    ]).then(([s, p]) => {
      if (!alive) return;
      const saved: PrintLayouts | null = s?.printLayouts ?? null;
      setLayouts({ SALE: resolveLayout(saved, 'SALE'), WORK_ORDER: resolveLayout(saved, 'WORK_ORDER') });
      if (s?.printFormat) setFormat(s.printFormat);
      setProfile(p);
      setDirty(false);
    });
    return () => { alive = false; };
  }, [companyId, noCompany]);

  const commercialName = useMemo(() => {
    if (isSuperAdmin) return companies.find((c) => c.id === selectedCompanyId)?.name || 'Tu empresa';
    return getUser()?.company?.name || 'Tu empresa';
  }, [isSuperAdmin, companies, selectedCompanyId]);

  const blocks = layouts?.[doc] ?? [];
  const block = blocks.find((x) => x.id === selected) ?? blocks[0];

  function setBlocks(next: PrintBlock[]) {
    setLayouts((l) => (l ? { ...l, [doc]: next } : l));
    setDirty(true);
    setMsg('');
  }
  function patch(p: Partial<PrintBlock>) {
    if (!block) return;
    setBlocks(blocks.map((x) => (x.id === block.id ? { ...x, ...p } : x)));
  }
  function move(i: number, j: number) {
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }
  function onDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const next = blocks.filter((x) => x.id !== dragId);
    next.splice(next.findIndex((x) => x.id === targetId), 0, blocks.find((x) => x.id === dragId)!);
    setDragId(null);
    setBlocks(next);
  }
  function chooseDoc(d: PrintDoc) {
    setDoc(d);
    setSelected('total');
  }
  async function save() {
    if (!layouts) return;
    setSaving(true);
    setMsg('');
    try {
      await api.pos.settings.update({ printLayouts: layouts }, getToken()!, companyId);
      setDirty(false);
      setMsg('Diseño guardado. Se usa desde la próxima impresión.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
    setSaving(false);
  }

  if (noCompany) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Diseño de documentos" crumbs={[{ label: 'Ajustes del sistema' }, { label: 'Diseño de documentos' }, ...(companyLabel ? [{ label: companyLabel }] : [])]} />
        <p className="text-sm text-[var(--text-muted)]">Selecciona una empresa (arriba, «Gestionando empresa») para editar el diseño de sus documentos. Cada empresa tiene el suyo.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Diseño de documentos"
        crumbs={[{ label: 'Ajustes del sistema' }, { label: 'Diseño de documentos' }, ...(companyLabel ? [{ label: companyLabel }] : [])]}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 border-b border-[var(--border)]" role="tablist" aria-label="Documento">
          {DOCS.map((d) => (
            <button key={d} role="tab" aria-selected={doc === d} onClick={() => chooseDoc(d)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${doc === d ? 'border-[var(--brand)] text-[var(--brand-ink)] font-semibold' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
              {PRINT_DOC_LABEL[d]}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)]">Diseño propio de esta empresa. Cada documento se diseña por separado y se usa en ticket 80 mm, 58 mm y hoja carta.</p>
      </div>

      {!layouts ? (
        <div className="ui-card p-6 text-sm text-[var(--text-muted)]">Cargando…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[250px_1fr_290px] gap-4 items-start">
          {/* Bloques */}
          <div className="ui-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-soft)] flex items-center justify-between">
              <h2 className="text-sm font-semibold">Bloques</h2>
              <span className="text-[11px] text-[var(--text-muted)]">arrastra o usa ↑ ↓</span>
            </div>
            <ul className="p-1.5" role="listbox" aria-label="Bloques del documento">
              {blocks.map((x, i) => (
                <li key={x.id} role="option" aria-selected={block?.id === x.id} draggable
                  onDragStart={() => setDragId(x.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, x.id)}
                  onClick={() => setSelected(x.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] cursor-pointer border ${block?.id === x.id ? 'bg-[var(--brand-light)] border-[var(--brand)]' : 'border-transparent hover:bg-[var(--surface-soft)]'} ${dragId === x.id ? 'opacity-40' : ''}`}>
                  <span className="text-[var(--text-muted)] cursor-grab select-none" aria-hidden="true">⋮⋮</span>
                  <span className={`flex-1 min-w-0 truncate ${x.on ? '' : 'line-through text-[var(--text-muted)]'}`}>{blockLabel(x.id)}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); move(i, i - 1); }} disabled={i === 0}
                    aria-label={`Subir ${blockLabel(x.id)}`} className="w-6 h-6 rounded text-xs text-[var(--text-muted)] hover:bg-[var(--border)] disabled:opacity-30">↑</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); move(i, i + 1); }} disabled={i === blocks.length - 1}
                    aria-label={`Bajar ${blockLabel(x.id)}`} className="w-6 h-6 rounded text-xs text-[var(--text-muted)] hover:bg-[var(--border)] disabled:opacity-30">↓</button>
                </li>
              ))}
            </ul>
          </div>

          {/* Vista previa */}
          <div className="md:col-span-2 xl:col-span-1 xl:order-none order-first flex flex-col items-center gap-3 min-w-0">
            <div className="flex rounded-lg border border-[var(--border)] p-1 bg-[var(--surface)]" role="group" aria-label="Formato de la vista previa">
              {FORMATS.map((f) => (
                <button key={f} type="button" onClick={() => setFormat(f)} aria-pressed={format === f}
                  className={`px-3 py-1.5 rounded-md text-xs ${format === f ? 'bg-[var(--navy)] text-white font-semibold' : 'text-[var(--text-2)]'}`}>
                  {PRINT_FORMAT_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="w-full overflow-x-auto flex justify-center py-2">
              <div className={`shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)] bg-white ${format === 'CARTA' ? 'w-full max-w-[720px]' : ''}`}>
                <DesignedDocument doc={doc} format={format} blocks={blocks} data={sampleData(doc, commercialName, profile)}
                  preview selected={block?.id} onSelect={setSelected} />
              </div>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] text-center">Toca un dato del documento para editarlo. Datos de venta de ejemplo; el membrete es el de tu empresa.</p>
          </div>

          {/* Propiedades */}
          {block && (
            <div className="ui-card overflow-hidden xl:sticky xl:top-4">
              <div className="px-4 py-3 border-b border-[var(--border-soft)]">
                <h2 className="text-sm font-semibold">{blockLabel(block.id)}</h2>
                <p className="text-[11px] text-[var(--text-muted)]">Bloque seleccionado</p>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <label className="flex items-center justify-between text-sm">
                  Mostrar en el documento
                  <input type="checkbox" checked={block.on} onChange={(e) => patch({ on: e.target.checked })} className="w-4 h-4" />
                </label>
                {block.sep ? (
                  <>
                    <Seg label="Estilo de línea" value={block.sep} options={SEP_OPTS} onChange={(v) => patch({ sep: v })} />
                    <p className="text-[11px] text-[var(--text-muted)]">Los separadores solo se imprimen en ticket.</p>
                  </>
                ) : (
                  <>
                    <Seg label="Tamaño" value={block.size} options={SIZE_OPTS} onChange={(v) => patch({ size: v })} />
                    <Seg label="Alineación" value={block.align} options={ALIGN_OPTS} onChange={(v) => patch({ align: v })} />
                    <label className="flex items-center justify-between text-sm">
                      Negrita
                      <input type="checkbox" checked={block.bold} onChange={(e) => patch({ bold: e.target.checked })} className="w-4 h-4" />
                    </label>
                    <Seg label="Ubicación en hoja carta" value={block.zone} options={ZONE_OPTS} onChange={(v) => patch({ zone: v })} />
                  </>
                )}
                <div>
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Espacio {block.sep ? 'alrededor' : 'arriba'}: {block.space} px</span>
                  <input type="range" min={0} max={30} step={2} value={block.space} onChange={(e) => patch({ space: Number(e.target.value) })} className="w-full" aria-label="Espacio" />
                </div>
                {block.id === 'mensaje' && (
                  <div>
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Texto</span>
                    <textarea value={block.text ?? ''} maxLength={300} rows={3} onChange={(e) => patch({ text: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" placeholder="Ej: ¡Gracias por tu compra!" />
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-[var(--border-soft)] flex flex-wrap gap-2">
                <button type="button" onClick={save} disabled={saving || !dirty} className="ui-btn-brand disabled:opacity-50">
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" onClick={() => { setBlocks(defaultLayout(doc)); setSelected('total'); }} className="ui-btn-secondary">
                  Restaurar predeterminado
                </button>
                {msg && <p className="w-full text-xs text-[var(--text-2)]">{msg}</p>}
                {dirty && !msg && <p className="w-full text-xs text-[var(--warn)]">Hay cambios sin guardar.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
