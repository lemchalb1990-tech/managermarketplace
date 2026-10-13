'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type PlatformEmailDesign } from '@/lib/api';
import { btnPrimary, btnSecondary } from '@/components/ui/Modal';
import { EmailPreview } from './EmailPreview';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const HEX = /^#[0-9a-f]{6}$/i;

// Diseño común de todos los correos de la plataforma: logo (o nombre), color y pie.
export function DesignTab() {
  const [saved, setSaved] = useState<PlatformEmailDesign | null>(null);
  const [d, setD] = useState<PlatformEmailDesign | null>(null);
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.platformMail.design(getToken()!)
      .then((x) => { setSaved(x); setD(x); })
      .catch((e) => setNotice({ ok: false, text: msg(e) }));
  }, []);

  // Vista previa del correo de bienvenida con el diseño en edición.
  useEffect(() => {
    if (!d) return;
    const id = setTimeout(() => {
      api.platformMail.preview('WELCOME', { design: d }, getToken()!).then((p) => setHtml(p.html)).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [d]);

  const dirty = !!(d && saved && JSON.stringify(d) !== JSON.stringify(saved));

  async function upload(file: File) {
    setBusy(true);
    setNotice(null);
    try {
      const { url } = await api.platformMail.uploadLogo(file, getToken()!);
      setD((x) => (x ? { ...x, logoUrl: url } : x));
    } catch (e) {
      setNotice({ ok: false, text: msg(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    if (!d) return;
    setBusy(true);
    try {
      const x = await api.platformMail.saveDesign(d, getToken()!);
      setSaved(x);
      setD(x);
      setNotice({ ok: true, text: 'Diseño guardado. Se aplica a todos los correos de la plataforma.' });
    } catch (e) {
      setNotice({ ok: false, text: msg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!d) return notice ? <p className="text-sm text-red-600">{notice.text}</p> : <p className="text-sm text-gray-400">Cargando diseño…</p>;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="ui-section-title">Diseño de los correos</h2>
        <p className="mb-4 mt-0.5 text-xs text-gray-500">Se aplica a todos los correos de la plataforma. Los correos de cada empresa usan su propio diseño.</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Logo</label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-14 min-w-[120px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {d.logoUrl ? <img src={d.logoUrl} alt="Logo" className="max-h-11 max-w-[200px]" /> : <span className="text-xs text-gray-400">Sin logo</span>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={btnSecondary}>Subir logo</button>
              {d.logoUrl && <button type="button" onClick={() => setD({ ...d, logoUrl: '' })} disabled={busy} className="text-xs font-medium text-red-600 hover:text-red-800">Quitar</button>}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">PNG o JPG de hasta 2 MB, idealmente horizontal y con fondo transparente o blanco. Sin logo se muestra el nombre.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nombre *</label>
            <input value={d.brand} onChange={(e) => setD({ ...d, brand: e.target.value })} maxLength={60} className={inputCls} />
            <p className="mt-1 text-[11px] text-gray-400">Va en la cabecera si no hay logo, en el pie y en la variable {'{{marca}}'} de los textos.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Color principal</label>
            <div className="flex items-center gap-2">
              <input type="color" value={HEX.test(d.color) ? d.color : '#0075de'} onChange={(e) => setD({ ...d, color: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border border-gray-300" />
              <input value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} maxLength={7} className={`${inputCls} max-w-[120px] font-mono`} />
            </div>
            <p className="mt-1 text-[11px] text-gray-400">Botón y línea superior del correo.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Pie</label>
            <input value={d.footer} onChange={(e) => setD({ ...d, footer: e.target.value })} maxLength={200}
              placeholder={`© {{anio}} ${d.brand || 'AdminMarket'} de OnDataSolution`} className={inputCls} />
            <p className="mt-1 text-[11px] text-gray-400">{'{{anio}}'} = año actual. Vacío = el pie por defecto.</p>
          </div>

          {notice && <p className={`text-sm ${notice.ok ? 'text-green-700' : 'text-red-600'}`}>{notice.text}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy || !dirty || !HEX.test(d.color) || !d.brand.trim()} className={btnPrimary}>
              {busy ? 'Guardando…' : 'Guardar diseño'}
            </button>
            {dirty && <button type="button" onClick={() => setD(saved)} disabled={busy} className={btnSecondary}>Descartar cambios</button>}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        {html && <EmailPreview html={html} />}
        <p className="mt-1 text-[11px] text-gray-400">Vista previa con el correo de bienvenida y datos de ejemplo.</p>
      </div>
    </div>
  );
}
