import { Role } from '@prisma/client';
import { DEFAULT_PROFILES, ROLE_DEFAULT_PERMISSIONS, roleForPermissions } from '../common/permissions';

type Db = {
  accessProfile: any;
  user: any;
};

// Perfiles con que parte la empresa: Administrador, Vendedor y Gestor de catálogo (más los de
// `alsoRoles`, p. ej. Despachador si la empresa ya tenía despachadores). No pisa perfiles
// existentes: si ya hay uno con ese nombre se crea "(base)". Devuelve el id del perfil de cada rol.
export async function ensureDefaultProfiles(db: Db, companyId: string, alsoRoles: string[] = []): Promise<Record<string, string>> {
  const existing: Array<{ id: string; name: string; baseRole: string | null }> = await db.accessProfile.findMany({
    where: { companyId }, select: { id: true, name: true, baseRole: true },
  });
  const out: Record<string, string> = {};
  for (const d of DEFAULT_PROFILES) {
    if (!d.base && !alsoRoles.includes(d.role)) continue;
    const perms = ROLE_DEFAULT_PERMISSIONS[d.role] ?? [];
    // Ya creado antes: se reconoce por la marca, aunque se haya editado o renombrado.
    const same = existing.find((p) => p.baseRole === d.role);
    if (same) { out[d.role] = same.id; continue; }
    // Un perfil propio de la empresa con el mismo nombre no se toca: el base queda como "(base)".
    const taken = existing.some((p) => p.name.toLowerCase() === d.name.toLowerCase());
    const created = await db.accessProfile.create({ data: { companyId, name: taken ? `${d.name} (base)` : d.name, permissions: perms, baseRole: d.role } });
    existing.push(created);
    out[d.role] = created.id;
  }
  return out;
}

// El rol de cada usuario sigue al perfil: al editar los permisos de un perfil se recalcula.
export async function syncProfileUsers(db: Db, profileId: string, permissions: string[]) {
  const { role } = roleForPermissions(permissions);
  await db.user.updateMany({ where: { accessProfileId: profileId, role: { not: Role.SUPER_ADMIN } }, data: { role } });
  return role;
}
