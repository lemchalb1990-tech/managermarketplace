/**
 * FRONTEND_URL puede contener varias URLs separadas por coma (p. ej. el dominio
 * nuevo y el antiguo mientras se migra). Devuelve la lista completa y la primera
 * como URL "canónica" para redirecciones.
 */
export function frontendUrls(): string[] {
  return (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

export function primaryFrontendUrl(): string {
  return frontendUrls()[0] || 'http://localhost:3000';
}
