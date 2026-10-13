'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api, type UserDeletePreview } from '@/lib/api';

// Eliminar usuario (solo Super Admin): muestra qué registros tiene y a qué administrador pasan.
export function DeleteUserModal({ user, onClose, onDeleted }: {
  user: { id: string; name: string; email: string };
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [preview, setPreview] = useState<UserDeletePreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [targetId, setTargetId] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.users.deletePreview(user.id, getToken()!)
      .then((p) => { setPreview(p); setTargetId(p.admins[0]?.id || ''); })
      .catch((e) => setLoadError(e.message));
  }, [user.id]);

  const matches = confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.users.remove(user.id, { targetUserId: targetId, confirmEmail: confirmEmail.trim() }, getToken()!);
      onDeleted(`Usuario eliminado. ${r.moved} registro(s) pasaron a ${r.target.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="ui-section-title">Eliminar usuario</h2>
          <p className="text-xs text-gray-400 mt-0.5">{user.name} — {user.email}</p>
        </div>

        {loadError ? (
          <div className="px-6 py-5 flex flex-col gap-4">
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{loadError}</p>
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
              Cerrar
            </button>
          </div>
        ) : !preview ? (
          <p className="px-6 py-6 text-sm text-gray-400">Revisando los registros del usuario…</p>
        ) : (
          <form onSubmit={submit} className="px-6 py-4 flex flex-col gap-4">
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              El usuario se borra y no se puede deshacer. Sus registros no se pierden: pasan al administrador que elijas.
            </p>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">
                Registros a traspasar {preview.total > 0 && <span className="text-gray-400">({preview.total})</span>}
              </p>
              {preview.records.length ? (
                <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                  {preview.records.map((r) => (
                    <li key={r.table} className="flex justify-between px-3 py-1.5">
                      <span className="text-gray-700">{r.label}</span>
                      <span className="text-gray-500 tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No tiene registros: solo se borra la cuenta.</p>
              )}
              <p className="text-[11px] text-gray-400 mt-1">El registro de actividad conserva su nombre como historial.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Pasan a *</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {preview.admins.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.email}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-0.5">Administradores activos de {preview.user.company || 'la empresa'}.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Escribe <span className="font-mono text-gray-800">{user.email}</span> para confirmar
              </label>
              <input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={!matches || busy}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {busy ? 'Eliminando…' : 'Eliminar y traspasar'}
              </button>
              <button type="button" onClick={onClose} disabled={busy}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
