'use client';

import Link from 'next/link';

const COURIERS = [
  { name: 'Starken', color: 'bg-red-500' },
  { name: 'Chilexpress', color: 'bg-yellow-500' },
  { name: 'Blue Express', color: 'bg-blue-500' },
];

export default function EncomiendasPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/mis-conexiones" className="text-sm text-gray-400 hover:text-gray-600">Mis conexiones</Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Encomiendas</span>
      </div>

      <div>
        <h1 className="text-[1.375rem] font-bold text-gray-900">Encomiendas</h1>
        <p className="text-xs text-gray-500 mt-1">Conecta un courier para generar etiquetas y seguimiento de despachos.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm font-medium text-gray-700 mb-1">Próximamente</p>
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          Estamos preparando la integración con couriers de encomiendas. Vas a poder conectar tu cuenta y generar etiquetas directamente desde acá.
        </p>
        <div className="flex items-center justify-center gap-3 mt-6">
          {COURIERS.map((c) => (
            <div key={c.name} className="flex flex-col items-center gap-2 opacity-50">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold ${c.color}`}>
                {c.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-[11px] text-gray-500">{c.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
