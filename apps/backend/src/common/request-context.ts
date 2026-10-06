import { AsyncLocalStorage } from 'async_hooks';

// Contexto de la petición HTTP en curso, disponible en cualquier servicio (también en el trabajo
// que una petición deja corriendo en segundo plano). Sirve para saber qué usuario inició una
// acción larga, como una importación. Fuera de una petición (crons, webhooks) no hay contexto.
const storage = new AsyncLocalStorage<{ req: any }>();

export function runWithRequest(req: any, next: () => void) {
  storage.run({ req }, next);
}

// Usuario autenticado de la petición en curso, o null.
export function currentRequestUser(): any | null {
  return storage.getStore()?.req?.user ?? null;
}
