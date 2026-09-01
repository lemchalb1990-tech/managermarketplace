import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Exige que el usuario tenga al menos uno de estos permisos (o rol SUPER_ADMIN).
 * Se usa junto con PermissionsGuard.
 */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
