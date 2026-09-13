'use client';

import { useEffect, useState } from 'react';
import { api, imgUrl } from './api';

export type NotificationSoundMap = { sale: string | null; question: string | null; claim: string | null };

const EMPTY: NotificationSoundMap = { sale: null, question: null, claim: null };

// Caché a nivel de módulo: qué sonido eligió Super Admin para cada tipo de evento es
// global y no cambia entre páginas de una misma sesión.
let cache: NotificationSoundMap | null = null;
let inflight: Promise<NotificationSoundMap> | null = null;

function fetchMap(): Promise<NotificationSoundMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.public.notificationSounds()
    .then((r) => {
      cache = {
        sale: r.sale ? imgUrl(r.sale) : null,
        question: r.question ? imgUrl(r.question) : null,
        claim: r.claim ? imgUrl(r.claim) : null,
      };
      return cache;
    })
    .catch(() => EMPTY)
    .finally(() => { inflight = null; });
  return inflight;
}

// Se llama tras guardar una elección de sonido nueva en Configuración, para que la
// campanita ya montada deje de usar el mapa viejo en caché.
export function invalidateNotificationSoundsCache() {
  cache = null;
}

export function useNotificationSoundMap(): NotificationSoundMap {
  const [map, setMap] = useState<NotificationSoundMap>(cache || EMPTY);
  useEffect(() => {
    let mounted = true;
    fetchMap().then((m) => { if (mounted) setMap(m); });
    return () => { mounted = false; };
  }, []);
  return map;
}

// Para el polling de notificaciones (fuera de un componente React): pide el mapa una
// vez y lo cachea igual que el hook, sin necesitar estar dentro de un render.
export function getNotificationSoundMap(): Promise<NotificationSoundMap> {
  return fetchMap();
}
