'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, type EmailBrandSettings, type EmailBlock } from '@/lib/api';
import { btnPrimary, inputCls } from '@/components/ui/Modal';
import { EmailPreview } from '../correos-plataforma/EmailPreview';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SWATCHES = ['#1d4ed8', '#0f766e', '#15803d', '#b91c1c', '#c2410c', '#7c3aed', '#be185d', '#111827'];

// Correo de muestra para ver la identidad aplicada.
const SAMPLE: { subject: string; blocks: EmailBlock[] } = {
  subject: 'Confirmación de pedido #{{orderId}}',
  blocks: [
    { type: 'title', text: '¡Gracias por tu compra!' },
    { type: 'text', text: 'Hola **{{customerName}}**, hemos recibido tu pedido correctamente.' },
    { type: 'items' }, { type: 'total' },
    { type: 'button', label: 'Visitar la tienda', url: 'https://example.com' },
  ],
};

// Identidad de la empresa en todos sus correos: color, logo y pie.
export default function BrandTab({ token }: { token: string }) {
  const [saved, setSaved] = useState<EmailBrandSettings | null>(null);
  const [form, setForm] = useState({ color: '#1d4ed8', showLogo: true, footerText: '', contact: '' });
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.email.getBrand(token).then((b) => {
      setSaved(b);
      setForm({ color: b.color, showLogo: b.showLogo, footerText: b.footerText ?? '', contact: b.contact ?? '' });
    }).catch((e) => setNotice({ ok: false, text: msg(e) }));
  }, [token]);

  const brand = useMemo(() => ({ ...form, footerText: form.footerText || null, contact: form.contact || null }), [form]);
  const validColor = /^#[0-9a-f]{6}$/i.test(form.color);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => {
      api.email.previewTemplate({ ...SAMPLE, brand }, token).then((p) => setHtml(p.html)).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [brand, saved, token]);

  async function save() {
    setBusy(true); setNotice(null);
    try {
      const b = await api.email.saveBrand(brand, token);
      setSaved(b);
      setNotice({ ok: true, text: 'Identidad guardada: se aplica a todos tus correos' });
    } catch (e) { setNotice({ ok: false, text: msg(e) }); }
    finally { setBusy(false); }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="ui-section-title mb-1">Identidad de tus correos</h2>
          <p className="text-sm text-gray-400">Se aplica a todos los correos que reciben tus clientes.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Color principal</label>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => set('color', c)} title={c} aria-label={`Color ${c}`}
                className={`w-7 h-7 rounded-full border-2 ${form.color.toLowerCase() === c ? 'border-gray-900' : 'border-white shadow'}`}
                style={{ background: c }} />
            ))}
            <input type="color" value={validColor ? form.color : '#1d4ed8'} onChange={(e) => set('color', e.target.value)}
              className="w-9 h-8 rounded border border-gray-300 bg-white" aria-label="Elegir otro color" />
            <input value={form.color} onChange={(e) => set('color', e.target.value)} maxLength={7}
              className={`${inputCls} !w-28 font-mono`} />
          </div>
          {!validColor && <p className="text-xs text-red-600 mt-1">Usa un color con formato #RRGGBB.</p>}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.showLogo} disabled={!saved?.hasLogo}
              onChange={(e) => set('showLogo', e.target.checked)} className="w-4 h-4" />
            Mostrar el logo de la empresa en el encabezado
          </label>
          <p className="text-xs text-gray-400 mt-1 ml-6">
            {saved?.hasLogo
              ? 'Es el mismo logo de tus tickets y comprobantes.'
              : <>Aún no tienes logo. Súbelo en <Link href="/dashboard/settings" className="text-blue-600 hover:underline">Ajustes → Datos de la empresa</Link>; mientras tanto se muestra el nombre de la tienda.</>}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datos de contacto (pie del correo)</label>
          <input value={form.contact} onChange={(e) => set('contact', e.target.value)} maxLength={300}
            placeholder="+56 9 1234 5678 · contacto@mitienda.cl · mitienda.cl" className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mensaje del pie (opcional)</label>
          <textarea value={form.footerText} onChange={(e) => set('footerText', e.target.value)} rows={3} maxLength={500}
            placeholder="Horario de atención: lunes a viernes de 9:00 a 18:00" className={inputCls} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !validColor || !saved} className={btnPrimary}>
            {busy ? 'Guardando…' : 'Guardar identidad'}
          </button>
          {notice && <span className={`text-sm ${notice.ok ? 'text-green-600' : 'text-red-600'}`}>{notice.text}</span>}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-2">
        <p className="text-xs font-medium text-gray-600">Así se verán tus correos</p>
        {html ? <EmailPreview html={html} height={560} /> : <div className="h-[560px] rounded-lg bg-gray-100 animate-pulse" />}
      </div>
    </div>
  );
}
