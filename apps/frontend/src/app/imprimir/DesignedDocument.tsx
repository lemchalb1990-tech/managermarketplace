'use client';

import type { CSSProperties, ReactNode } from 'react';
import { imgUrl } from '@/lib/api';
import { Barcode128 } from '@/components/Barcode128';
import { SIZE_FACTOR, DEFAULT_MARGINS, type PrintBlock, type PrintDoc, type TicketMargins } from '@/lib/printDesign';
import { type PrintFormat, type DocHeaderData, PrintButton, fmtCLP, logoStyle } from './printLayout';

// Documento impreso armado con el diseño por bloques de la empresa. Lo usan las páginas de
// impresión (venta y orden de trabajo) y la vista previa del editor, así lo que se ve al
// editar es lo que sale impreso.

export interface DocItem { id: string; name: string; sku?: string | null; quantity: number; unitPrice: number }

export interface PrintDocData {
  header: DocHeaderData;
  // Subtítulo de la hoja carta bajo el título (p. ej. «Comprobante de venta»).
  subtitle?: string;
  status?: string | null;
  client?: { name?: string | null; rut?: string | null; phone?: string | null; email?: string | null } | null;
  items: DocItem[];
  total: number;
  // Boletas o facturas emitidas («Boleta N° 123»).
  documents?: string[];
  notes?: string | null;
  scan?: { code: string; label: string } | null;
  // Leyenda al pie (ticket y carta).
  legend?: { ticket: string; carta: string } | null;
}

type Content = { ticket: ReactNode; carta?: ReactNode } | null;

const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 6 };

function buildContent(doc: PrintDoc, d: PrintDocData, format: PrintFormat, blk: (id: string) => PrintBlock | undefined): Record<string, Content> {
  const h = d.header;
  const p = h.profile;
  const narrow = format === 'TICKET_58';
  const showRazon = p?.razonSocial && p.razonSocial.trim().toLowerCase() !== h.commercialName.trim().toLowerCase();
  const address = [p?.address, p?.commune].filter(Boolean).join(', ');
  const logoFactor = SIZE_FACTOR[blk('logo')?.size ?? 'M'];
  const logo = (fmt: PrintFormat) => {
    const st = logoStyle(fmt, p?.logoSize);
    return { ...st, height: Math.round(Number(st.height) * logoFactor) };
  };
  const c = d.client;
  const clientLines = [c?.name, c?.rut ? `RUT ${c.rut}` : null, c?.phone, c?.email].filter(Boolean) as string[];
  const muted = { color: '#475569' };

  return {
    logo: p?.logoUrl ? {
      // eslint-disable-next-line @next/next/no-img-element
      ticket: <img src={imgUrl(p.logoUrl)} alt="" style={{ ...logo(format), display: 'inline-block' }} />,
      // eslint-disable-next-line @next/next/no-img-element
      carta: <img src={imgUrl(p.logoUrl)} alt="" style={{ ...logo('CARTA'), display: 'inline-block' }} />,
    } : null,
    nombre: { ticket: <p>{h.commercialName}</p> },
    empresa: showRazon || p?.rut ? {
      ticket: <>{showRazon && <p>{p.razonSocial}</p>}{p?.rut && <p>RUT {p.rut}</p>}</>,
    } : null,
    direccion: address || p?.phone ? {
      ticket: <>{address && <p>{address}</p>}{p?.phone && <p>{p.phone}</p>}</>,
      carta: <>{address && <p>{address}</p>}{(p?.phone || p?.email) && <p>{[p.phone, p.email].filter(Boolean).join(' · ')}</p>}</>,
    } : null,
    titulo: {
      ticket: <p>{h.title}{h.folio ? ` N° ${h.folio}` : ''}</p>,
      carta: <><p style={{ fontSize: '1.4em' }}>{h.title}{h.folio ? ` N° ${h.folio}` : ''}</p>{d.subtitle && <p style={{ ...muted, fontWeight: 400, fontSize: '0.9em' }}>{d.subtitle}</p>}</>,
    },
    estado: d.status ? { ticket: <p>Estado: {d.status}</p> } : null,
    datos: {
      ticket: <>
        <div style={row}><span>Fecha</span><span>{h.date}</span></div>
        <div style={row}><span>Hora</span><span>{h.time}</span></div>
        <div style={row}><span>Vendedor</span><span style={{ textAlign: 'right' }}>{h.seller || '—'}</span></div>
        <div style={row}><span>{narrow ? 'Pago' : 'Forma de pago'}</span><span style={{ textAlign: 'right' }}>{h.payment}</span></div>
      </>,
      carta: <div style={muted}>
        <p>Fecha: {h.date} · Hora: {h.time}</p>
        <p>Vendedor: {h.seller || '—'}</p>
        <p>Forma de pago: {h.payment}</p>
      </div>,
    },
    cliente: clientLines.length ? {
      ticket: <>{c?.name && <p>Cliente: {c.name}</p>}{c?.rut && <p>RUT: {c.rut}</p>}{c?.phone && <p>Teléfono: {c.phone}</p>}</>,
      carta: <><p style={{ fontWeight: 700 }}>Cliente</p>{clientLines.map((l, i) => <p key={i} style={i ? muted : undefined}>{l}</p>)}</>,
    } : null,
    productos: {
      ticket: <>{d.items.map((it) => (
        <div key={it.id} style={{ marginBottom: 4 }}>
          <p>{it.name}{doc === 'WORK_ORDER' && it.sku ? ` (${it.sku})` : ''}</p>
          <div style={row}><span>{it.quantity} x {fmtCLP(it.unitPrice)}</span><span>{fmtCLP(it.quantity * it.unitPrice)}</span></div>
        </div>
      ))}</>,
      carta: (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['Descripción', 'Cant.', 'Precio unit.', 'Subtotal'].map((t, i) => (
                <th key={t} style={{ padding: '8px 10px', textAlign: i ? 'right' : 'left', borderBottom: '2px solid #0f172a', fontSize: 12, textTransform: 'uppercase', color: '#475569' }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.items.map((it) => (
              <tr key={it.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '8px 10px' }}>{it.name}{it.sku ? ` (${it.sku})` : ''}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{it.quantity}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtCLP(it.unitPrice)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtCLP(it.quantity * it.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    total: {
      ticket: <div style={row}><span>Total</span><span>{fmtCLP(d.total)}</span></div>,
      carta: <div style={{ display: 'inline-flex', minWidth: 200, justifyContent: 'space-between', gap: 24, borderTop: '2px solid #0f172a', paddingTop: 8 }}><span>Total</span><span>{fmtCLP(d.total)}</span></div>,
    },
    documentos: d.documents?.length ? { ticket: <>{d.documents.map((x) => <p key={x}>{x}</p>)}</>, carta: <p>Documento tributario: {d.documents.join(', ')}</p> } : null,
    notas: d.notes ? { ticket: <><p style={{ fontWeight: 700 }}>Notas</p><p style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</p></> } : null,
    firmas: {
      ticket: <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 14 }}>
        <div style={{ borderTop: '1px solid #000', paddingTop: 2, textAlign: 'center' }}>Firma cliente</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: 2, textAlign: 'center' }}>Firma responsable</div>
      </div>,
      carta: <div style={{ display: 'flex', justifyContent: 'space-between', gap: 40 }}>
        {['Firma cliente', 'Firma responsable'].map((t) => <div key={t} style={{ flex: 1, textAlign: 'center', borderTop: '1px solid #0f172a', paddingTop: 6, fontSize: 12, color: '#475569' }}>{t}</div>)}
      </div>,
    },
    mensaje: blk('mensaje')?.text?.trim() ? { ticket: <p style={{ whiteSpace: 'pre-wrap' }}>{blk('mensaje')!.text}</p> } : null,
    leyenda: d.legend ? { ticket: <p>{d.legend.ticket}</p>, carta: <p style={{ color: '#94a3b8' }}>{d.legend.carta}</p> } : null,
    codigo: d.scan ? {
      ticket: <><Barcode128 value={d.scan.code} height={narrow ? 40 : 44} module={narrow ? 1.5 : 1.8} /><p style={{ fontSize: '0.8em', marginTop: 2 }}>{d.scan.label}</p></>,
      carta: <><Barcode128 value={d.scan.code} height={56} module={2} /><p style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{d.scan.label}</p></>,
    } : null,
  };
}

const SEP_STYLE: Record<string, string> = { dash: '1px dashed #000', solid: '1px solid #000', double: '3px double #000' };
const ALIGN_ITEMS: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

export function DesignedDocument({ doc, format, blocks, data, margins, preview = false, selected, onSelect }: {
  doc: PrintDoc;
  format: PrintFormat;
  blocks: PrintBlock[];
  data: PrintDocData;
  // Bordes del ticket (mm); sin dato, los predeterminados del formato.
  margins?: TicketMargins;
  // Vista previa del editor: sin botón Imprimir ni reglas de página; bloques clicables.
  preview?: boolean;
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const blk = (id: string) => blocks.find((x) => x.id === id);
  const content = buildContent(doc, data, format, blk);
  const carta = format === 'CARTA';
  const pick = (x: PrintBlock) => {
    const c = content[x.id];
    if (!c) return null;
    return carta ? (c.carta ?? c.ticket) : c.ticket;
  };

  const wrap = (x: PrintBlock, node: ReactNode, extra: CSSProperties = {}) => (
    <div
      key={x.id}
      data-block={x.id}
      onClick={onSelect ? () => onSelect(x.id) : undefined}
      style={{
        marginTop: carta ? Math.round(x.space * 1.5) : x.space,
        textAlign: x.align,
        fontSize: `${SIZE_FACTOR[x.size]}em`,
        fontWeight: x.bold ? 700 : 400,
        ...(['codigo', 'total'].includes(x.id) && carta ? { display: 'flex', flexDirection: 'column', alignItems: ALIGN_ITEMS[x.align] } : {}),
        ...(x.id === 'codigo' && !carta ? { display: 'flex', flexDirection: 'column', alignItems: ALIGN_ITEMS[x.align] } : {}),
        ...(preview ? { cursor: 'pointer', borderRadius: 3, outline: selected === x.id ? '2px solid #0075de' : '1px dashed transparent', outlineOffset: 2 } : {}),
        ...extra,
      }}
    >
      {node}
    </div>
  );

  const render = (x: PrintBlock) => {
    if (!x.on) return null;
    if (x.sep) {
      // Los separadores son del ticket; la hoja carta tiene su propia estructura.
      if (carta) return null;
      return (
        <div key={x.id} data-block={x.id} onClick={onSelect ? () => onSelect(x.id) : undefined}
          style={{ padding: `${x.space}px 0`, ...(preview ? { cursor: 'pointer', outline: selected === x.id ? '2px solid #0075de' : 'none', outlineOffset: 2 } : {}) }}>
          <div style={{ borderTop: SEP_STYLE[x.sep] }} />
        </div>
      );
    }
    const node = pick(x);
    return node == null ? null : wrap(x, node);
  };

  if (!carta) {
    const paper = format === 'TICKET_58' ? 58 : 80;
    const m = margins ?? DEFAULT_MARGINS[format];
    const contentMm = Math.max(20, paper - 2 * m.side);
    const body = (
      <div style={{ fontFamily: 'monospace', color: '#000', background: preview ? 'transparent' : '#fff', width: `${contentMm}mm`, margin: '0 auto', padding: preview ? 0 : `${m.vertical}mm 0`, fontSize: format === 'TICKET_58' ? 10 : 12, lineHeight: 1.3, wordBreak: 'break-word' }}>
        {!preview && (
          <>
            <style>{`
              @media print {
                .no-print { display: none !important; }
                html, body { margin: 0; padding: 0; }
                @page { size: ${paper}mm auto; margin: 0 ${m.side}mm; }
              }
            `}</style>
            <PrintButton />
          </>
        )}
        <style>{'.designed-doc p { margin: 0; }'}</style>
        <div className="designed-doc">{blocks.map(render)}</div>
      </div>
    );
    if (!preview) return body;
    // Vista previa: el papel completo con sus bordes marcados en línea punteada.
    return (
      <div style={{ width: `${paper}mm`, padding: `${m.vertical}mm ${m.side}mm`, background: '#fff', backgroundImage: `linear-gradient(to right, transparent ${m.side}mm, #cbd5e1 ${m.side}mm, #cbd5e1 calc(${m.side}mm + 1px), transparent calc(${m.side}mm + 1px), transparent calc(100% - ${m.side}mm - 1px), #cbd5e1 calc(100% - ${m.side}mm - 1px), #cbd5e1 calc(100% - ${m.side}mm), transparent calc(100% - ${m.side}mm))` }}>
        {body}
      </div>
    );
  }

  const zone = (z: string) => blocks.filter((x) => x.zone === z).map(render);
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', background: '#fff', maxWidth: 720, margin: '0 auto', padding: preview ? 28 : 32, fontSize: 13, lineHeight: 1.4, ...(preview ? { minHeight: 600, display: 'flex', flexDirection: 'column' } : {}) }}>
      {!preview && (
        <>
          <style>{'@media print { .no-print { display: none !important; } body { margin: 0; } }'}</style>
          <PrintButton align="right" />
        </>
      )}
      <style>{'.designed-doc p { margin: 0; }'}</style>
      <div className="designed-doc" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, borderBottom: '2px solid #0f172a', paddingBottom: 14, marginBottom: 6 }}>
          <div style={{ minWidth: 0 }}>{zone('izq')}</div>
          <div style={{ minWidth: 0 }}>{zone('der')}</div>
        </div>
        {zone('cuerpo')}
        <div style={{ marginTop: preview ? 'auto' : 24, paddingTop: 12 }}>{zone('pie')}</div>
      </div>
    </div>
  );
}
