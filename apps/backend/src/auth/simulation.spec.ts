import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { assertReadOnly, buildSimulatedUser } from './simulation';

describe('simulación de permisos', () => {
  it('solo deja pasar lecturas y la salida', () => {
    expect(() => assertReadOnly('GET', '/api/catalog/products')).not.toThrow();
    expect(() => assertReadOnly('POST', '/api/catalog/products/search?x=1')).not.toThrow();
    expect(() => assertReadOnly('POST', '/api/catalog/products/bulk/merge-preview')).not.toThrow();
    expect(() => assertReadOnly('POST', '/api/auth/simulate/stop')).not.toThrow();
    expect(() => assertReadOnly('POST', '/api/catalog/products')).toThrow(ForbiddenException);
    expect(() => assertReadOnly('PATCH', '/api/catalog/products/abc')).toThrow(ForbiddenException);
    expect(() => assertReadOnly('DELETE', '/api/users/abc')).toThrow(ForbiddenException);
    expect(() => assertReadOnly('POST', '/api/orders/abc/checks')).toThrow(ForbiddenException);
  });

  const admin = { id: 'sa', name: 'Super', email: 'sa@x.cl', role: Role.SUPER_ADMIN, password: 'hash', companyId: null };
  const company = { id: 'c1', name: 'Tienda Uno', subscriptionPlan: null };

  it('por perfil: rol, empresa y permisos del perfil, con el id del Super Admin', async () => {
    const prisma: any = {
      accessProfile: { findFirst: jest.fn(async () => ({ id: 'p1', name: 'Vendedor', permissions: ['pos', 'sales'] })) },
      company: { findUnique: jest.fn(async () => company) },
    };
    const u: any = await buildSimulatedUser(prisma, admin, { companyId: 'c1', profileId: 'p1' });
    expect(u.id).toBe('sa');
    expect(u.password).toBeUndefined();
    expect(u.role).toBe(Role.VENDEDOR);
    expect(u.companyId).toBe('c1');
    expect(u.accessProfile.permissions).toEqual(['pos', 'sales']);
    expect(u.simulation).toMatchObject({ mode: 'profile', companyName: 'Tienda Uno', profileName: 'Vendedor', by: { id: 'sa' } });
  });

  it('por usuario: es ese usuario; no se puede simular a otro Super Admin ni sin ser Super Admin', async () => {
    const target = { id: 'u2', name: 'Ana', role: Role.CATALOG_MANAGER, password: 'h', companyId: 'c1', company, accessProfile: { id: 'p2', name: 'Catálogo', permissions: [] } };
    const prisma: any = { user: { findFirst: jest.fn(async () => target) } };
    const u: any = await buildSimulatedUser(prisma, admin, { companyId: 'c1', userId: 'u2' });
    expect(u.id).toBe('u2');
    expect(u.password).toBeUndefined();
    expect(u.simulation).toMatchObject({ mode: 'user', userName: 'Ana', profileName: 'Catálogo' });

    prisma.user.findFirst = jest.fn(async () => ({ ...target, role: Role.SUPER_ADMIN }));
    await expect(buildSimulatedUser(prisma, admin, { companyId: 'c1', userId: 'u2' })).rejects.toThrow('Super Admin');
    await expect(buildSimulatedUser(prisma, { ...admin, role: Role.COMPANY_ADMIN }, { companyId: 'c1', userId: 'u2' })).rejects.toThrow(ForbiddenException);
  });
});
