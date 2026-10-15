'use client';

import { TOKEN_KEY, USER_KEY, saveSession } from './auth';

// «Ver como» del Super Admin: mientras dura, la sesión guardada es la simulada y la del Super
// Admin queda aparte para volver a ella al salir.
const ORIGIN_TOKEN_KEY = 'mp_sim_origin_token';
const ORIGIN_USER_KEY = 'mp_sim_origin_user';

export function startSimulation(token: string, user: any) {
  const originToken = localStorage.getItem(TOKEN_KEY);
  const originUser = localStorage.getItem(USER_KEY);
  // Si ya había una simulación abierta se conserva el Super Admin original.
  if (originToken && originUser && !localStorage.getItem(ORIGIN_TOKEN_KEY)) {
    localStorage.setItem(ORIGIN_TOKEN_KEY, originToken);
    localStorage.setItem(ORIGIN_USER_KEY, originUser);
  }
  saveSession(token, user);
}

// Vuelve a la sesión del Super Admin. false = no había sesión original guardada.
export function restoreOriginSession(): boolean {
  const token = localStorage.getItem(ORIGIN_TOKEN_KEY);
  const user = localStorage.getItem(ORIGIN_USER_KEY);
  clearOriginSession();
  if (!token || !user) return false;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, user);
  return true;
}

export function clearOriginSession() {
  localStorage.removeItem(ORIGIN_TOKEN_KEY);
  localStorage.removeItem(ORIGIN_USER_KEY);
}
