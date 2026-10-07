'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { alertDialog, confirmDialog } from '../ConfirmDialog';
import { TYPE_LABEL, clp, flattenTree, todayKey } from './finance-utils';
import { ColumnMap, buildLines, guessColumns } from './statement-parse';
import { Skeleton, SkeletonCards } from '@/components/Skeleton';

const BANK_TYPE: Record<string, string> = { BANK: 'Cuenta bancaria', CASH: 'Caja', CREDIT_CARD: 'Tarjeta de crédito', WALLET: 'Billetera digital' };
const STATUS_LABEL: Record<string, string> = { PENDING: 'Por conciliar', MATCHED: 'Conciliadas', IGNORED: 'Ya contabilizadas', '': 'Todas' };
const IGNORE_NOTES = [
  'Liquidación de marketplace (las ventas ya se cuentan solas)',
  'Pago a proveedor de mercadería (ya contado en Compras)',
  'Traspaso entre cuentas propias',
  'Otro',
];
const fmtDate = (d: string) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('es-CL');

export default function BanksTab({ companyId, version, onChanged }: { companyId?: string; version: number; onChanged: () => void }) {
  const [banks, setBanks] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [bankForm, setBankForm] = useState<any | null>(null);
  const [transferForm, setTransferForm] = useState<any | null>(null);
  const [lines, setLines] = useState<{ items: any[]; total: number; pages: number } | null>(null);
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [reconciling, setReconciling] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);

  const token = () => getToken()!;
  const loadBanks = () => {
    setLoading(true);
    Promise.all([api.finance.bankAccounts(token(), companyId), api.finance.transfers(token(), companyId), api.finance.accounts(token(), companyId)])
      .then(([b, t, a]) => {
        setBanks(b);
        setTransfers(t);
        setAccounts(a);
        setSelectedId((cur) => (cur && b.some((x: any) => x.id === cur) ? cur : b.find((x: any) => !x.archived)?.id || ''));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(loadBanks, [companyId, version]);

  const loadLines = () => {
    if (!selectedId) { setLines(null); return; }
    api.finance.transactions(selectedId, { status, page }, token()).then(setLines).catch(() => setLines(null));
  };
  useEffect(loadLines, [selectedId, status, page, version]);

  const refreshAll = () => { loadBanks(); loadLines(); onChanged(); };
  const selected = banks.find((b) => b.id === selectedId);
  const activeBanks = banks.filter((b) => !b.archived);

  async function saveBank() {
    try {
      const payload = { ...bankForm, initialBalance: Number(String(bankForm.initialBalance).replace(/[^\d-]/g, '')) || 0, companyId };
      if (bankForm.id) await api.finance.updateBankAccount(bankForm.id, payload, token());
      else setSelectedId((await api.finance.createBankAccount(payload, token())).id);
      setBankForm(null);
      refreshAll();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo guardar la cuenta');
    }
  }

  async function removeBank(b: any) {
    if (!(await confirmDialog(`¿Eliminar "${b.name}"? También se borran sus cartolas importadas.`, { danger: true }))) return;
    try {
      await api.finance.deleteBankAccount(b.id, token());
      refreshAll();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo eliminar');
    }
  }

  async function saveTransfer() {
    const amount = Number(String(transferForm.amount).replace(/[^\d]/g, ''));
    if (!transferForm.fromAccountId || !transferForm.toAccountId || !amount) { await alertDialog('Completa origen, destino y monto.'); return; }
    try {
      await api.finance.createTransfer({ ...transferForm, amount, companyId }, token());
      setTransferForm(null);
      refreshAll();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo registrar el traspaso');
    }
  }

  async function removeTransfer(t: any) {
    if (!(await confirmDialog(`¿Eliminar el traspaso de ${clp(Number(t.amount))}?`, { danger: true }))) return;
    await api.finance.deleteTransfer(t.id, token()).catch((e) => alertDialog(e.message));
    refreshAll();
  }

  async function autoMatch() {
    const res = await api.finance.autoMatch(selectedId, token());
    await alertDialog(res.matched ? `Se conciliaron ${res.matched} línea(s) automáticamente.` : 'No se encontraron coincidencias únicas por monto y fecha.');
    refreshAll();
  }

  async function unmatch(line: any) {
    await api.finance.reconcile(line.id, { action: 'unmatch' }, token()).catch((e) => alertDialog(e.message));
    refreshAll();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setBankForm({ name: '', type: 'BANK', bankName: '', accountNumber: '', initialBalance: '', initialDate: todayKey() })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">+ Nueva cuenta</button>
        {activeBanks.length >= 2 && (
          <button onClick={() => setTransferForm({ fromAccountId: activeBanks[0].id, toAccountId: activeBanks[1].id, amount: '', date: todayKey(), description: '' })}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Traspaso entre cuentas</button>
        )}
      </div>

      {loading ? <SkeletonCards count={3} className="grid grid-cols-1 md:grid-cols-3 gap-3" /> : !banks.length ? (
        <div className="p-10 text-center text-gray-400 text-sm border border-dashed border-gray-300 rounded-2xl">
          Registra tus cuentas bancarias, caja, tarjetas o billeteras (Mercado Pago) para ver sus saldos y conciliar las cartolas.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {banks.map((b) => (
            <button key={b.id} onClick={() => { setSelectedId(b.id); setPage(1); }}
              className={`text-left bg-white border rounded-2xl p-4 transition-colors ${b.id === selectedId ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 hover:border-gray-300'} ${b.archived ? 'opacity-50' : ''}`}>
              <p className="text-xs text-gray-500">{BANK_TYPE[b.type]}{b.bankName ? ` · ${b.bankName}` : ''}</p>
              <p className="font-semibold text-gray-900 truncate">{b.name}</p>
              <p className={`text-xl font-bold mt-1 ${b.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{clp(b.balance)}</p>
              <p className="text-[11px] text-gray-500 mt-1">
                {b.pendingCount ? <span className="text-amber-700">{b.pendingCount} por conciliar · </span> : ''}
                {b.lastStatementDate ? `Cartola al ${fmtDate(b.lastStatementDate)}` : 'Sin cartola'}
              </p>
              {b.lastStatementBalance != null && Math.abs(Number(b.lastStatementBalance) - b.balance) >= 1 && (
                <p className="text-[11px] text-amber-700" title="El saldo informado por el banco en la última línea no calza con el calculado">
                  Banco informa {clp(Number(b.lastStatementBalance))}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-white border border-gray-200 rounded-2xl">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <h2 className="ui-section-title mr-2">{selected.name}</h2>
            <button onClick={() => setImporting(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">Importar cartola</button>
            <button onClick={autoMatch} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50">Conciliar automáticamente</button>
            <button onClick={() => setBankForm({ ...selected, initialBalance: String(Math.round(Number(selected.initialBalance))), initialDate: String(selected.initialDate).slice(0, 10) })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50">Editar</button>
            <button onClick={() => removeBank(selected)} className="px-3 py-1.5 text-xs text-red-500 hover:text-red-700">Eliminar</button>
            <div className="ml-auto flex gap-1">
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <button key={k} onClick={() => { setStatus(k); setPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${status === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{v}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Fecha</th>
                  <th className="text-left px-3 py-2 font-medium">Descripción</th>
                  <th className="text-right px-3 py-2 font-medium">Monto</th>
                  <th className="text-left px-3 py-2 font-medium">Conciliación</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!lines?.items.length ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    {status === 'PENDING' ? 'No hay líneas por conciliar. Importa una cartola para empezar.' : 'Sin líneas.'}
                  </td></tr>
                ) : lines.items.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(l.date)}</td>
                    <td className="px-3 py-2">
                      <p className="text-gray-800">{l.description}</p>
                      {l.reference && <p className="text-[11px] text-gray-400">N° {l.reference}</p>}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${Number(l.amount) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{clp(Number(l.amount))}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {l.status === 'MATCHED' && l.movement && <>✓ {l.movement.account.name}: {l.movement.description}</>}
                      {l.status === 'MATCHED' && l.transfer && <>✓ Traspaso {l.transfer.fromAccount.name} → {l.transfer.toAccount.name}</>}
                      {l.status === 'IGNORED' && <span className="text-gray-500">{l.note || 'Ya contabilizada'}</span>}
                      {l.status === 'PENDING' && <span className="text-amber-700">Pendiente</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                      {l.status === 'PENDING'
                        ? <button onClick={() => setReconciling(l)} className="text-blue-600 hover:text-blue-800 font-medium">Conciliar</button>
                        : <button onClick={() => unmatch(l)} className="text-gray-500 hover:text-gray-800">Deshacer</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines && lines.pages > 1 && (
            <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-100">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border border-gray-300 rounded-lg text-xs disabled:opacity-40">← Anterior</button>
              <span className="text-xs text-gray-500">Página {page} de {lines.pages}</span>
              <button onClick={() => setPage((p) => Math.min(lines.pages, p + 1))} disabled={page >= lines.pages} className="px-3 py-1 border border-gray-300 rounded-lg text-xs disabled:opacity-40">Siguiente →</button>
            </div>
          )}
        </div>
      )}

      {transfers.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="ui-subsection-title mb-2">Traspasos entre cuentas</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {transfers.map((t) => (
              <li key={t.id} className="py-1.5 flex items-center gap-3">
                <span className="text-xs text-gray-400 w-20">{fmtDate(t.date)}</span>
                <span className="text-gray-700 flex-1">{t.fromAccount.name} → {t.toAccount.name}{t.description ? ` · ${t.description}` : ''}</span>
                <span className="font-medium text-gray-900">{clp(Number(t.amount))}</span>
                <button onClick={() => removeTransfer(t)} className="text-xs text-red-500 hover:text-red-700">Eliminar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bankForm && (
        <Modal title={bankForm.id ? 'Editar cuenta' : 'Nueva cuenta'} onClose={() => setBankForm(null)} onSave={saveBank}>
          <Field label="Nombre"><input value={bankForm.name} onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} placeholder="Ej: Cuenta corriente Banco Estado" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <select value={bankForm.type} onChange={(e) => setBankForm({ ...bankForm, type: e.target.value })} className={inputCls}>
                {Object.entries(BANK_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Banco / emisor"><input value={bankForm.bankName || ''} onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="N° de cuenta (opcional)"><input value={bankForm.accountNumber || ''} onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Saldo inicial">
              <input value={bankForm.initialBalance} onChange={(e) => setBankForm({ ...bankForm, initialBalance: e.target.value.replace(/[^\d-]/g, '') })} placeholder="0" className={`${inputCls} text-right`} />
            </Field>
            <Field label="A la fecha"><input type="date" value={bankForm.initialDate} onChange={(e) => setBankForm({ ...bankForm, initialDate: e.target.value })} className={inputCls} /></Field>
          </div>
          <p className="text-[11px] text-gray-400">El saldo se calcula desde esa fecha sumando la cartola importada, los movimientos pagados desde esta cuenta y los traspasos. Una tarjeta de crédito lleva saldo negativo (lo que se debe).</p>
          {bankForm.id && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={!!bankForm.archived} onChange={(e) => setBankForm({ ...bankForm, archived: e.target.checked })} /> Archivada</label>
          )}
        </Modal>
      )}

      {transferForm && (
        <Modal title="Traspaso entre cuentas" onClose={() => setTransferForm(null)} onSave={saveTransfer}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde">
              <select value={transferForm.fromAccountId} onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })} className={inputCls}>
                {activeBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Hacia">
              <select value={transferForm.toAccountId} onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })} className={inputCls}>
                {activeBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto">
              <input value={transferForm.amount ? Number(transferForm.amount).toLocaleString('es-CL') : ''} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value.replace(/[^\d]/g, '') })} className={`${inputCls} text-right`} />
            </Field>
            <Field label="Fecha"><input type="date" value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Descripción"><input value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} placeholder="Ej: Depósito de caja" className={inputCls} /></Field>
          <p className="text-[11px] text-gray-400">Un traspaso no es ingreso ni gasto: solo mueve saldo entre tus cuentas (p. ej. pagar la tarjeta de crédito desde la cuenta corriente).</p>
        </Modal>
      )}

      {importing && selected && (
        <ImportStatement bank={selected} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStatus('PENDING'); refreshAll(); }} />
      )}

      {reconciling && (
        <ReconcileModal line={reconciling} accounts={accounts} onClose={() => setReconciling(null)} onDone={() => { setReconciling(null); refreshAll(); }} />
      )}
    </div>
  );
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-gray-500">{label}</label>{children}</div>;
}

function Modal({ title, children, onClose, onSave, saveLabel = 'Guardar', wide }: {
  title: string; children: React.ReactNode; onClose: () => void; onSave?: () => void; saveLabel?: string; wide?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} p-6 space-y-3 max-h-[90vh] overflow-y-auto`}>
        <h3 className="ui-section-title">{title}</h3>
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
            {onSave ? 'Cancelar' : 'Cerrar'}
          </button>
          {onSave && (
            <button onClick={async () => { setSaving(true); try { await onSave(); } finally { setSaving(false); } }} disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saving ? 'Guardando...' : saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Importación de cartola: se sube el archivo, se muestran sus filas y se eligen las columnas.
function ImportStatement({ bank, onClose, onDone }: { bank: any; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const res = await api.finance.parseStatement(bank.id, file, getToken()!);
      setRows(res.rows);
      setMap(guessColumns(res.rows));
    } catch (e: any) {
      setError(e.message || 'No se pudo leer el archivo');
    } finally {
      setBusy(false);
    }
  }

  const parsed = useMemo(() => (rows && map && map.date >= 0 ? buildLines(rows, map) : null), [rows, map]);
  const width = rows ? Math.max(...rows.slice(0, 50).map((r) => r.length)) : 0;
  const colOptions = Array.from({ length: width }, (_, i) => {
    const header = map && map.headerRow >= 0 ? rows![map.headerRow][i] : '';
    return { value: i, label: `Col. ${i + 1}${header ? ` · ${header}` : ''}` };
  });
  const colSelect = (key: keyof ColumnMap, label: string, optional = true) => (
    <Field label={label}>
      <select value={map![key]} onChange={(e) => setMap({ ...map!, [key]: Number(e.target.value) })} className={inputCls}>
        {optional && <option value={-1}>—</option>}
        {colOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );

  async function doImport() {
    if (!parsed?.lines.length) { await alertDialog('No hay líneas válidas: revisa las columnas de fecha y monto.'); return; }
    try {
      const res = await api.finance.importStatement(bank.id, parsed.lines, getToken()!);
      await alertDialog(`Se importaron ${res.imported} línea(s)${res.duplicates ? `; ${res.duplicates} ya estaban importadas` : ''}. ${res.autoMatched ? `${res.autoMatched} se conciliaron solas.` : ''}`);
      onDone();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo importar');
    }
  }

  return (
    <Modal title={`Importar cartola · ${bank.name}`} onClose={onClose} onSave={rows ? doImport : undefined} saveLabel={`Importar ${parsed?.lines.length || 0} línea(s)`} wide>
      {!rows ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Descarga la cartola desde tu banco en Excel (.xlsx) o CSV y súbela acá. Si viene en .xls, ábrela y guárdala como .xlsx.</p>
          <input type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
          {busy && <p className="text-xs text-gray-400">Leyendo archivo...</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : map && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Fila de encabezados">
              <select value={map.headerRow} onChange={(e) => setMap({ ...map, headerRow: Number(e.target.value) })} className={inputCls}>
                <option value={-1}>Sin encabezados</option>
                {rows.slice(0, 30).map((r, i) => <option key={i} value={i}>Fila {i + 1}: {r.filter(Boolean).slice(0, 3).join(' | ').slice(0, 40)}</option>)}
              </select>
            </Field>
            {colSelect('date', 'Fecha', false)}
            {colSelect('description', 'Descripción')}
            {colSelect('reference', 'N° documento')}
            {colSelect('amount', 'Monto (con signo)')}
            {colSelect('debit', 'Cargos')}
            {colSelect('credit', 'Abonos')}
            {colSelect('balance', 'Saldo')}
          </div>
          <p className="text-[11px] text-gray-400">Usa "Monto" si la cartola trae una sola columna con signo, o "Cargos" y "Abonos" si vienen separadas.</p>
          {parsed && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 text-xs text-gray-600 flex gap-4">
                <span>{parsed.lines.length} línea(s) válidas</span>
                {parsed.skipped > 0 && <span>{parsed.skipped} fila(s) sin fecha o monto se omiten</span>}
                <span>Abonos {clp(parsed.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))}</span>
                <span>Cargos {clp(parsed.lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0))}</span>
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-100">
                  {parsed.lines.slice(0, 8).map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-gray-500">{l.date.split('-').reverse().join('-')}</td>
                      <td className="px-3 py-1.5 text-gray-800">{l.description}</td>
                      <td className={`px-3 py-1.5 text-right ${l.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{clp(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function ReconcileModal({ line, accounts, onClose, onDone }: { line: any; accounts: any[]; onClose: () => void; onDone: () => void }) {
  const amount = Number(line.amount);
  const type = amount >= 0 ? 'INCOME' : 'EXPENSE';
  const [cands, setCands] = useState<{ movements: any[]; transfers: any[] } | null>(null);
  const [create, setCreate] = useState({ accountId: '', withIva: type === 'EXPENSE', description: line.description });
  const [note, setNote] = useState(amount >= 0 ? IGNORE_NOTES[0] : IGNORE_NOTES[1]);

  useEffect(() => { api.finance.candidates(line.id, getToken()!).then(setCands).catch(() => setCands({ movements: [], transfers: [] })); }, [line.id]);

  const leafs = flattenTree<any>(accounts).filter((a) => !a.hasChildren && !a.archived && !a.systemKey && a.type === type);
  const act = async (data: any) => {
    try {
      await api.finance.reconcile(line.id, data, getToken()!);
      onDone();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo conciliar');
    }
  };
  const net = create.withIva ? Math.round(Math.abs(amount) / 1.19) : Math.abs(amount);

  return (
    <Modal title="Conciliar línea" onClose={onClose}>
      <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm flex justify-between gap-3">
        <span className="text-gray-700">{fmtDate(line.date)} · {line.description}</span>
        <b className={amount < 0 ? 'text-red-600' : 'text-emerald-700'}>{clp(amount)}</b>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-1">1. Coincide con un movimiento o traspaso ya registrado</p>
        {!cands ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div> : !cands.movements.length && !cands.transfers.length ? (
          <p className="text-xs text-gray-400">No hay movimientos del mismo monto en ±10 días.</p>
        ) : (
          <ul className="space-y-1">
            {cands.movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-xs border border-gray-100 rounded-lg px-2 py-1.5">
                <span>{fmtDate(m.date)} · {m.account.name}: {m.description} ({clp(Number(m.amount) + Number(m.tax))})</span>
                <button onClick={() => act({ action: 'match', movementId: m.id })} className="text-blue-600 font-semibold">Conciliar</button>
              </li>
            ))}
            {cands.transfers.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-xs border border-gray-100 rounded-lg px-2 py-1.5">
                <span>{fmtDate(t.date)} · Traspaso {t.fromAccount.name} → {t.toAccount.name} ({clp(Number(t.amount))})</span>
                <button onClick={() => act({ action: 'match', transferId: t.id })} className="text-blue-600 font-semibold">Conciliar</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700">2. Registrar como {TYPE_LABEL[type].toLowerCase().replace(/s$/, '')} nuevo</p>
        <select value={create.accountId} onChange={(e) => setCreate({ ...create, accountId: e.target.value })} className={inputCls}>
          <option value="">Elige la cuenta…</option>
          {leafs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input value={create.description} onChange={(e) => setCreate({ ...create, description: e.target.value })} className={inputCls} />
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={create.withIva} onChange={(e) => setCreate({ ...create, withIva: e.target.checked })} />
          Incluye IVA (con factura): neto {clp(net)} + IVA {clp(Math.abs(amount) - net)}
        </label>
        <button onClick={() => create.accountId ? act({ action: 'create', ...create }) : alertDialog('Elige la cuenta.')}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold">Registrar y conciliar</button>
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700">3. Ya está contabilizada (no registrar nada)</p>
        <select value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}>
          {IGNORE_NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={() => act({ action: 'ignore', note })} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700">Marcar como contabilizada</button>
      </div>
    </Modal>
  );
}
