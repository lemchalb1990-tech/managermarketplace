'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

// Lo que el cliente debe configurar en SU aplicación de Mercado Libre
// (developers.mercadolibre.cl → Mis aplicaciones → editar), con botones para copiar.
export default function MlAppSetupBox() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.marketplace.appSetup>> | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api.marketplace.appSetup(getToken()!).then(setData).catch(() => {});
  }, []);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* el navegador no permitió copiar: el texto queda visible para copiarlo a mano */ }
  }

  if (!data) return null;
  const row = (key: string, label: string, value: string | null) => (
    <div>
      <p className="text-xs font-medium text-gray-600 mb-1">{label}</p>
      {value ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 break-all text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1.5">{value}</code>
          <button type="button" onClick={() => copy(key, value)}
            className="shrink-0 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
            {copied === key ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-red-600">Falta configurar la URL del backend (APP_URL) en Configuración.</p>
      )}
    </div>
  );

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3 mb-4">
      <div>
        <p className="text-sm font-semibold text-blue-900">Configura tu aplicación de Mercado Libre</p>
        <p className="text-xs text-blue-800 mt-0.5">
          En developers.mercadolibre.cl → Mis aplicaciones → tu aplicación → Editar, pega estos datos y guarda.
          De ahí también sacas el Client ID y el Client Secret.
        </p>
      </div>
      {row('redirect', 'URI de redirect', data.redirectUri)}
      {row('notifications', 'URL de retornos de llamada de notificación', data.notificationsUrl)}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Tópicos a marcar</p>
        <div className="flex flex-wrap gap-1.5">
          {data.topics.map((t) => (
            <span key={t.id} className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-700">{t.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
