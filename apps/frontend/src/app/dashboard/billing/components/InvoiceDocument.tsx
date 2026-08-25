import { imgUrl } from '@/lib/api';

export interface InvoiceDocumentItem {
  name: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

interface Props {
  profile: any;
  dteLabel: string;
  folio?: number | string | null;
  statusBadge?: React.ReactNode;
  connectionName?: string;
  connectionProvider?: string;
  receptor: { razonSocial: string; rut: string; giro?: string; address?: string; commune?: string; email?: string };
  items: InvoiceDocumentItem[];
  isTaxed: boolean;
  netAmount: number;
  tax: number;
  totalAmount: number;
  notes?: string;
  extraNote?: React.ReactNode;
}

const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.round(n));

// Vista "hoja" de un documento tributario — usada tanto en la vista previa antes de emitir
// (Emitir DTE) como en el visor de un documento ya emitido/guardado (Documentos).
export default function InvoiceDocument({
  profile, dteLabel, folio, statusBadge, connectionName, connectionProvider,
  receptor, items, isTaxed, netAmount, tax, totalAmount, notes, extraNote,
}: Props) {
  const itemTotal = (i: InvoiceDocumentItem) => i.unitPrice * i.quantity * (1 - (i.discount ?? 0) / 100);

  return (
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
          <p className="text-red-700 font-extrabold text-sm mt-1 uppercase leading-snug">{dteLabel}</p>
          <p className="text-gray-400 text-xs mt-1">{folio ? `N° ${folio}` : 'N° folio pendiente de emisión'}</p>
          {profile?.resolutionNumber && (
            <p className="text-gray-400 text-[10px] mt-1">
              Res. {profile.resolutionNumber}
              {profile.resolutionDate && ` del ${new Date(profile.resolutionDate).toLocaleDateString('es-CL')}`}
            </p>
          )}
          {statusBadge && <div className="mt-2">{statusBadge}</div>}
        </div>
      </div>

      {/* Receptor */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-6 pb-5 border-b border-gray-200">
        <div className="col-span-2">
          <span className="text-gray-400">Señor(es): </span>
          <span className="font-semibold text-gray-900">{receptor.razonSocial || '—'}</span>
        </div>
        <div><span className="text-gray-400">R.U.T.: </span><span className="text-gray-800 font-medium">{receptor.rut || '—'}</span></div>
        <div><span className="text-gray-400">Giro: </span><span className="text-gray-800">{receptor.giro || '—'}</span></div>
        <div className="col-span-2">
          <span className="text-gray-400">Dirección: </span>
          <span className="text-gray-800">{[receptor.address, receptor.commune].filter(Boolean).join(', ') || '—'}</span>
        </div>
        {receptor.email && <div className="col-span-2"><span className="text-gray-400">Contacto: </span><span className="text-gray-800">{receptor.email}</span></div>}
        {extraNote}
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
          {items.map((item, idx) => {
            const breakAt = item.name.indexOf('\n');
            const shortName = breakAt === -1 ? item.name : item.name.slice(0, breakAt);
            const longDescription = breakAt === -1 ? '' : item.name.slice(breakAt + 1);
            return (
              <tr key={idx} className="border-b border-gray-100">
                <td className="py-2 pr-2 text-gray-800 align-top">
                  <span>{shortName}</span>
                  {longDescription && (
                    <span className="block text-gray-400 text-[11px] mt-0.5 whitespace-pre-wrap">{longDescription}</span>
                  )}
                </td>
                <td className="py-2 text-center text-gray-600 align-top">{item.quantity}</td>
                <td className="py-2 text-right text-gray-600 align-top">{fmt(item.unitPrice)}</td>
                <td className="py-2 text-center text-gray-600 align-top">{item.discount ? `${item.discount}%` : '—'}</td>
                <td className="py-2 text-right font-medium text-gray-900 align-top">{fmt(itemTotal(item))}</td>
              </tr>
            );
          })}
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

      {notes && (
        <p className="text-xs text-gray-500 pt-3 border-t border-dashed border-gray-200 mb-2">
          <span className="text-gray-400">Observaciones: </span>{notes}
        </p>
      )}

      <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
        <span>{profile?.footerText || 'Documento generado electrónicamente'}</span>
        {(connectionName || connectionProvider) && (
          <span>{[connectionName, connectionProvider].filter(Boolean).join(' · ')}</span>
        )}
      </div>
    </div>
  );
}
