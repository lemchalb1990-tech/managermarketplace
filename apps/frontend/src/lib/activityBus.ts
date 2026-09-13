'use client';

// Aviso liviano de "llegó actividad nueva" para que las vistas abiertas se refresquen
// solas en vez de quedar con datos viejos hasta que alguien recargue la página a mano.
// NotificationsProvider emite acá los tipos de evento que trajo cada poll (sale/question/
// claim); cada página que muestra ese tipo de dato se suscribe y vuelve a pedir su propia
// data — no hay estado compartido, cada vista sigue siendo dueña de su propio fetch.

export type ActivityType = 'sale' | 'question' | 'claim';

type Listener = (types: ActivityType[]) => void;

const listeners = new Set<Listener>();

export function emitActivity(types: ActivityType[]) {
  if (!types.length) return;
  listeners.forEach((l) => l(types));
}

export function onActivity(types: ActivityType[], callback: () => void): () => void {
  const listener: Listener = (incoming) => {
    if (incoming.some((t) => types.includes(t))) callback();
  };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
