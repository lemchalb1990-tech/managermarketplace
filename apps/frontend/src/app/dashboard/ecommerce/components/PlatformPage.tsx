'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

export interface PlatformField {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface PlatformConfig {
  marketplace: string;
  name: string;
  description: string;
  moduleKey: string;
  color: string;
  logo?: React.ReactNode;
  logoText?: string;
  logoBg?: string;
  logoTextColor?: string;
  fields: PlatformField[];
  supportsPublish?: boolean;
  helpText?: string;
}

interface Props {
  config: PlatformConfig;
}

export default function PlatformPage({ config }: Props) {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [connections, setConnections] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const activeCompanyId = isSuperAdmin ? selectedCompanyId : currentUser?.companyId;

  async function loadConnections(companyId?: string) {
    const token = getToken()!;
    const data = await api.connections.list(token, {
      marketplace: config.marketplace,
      companyId: companyId || undefined,
    }).catch(() => []);
    setConnections(data);
  }

  async function init() {
    const token = getToken();
    if (!token) return;
    const me = await api.me(token);
    setCurrentUser(me);
    if (me.role === 'SUPER_ADMIN') {
      const comps = await api.companies.list(token);
      setCompanies(comps);
    } else {
      await loadConnections();
    }
  }

  useEffect(() => { init(); }, [searchParams]);

  useEffect(() => {
    if (isSuperAdmin && selectedCompanyId) {
      loadConnections(selectedCompanyId);
      setShowForm(false);
      setError('');
    }
  }, [selectedCompanyId, isSuperAdmin]);

  function resetForm() {
    setShowForm(false);
    setFormName('');
    setFormFields({});
    setError('');
  }

  async function handleConnect() {
    const missing = config.fields.filter(f => f.required !== false && !formFields[f.key]?.trim());
    if (!formName.trim() || missing.length > 0) {
      setError('Completa todos los campos requeridos');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      await api.connections.create({
        marketplace: config.marketplace,
        name: formName.trim(),
        credentials: formFields,
        ...(isSuperAdmin && activeCompanyId ? { companyId: activeCompanyId } : {}),
      }, token);
      resetForm();
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Desconectar "${name}"?`)) return;
    const token = getToken()!;
    await api.connections.remove(id, token);
    await loadConnections(activeCompanyId || undefined);
  }

  async function handleTest(id: string) {
    const token = getToken()!;
    const result = await api.connections.test(id, token).catch((e) => ({ success: false, message: e.message }));
    alert(result.success ? `✓ ${result.message || 'Conexión exitosa'}` : `✗ ${result.message || 'Error de conexión'}`);
  }

  const showContent = !isSuperAdmin || selectedCompanyId;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <a href="/dashboard/ecommerce" className="text-sm text-gray-400 hover:text-gray-600">E-commerce</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">{config.name}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-14 h-9 rounded-xl overflow-hidden shrink-0">
          {config.logo ?? (
            <div className="w-full h-full rounded-xl flex items-center justify-center text-xs font-bold"
              style={{ background: config.logoBg, color: config.logoTextColor }}>
              {config.logoText}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{config.name}</h1>
          <p className="text-sm text-gray-500">{config.description}</p>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-blue-700 mb-1">Empresa a gestionar</label>
          <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white">
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">Selecciona una empresa para gestionar sus conexiones de {config.name}.</p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Conexiones activas</h2>
            <button onClick={() => { setShowForm(!showForm); setError(''); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: config.color }}>
              + Conectar tienda
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {showForm && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
              <h3 className="font-semibold text-gray-800 mb-1">Conectar tienda de {config.name}</h3>
              {config.helpText && <p className="text-xs text-gray-500 mb-4">{config.helpText}</p>}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la conexión *</label>
                  <input value={formName} onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ej: Tienda principal"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                {config.fields.map((field) => (
                  <div key={field.key} className={config.fields.length === 1 ? 'col-span-2' : ''}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {field.label} {field.required !== false ? '*' : ''}
                    </label>
                    <input
                      type={field.type || 'text'}
                      value={formFields[field.key] || ''}
                      onChange={(e) => setFormFields(f => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    {field.hint && <p className="text-xs text-gray-400 mt-0.5">{field.hint}</p>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleConnect} disabled={loading}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: config.color }}>
                  {loading ? 'Conectando...' : 'Guardar y conectar'}
                </button>
                <button onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Nombre</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Plataforma</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Conectada</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {connections.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{c.marketplace}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(c.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right flex gap-3 justify-end">
                      <button onClick={() => handleTest(c.id)}
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                        Probar
                      </button>
                      <button onClick={() => handleDelete(c.id, c.name)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium">
                        Desconectar
                      </button>
                    </td>
                  </tr>
                ))}
                {connections.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                      <p className="text-sm mb-1">Sin conexiones</p>
                      <p className="text-xs">Haz clic en "+ Conectar tienda" para vincular tu cuenta de {config.name}.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {config.supportsPublish === false && (
            <div className="mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <strong>Nota:</strong> La sincronización automática de stock y precios con {config.name} estará disponible próximamente.
              Por ahora, puedes registrar las credenciales y el sistema actualizará cuando se active la integración.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
