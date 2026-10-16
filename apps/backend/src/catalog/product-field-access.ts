import { ForbiddenException } from '@nestjs/common';
import { canProductField, PRODUCT_FIELD_PERMISSIONS, permissionsForUser, hasPermission, PRODUCT_CREATE_PERMISSION, PRODUCT_ACTIVATE_PERMISSION, PRODUCT_MERGE_PERMISSION, canAddProductImages } from '../common/permissions';

// Campos del DTO/producto que cubre cada permiso de "Catálogo: campos del producto".
const FIELD_KEYS: Record<string, string[]> = {
  name: ['name'],
  type: ['type'],
  cost: ['cost', 'supplierPrice'],
  stock: ['stock'],
  sku: ['sku'],
  criticalStock: ['criticalStock'],
  warehouse: ['warehouseId'],
  description: ['description'],
  price: ['price', 'mlPrice', 'wholesalePrice', 'variablePrice', 'minPrice'],
  category: ['category'],
  fabricacion: ['supplyMode', 'requiresProcess', 'manufacturingDays', 'productionProcessId', 'specFields', 'advancePercent'],
};

const labelOf = (field: string) => PRODUCT_FIELD_PERMISSIONS.find((f) => f.field === field)?.label || field;

// Al crear: los campos que el usuario no puede ver no se aceptan (el formulario no los muestra).
// Nombre, SKU y precio son obligatorios al crear, así que se aceptan siempre como valor inicial.
export function dropHiddenOnCreate(user: any, dto: Record<string, any>) {
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    if (field === 'name' || field === 'sku' || field === 'price' || canProductField(user, field, 'view')) continue;
    for (const k of keys) delete dto[k];
  }
}

// Al editar: los campos sin permiso de modificar se descartan (el formulario los muestra
// bloqueados y los reenvía tal cual; si un dato quedó desactualizado, p. ej. el stock que
// cambió por una venta, no debe tomarse como un cambio del usuario).
export function dropNotEditableOnUpdate(user: any, dto: Record<string, any>) {
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    if (canProductField(user, field, 'edit')) continue;
    for (const k of keys) delete dto[k];
  }
}

export function assertCanViewField(user: any, field: string) {
  if (!canProductField(user, field, 'view')) {
    throw new ForbiddenException(`No tienes permiso para ver: ${labelOf(field)}`);
  }
}

export function assertCanEditField(user: any, field: string) {
  if (!canProductField(user, field, 'edit')) {
    throw new ForbiddenException(`No tienes permiso para modificar: ${labelOf(field)}`);
  }
}

// Sin "Costo: ver", el costo no sale del servidor.
export function stripHiddenProductFields<T>(user: any, data: T): T {
  if (canProductField(user, 'cost', 'view')) return data;
  const strip = (p: any) => {
    if (!p || typeof p !== 'object') return p;
    const { cost: _c, supplierPrice: _s, ...rest } = p;
    return rest;
  };
  return (Array.isArray(data) ? data.map(strip) : strip(data)) as T;
}

export function assertCanCreateProduct(user: any) {
  if (!hasPermission(permissionsForUser(user), PRODUCT_CREATE_PERMISSION)) {
    throw new ForbiddenException('No tienes permiso para agregar productos nuevos');
  }
}

export function assertCanActivateProduct(user: any) {
  if (!hasPermission(permissionsForUser(user), PRODUCT_ACTIVATE_PERMISSION)) {
    throw new ForbiddenException('No tienes permiso para activar o desactivar productos');
  }
}

export function assertCanAddImages(user: any) {
  if (!canAddProductImages(user)) {
    throw new ForbiddenException('No tienes permiso para agregar fotos al producto');
  }
}

export function assertCanMergeProducts(user: any) {
  if (!hasPermission(permissionsForUser(user), PRODUCT_MERGE_PERMISSION)) {
    throw new ForbiddenException('No tienes permiso para unificar productos');
  }
}

