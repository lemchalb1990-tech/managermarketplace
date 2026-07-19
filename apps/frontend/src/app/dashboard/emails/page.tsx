'use client';

import { useEffect, useState, useCallback } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const TYPE_LABELS: Record<string, { label: string; icon: string; trigger: string }> = {
  ORDER_CONFIRMED:        { label: 'Orden confirmada',       icon: '🎉', trigger: 'Al crear una orden' },
  ORDER_PREPARING:        { label: 'En preparación',         icon: '📦', trigger: 'Al cambiar estado → Preparando' },
  ORDER_READY_PICKUP:     { label: 'Lista para retiro',      icon: '🏪', trigger: 'Al cambiar estado → Listo (retiro)' },
  ORDER_OUT_FOR_DELIVERY: { label: 'En camino',              icon: '🚚', trigger: 'Al cambiar estado → En tránsito' },
  ORDER_DELIVERED:        { label: 'Entregado',              icon: '✅', trigger: 'Al cambiar estado → Entregado' },
  SALE_RECEIPT:           { label: 'Recibo de venta (POS)',  icon: '🧾', trigger: 'Al registrar venta con email del cliente' },
};

const VARS = [
  { key: '{{customerName}}',  desc: 'Nombre del cliente' },
  { key: '{{orderId}}',       desc: 'ID de la orden (últimos 8 caracteres)' },
  { key: '{{companyName}}',   desc: 'Nombre de la empresa' },
  { key: '{{total}}',         desc: 'Total formateado ($)' },
  { key: '{{address}}',       desc: 'Dirección de entrega' },
  { key: '{{date}}',          desc: 'Fecha actual' },
  { key: '{{itemsTable}}',    desc: 'Tabla HTML de productos' },
  { key: '{{deliveryBlock}}', desc: 'Bloque de tipo de entrega' },
];

export default function EmailsPage() {
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<'templates' | 'smtp'>('templates');

  // Templates state
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [resetting, setResetting] = useState(false);

  // SMTP state
  const [smtpForm, setSmtpForm] = useState({ host: '', port: 587, secure: false, user: '', pass: '', fromName: '', fromEmail: '', active: true });
  const [loadingSmtp, setLoadingSmtp] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState('');
  const [testTo, setTestTo] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  const companyId = user?.role === 'SUPER_ADMIN' ? undefined : undefined; // for now SUPER_ADMIN uses global

  const loadTemplates = useCallback(async (t: string) => {
    setLoadingTemplates(true);
    try {
      const res = await api.email.getTemplates(t);
      setTemplates(res);
    } catch { setTemplates([]); }
    finally { setLoadingTemplates(false); }
  }, []);

  const loadSmtp = useCallback(async (t: string) => {
    setLoadingSmtp(true);
    try {
      const cfg = await api.email.getConfig(t);
      if (cfg) {
        setSmtpForm(f => ({
          ...f,
          host: cfg.host ?? '',
          port: cfg.port ?? 587,
          secure: cfg.secure ?? false,
          user: cfg.user ?? '',
          fromName: cfg.fromName ?? '',
          fromEmail: cfg.fromEmail ?? '',
          active: cfg.active ?? true,
        }));
      }
    } catch { /* no config yet */ }
    finally { setLoadingSmtp(false); }
  }, []);

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (t && u) { setToken(t); setUser(u); setTestTo(u.email ?? ''); loadTemplates(t); loadSmtp(t); }
  }, [loadTemplates, loadSmtp]);

  function selectTemplate(type: string) {
    const tpl = templates.find(t => t.type === type);
    if (!tpl) return;
    setSelectedType(type);
    setEditSubject(tpl.subject);
    setEditBody(tpl.bodyHtml);
    setEditActive(tpl.active);
    setSaveMsg('');
    setShowPreview(false);
  }

  async function handleSaveTemplate() {
    if (!selectedType) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await api.email.saveTemplate(selectedType, { subject: editSubject, bodyHtml: editBody, active: editActive }, token);
      await loadTemplates(token);
      setSaveMsg('✓ Guardado');
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally { setSaving(false); }
  }

  async function handleReset() {
    if (!selectedType || !confirm('¿Restaurar la plantilla al diseño predeterminado?')) return;
    setResetting(true);
    try {
      await api.email.resetTemplate(selectedType, token);
      await loadTemplates(token);
      const fresh = templates.find(t => t.type === selectedType);
      if (fresh) selectTemplate(selectedType);
      setSaveMsg('✓ Plantilla restaurada');
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally { setResetting(false); }
  }

  async function handleSaveSmtp(e: React.FormEvent) {
    e.preventDefault();
    setSavingSmtp(true);
    setSmtpMsg('');
    try {
      await api.email.saveConfig(smtpForm, token);
      setSmtpMsg('✓ Configuración guardada');
    } catch (err: any) {
      setSmtpMsg(`Error: ${err.message}`);
    } finally { setSavingSmtp(false); }
  }

  async function handleTestEmail() {
    if (!testTo) return;
    setSendingTest(true);
    setTestMsg('');
    try {
      await api.email.testEmail(testTo, token);
      setTestMsg('✓ Correo de prueba enviado correctamente');
    } catch (err: any) {
      setTestMsg(`Error: ${err.message}`);
    } finally { setSendingTest(false); }
  }

  const selectedTpl = templates.find(t => t.type === selectedType);

  const previewHtml = showPreview ? editBody
    .replace('{{customerName}}', 'María González')
    .replace('{{orderId}}', 'AB123456')
    .replace('{{companyName}}', user?.company?.name ?? 'Mi Empresa')
    .replace('{{total}}', '$29.990')
    .replace('{{address}}', 'Av. Providencia 1234, Providencia, Santiago')
    .replace('{{date}}', new Date().toLocaleDateString('es-CL'))
    .replace('{{itemsTable}}', `<table width="100%" style="margin-bottom:8px;"><thead><tr style="background:#f9fafb;"><th style="padding:8px 0;text-align:left;font-size:12px;color:#9ca3af;">Producto</th><th style="padding:8px;text-align:center;font-size:12px;color:#9ca3af;">Cant.</th><th style="padding:8px 0;text-align:right;font-size:12px;color:#9ca3af;">Subtotal</th></tr></thead><tbody><tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;">Zapato deportivo talla 42</td><td style="padding:8px;text-align:center;font-size:14px;color:#6b7280;">2</td><td style="padding:8px 0;text-align:right;font-size:14px;">$19.980</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;">Calcetines deporte x3</td><td style="padding:8px;text-align:center;font-size:14px;color:#6b7280;">1</td><td style="padding:8px 0;text-align:right;font-size:14px;">$4.990</td></tr></tbody></table>`)
    .replace('{{deliveryBlock}}', `<div style="margin:16px 0;padding:14px 16px;background:#f9fafb;border-radius:8px;font-size:14px;color:#374151;"><strong>🏠 Dirección de entrega</strong><br><span style="color:#6b7280;">Av. Providencia 1234, Providencia</span></div>`)
    : '';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Correos y Plantillas</h1>
        <p className="text-sm text-gray-400 mt-0.5">Personaliza los correos automáticos que reciben tus clientes</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['templates', 'smtp'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'templates' ? 'Plantillas de correo' : 'Configuración SMTP'}
          </button>
        ))}
      </div>

      {/* ── TEMPLATES TAB ── */}
      {tab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: template list */}
          <div className="space-y-2">
            {loadingTemplates ? (
              <p className="text-gray-400 text-sm text-center py-8">Cargando...</p>
            ) : templates.map(tpl => {
              const cfg = TYPE_LABELS[tpl.type];
              const isSelected = selectedType === tpl.type;
              return (
                <button key={tpl.type} onClick={() => selectTemplate(tpl.type)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-gray-50'
                  }`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0">{cfg?.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>{cfg?.label}</p>
                        {!tpl.active && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full shrink-0">Inactivo</span>
                        )}
                        {tpl.isCustomized && (
                          <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full shrink-0">Personalizado</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{cfg?.trigger}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: editor */}
          <div className="lg:col-span-2">
            {!selectedType ? (
              <div className="bg-white border border-gray-200 rounded-2xl flex items-center justify-center" style={{ minHeight: '420px' }}>
                <div className="text-center px-6">
                  <p className="text-4xl mb-3">✉️</p>
                  <p className="text-gray-500 font-medium">Selecciona una plantilla para editarla</p>
                  <p className="text-gray-400 text-sm mt-1">Personaliza asunto y cuerpo del correo</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {/* Editor header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TYPE_LABELS[selectedType]?.icon}</span>
                    <span className="font-semibold text-gray-800">{TYPE_LABELS[selectedType]?.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                      <div
                        onClick={() => setEditActive(a => !a)}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${editActive ? 'bg-blue-500' : 'bg-gray-300'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${editActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      {editActive ? 'Activo' : 'Inactivo'}
                    </label>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Asunto del correo</label>
                    <input
                      value={editSubject}
                      onChange={e => setEditSubject(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Variable reference */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <p className="text-xs font-semibold text-blue-700 mb-2">Variables disponibles</p>
                    <div className="flex flex-wrap gap-1.5">
                      {VARS.map(v => (
                        <button key={v.key} title={v.desc}
                          onClick={() => setEditBody(b => b + v.key)}
                          className="text-xs font-mono bg-white border border-blue-200 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-100 transition">
                          {v.key}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Body editor / preview tabs */}
                  <div>
                    <div className="flex gap-1 mb-2">
                      <button onClick={() => setShowPreview(false)}
                        className={`text-xs px-3 py-1 rounded-lg font-medium transition ${!showPreview ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                        HTML
                      </button>
                      <button onClick={() => setShowPreview(true)}
                        className={`text-xs px-3 py-1 rounded-lg font-medium transition ${showPreview ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                        Vista previa
                      </button>
                    </div>

                    {!showPreview ? (
                      <textarea
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        rows={16}
                        spellCheck={false}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                      />
                    ) : (
                      <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50" style={{ height: '380px' }}>
                        <iframe
                          srcDoc={previewHtml}
                          title="Vista previa del correo"
                          className="w-full h-full border-0"
                          sandbox="allow-same-origin"
                        />
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-1">
                    <button onClick={handleSaveTemplate} disabled={saving}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition">
                      {saving ? 'Guardando...' : 'Guardar plantilla'}
                    </button>
                    {selectedTpl?.isCustomized && (
                      <button onClick={handleReset} disabled={resetting}
                        className="text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-50">
                        {resetting ? 'Restaurando...' : 'Restaurar predeterminada'}
                      </button>
                    )}
                    {saveMsg && (
                      <span className={`text-sm ${saveMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                        {saveMsg}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SMTP TAB ── */}
      {tab === 'smtp' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-gray-800 mb-1">Servidor de correo saliente</h2>
            <p className="text-sm text-gray-400 mb-5">Configura el servidor SMTP para enviar correos automáticos a tus clientes.</p>

            {loadingSmtp ? (
              <p className="text-gray-400 text-sm">Cargando configuración...</p>
            ) : (
              <form onSubmit={handleSaveSmtp} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Host SMTP *</label>
                    <input required value={smtpForm.host} onChange={e => setSmtpForm(f => ({ ...f, host: e.target.value }))}
                      placeholder="smtp.gmail.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Puerto *</label>
                    <input required type="number" value={smtpForm.port} onChange={e => setSmtpForm(f => ({ ...f, port: Number(e.target.value) }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Usuario / Email SMTP *</label>
                  <input required value={smtpForm.user} onChange={e => setSmtpForm(f => ({ ...f, user: e.target.value }))}
                    placeholder="correos@miempresa.cl"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña SMTP</label>
                  <input type="password" value={smtpForm.pass} onChange={e => setSmtpForm(f => ({ ...f, pass: e.target.value }))}
                    placeholder="Dejar en blanco para no cambiar"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nombre remitente *</label>
                    <input required value={smtpForm.fromName} onChange={e => setSmtpForm(f => ({ ...f, fromName: e.target.value }))}
                      placeholder="Mi Tienda"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email remitente *</label>
                    <input required type="email" value={smtpForm.fromEmail} onChange={e => setSmtpForm(f => ({ ...f, fromEmail: e.target.value }))}
                      placeholder="no-reply@miempresa.cl"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <div onClick={() => setSmtpForm(f => ({ ...f, secure: !f.secure }))}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${smtpForm.secure ? 'bg-blue-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${smtpForm.secure ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    SSL/TLS (puerto 465)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer ml-4">
                    <div onClick={() => setSmtpForm(f => ({ ...f, active: !f.active }))}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${smtpForm.active ? 'bg-blue-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${smtpForm.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    Envíos activos
                  </label>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button type="submit" disabled={savingSmtp}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition">
                    {savingSmtp ? 'Guardando...' : 'Guardar configuración'}
                  </button>
                  {smtpMsg && (
                    <span className={`text-sm ${smtpMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{smtpMsg}</span>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* Right: test + info */}
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <h3 className="font-semibold text-gray-800 mb-1">Probar configuración</h3>
              <p className="text-sm text-gray-400 mb-4">Envía un correo de prueba para verificar que el servidor SMTP funciona correctamente.</p>
              <div className="flex gap-2">
                <input
                  type="email" value={testTo} onChange={e => setTestTo(e.target.value)}
                  placeholder="Correo de destino"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={handleTestEmail} disabled={sendingTest || !testTo}
                  className="bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition">
                  {sendingTest ? '...' : 'Enviar prueba'}
                </button>
              </div>
              {testMsg && (
                <p className={`text-sm mt-3 ${testMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{testMsg}</p>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3 text-sm text-amber-800">
              <p className="font-semibold">Guía rápida de configuración</p>
              <div className="space-y-2 text-amber-700">
                <p><strong>Gmail:</strong> host smtp.gmail.com · puerto 587 · TLS desactivado · usa "Contraseña de aplicación"</p>
                <p><strong>Outlook:</strong> host smtp.office365.com · puerto 587 · TLS desactivado</p>
                <p><strong>Otro:</strong> Consulta la documentación de tu proveedor de correo</p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <p className="font-semibold text-gray-800 mb-3">¿Cuándo se envían los correos?</p>
              <div className="space-y-2">
                {Object.entries(TYPE_LABELS).map(([type, cfg]) => (
                  <div key={type} className="flex items-start gap-2">
                    <span className="text-base shrink-0">{cfg.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-700">{cfg.label}</p>
                      <p className="text-xs text-gray-400">{cfg.trigger}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
