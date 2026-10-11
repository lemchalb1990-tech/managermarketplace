import { PrismaService } from '../prisma/prisma.service';

// Protección de precio: si una publicación de Mercado Libre está en una promoción (activa o
// programada), no se le envía el precio. ML quita el descuento cuando se sube el precio, y la
// sincronización podría hacerlo sin que nadie lo note. Al terminar la promoción el módulo de
// promociones vuelve a encolar el precio (ver MlPromotionsService.syncItemPromos).
const ACTIVE = ['started', 'pending', 'sync_requested'];

export async function itemsInPromotion(prisma: PrismaService, connectionId: string, itemIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = Array.from(new Set(itemIds.filter((x): x is string => !!x)));
  if (!ids.length) return new Set();
  const rows = await prisma.mlPromotionItem.findMany({
    where: { connectionId, itemId: { in: ids }, status: { in: ACTIVE } },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
}

export async function isInPromotion(prisma: PrismaService, connectionId: string, itemId: string | null | undefined) {
  if (!itemId) return false;
  return (await itemsInPromotion(prisma, connectionId, [itemId])).has(itemId);
}
