import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Helpers de aislamiento multi-empresa. Un usuario que no es SUPER_ADMIN solo
 * puede ver/tocar registros de su propia empresa; SUPER_ADMIN ve todo (salvo que
 * el caller filtre explícitamente por empresa).
 */

export function isSuperAdmin(user: any): boolean {
  return user?.role === Role.SUPER_ADMIN;
}

/** Fragmento `where` por empresa para list/count. SUPER_ADMIN → {} (sin filtro). */
export function companyWhere(user: any): Record<string, any> {
  if (isSuperAdmin(user)) return {};
  if (!user?.companyId) throw new ForbiddenException('Usuario sin empresa');
  return { companyId: user.companyId };
}

/**
 * Empresa efectiva para crear/asignar. SUPER_ADMIN debe indicar una empresa;
 * el resto usa siempre la suya (y no puede apuntar a otra).
 */
export function resolveCompanyId(user: any, requested?: string | null): string {
  if (isSuperAdmin(user)) {
    if (!requested) throw new BadRequestException('Selecciona una empresa');
    return requested;
  }
  if (!user?.companyId) throw new ForbiddenException('Usuario sin empresa');
  if (requested && requested !== user.companyId) {
    throw new ForbiddenException('No puedes operar sobre otra empresa');
  }
  return user.companyId;
}

/** Lanza si el registro no pertenece a la empresa del usuario (SUPER_ADMIN pasa). */
export function assertSameCompany(
  record: { companyId?: string | null } | null,
  user: any,
): void {
  if (!isSuperAdmin(user) && record?.companyId !== user?.companyId) {
    throw new ForbiddenException();
  }
}
