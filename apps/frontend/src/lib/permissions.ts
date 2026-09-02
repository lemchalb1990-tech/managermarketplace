// Chequeo de permisos en el frontend. El catálogo de permisos (grupos + keys)
// vive solo en el backend y se consume vía GET /access-profiles/catalog en la
// página de Perfiles de acceso; acá solo necesitamos evaluar el permiso.

/**
 * ¿El usuario puede ver/usar `key`?
 * - SUPER_ADMIN siempre puede.
 * - Si el token trae `permissions` (sesión nueva), se usa esa lista.
 * - Si no (sesión antigua), se cae al gate por `roles` que provea el caller.
 */
export function can(user: any, key: string, fallbackRoles?: string[]): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (Array.isArray(user.permissions)) {
    return user.permissions.includes('*') || user.permissions.includes(key);
  }
  if (fallbackRoles) return fallbackRoles.includes(user.role);
  return false;
}
