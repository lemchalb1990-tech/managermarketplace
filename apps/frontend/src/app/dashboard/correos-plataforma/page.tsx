'use client';

import { useState } from 'react';
import { SentTab } from './SentTab';
import { TemplatesTab } from './TemplatesTab';
import { DesignTab } from './DesignTab';

type Tab = 'sent' | 'templates' | 'design';
const TABS: [Tab, string][] = [['sent', 'Enviados'], ['templates', 'Plantillas'], ['design', 'Diseño']];

// Super Admin: registro de todos los correos que salen (plataforma y empresas) y edición de
// los textos y el diseño de los correos de la plataforma.
export default function PlatformEmailsPage() {
  const [tab, setTab] = useState<Tab>('sent');

  return (
    <div>
      <div className="mb-3">
        <h1 className="ui-page-title">Correos de la plataforma</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Todos los correos enviados (de la plataforma y del SMTP de cada empresa) y los textos de los correos de la plataforma.
        </p>
      </div>

      <div className="mb-4 flex overflow-x-auto border-b border-gray-200">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-[var(--brand)] text-[var(--brand-ink)]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sent' && <SentTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'design' && <DesignTab />}
    </div>
  );
}
