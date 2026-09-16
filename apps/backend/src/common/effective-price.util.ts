import { PrismaService } from '../prisma/prisma.service';

// Si el producto tiene un precio propio para esta conexión puntual (ChannelPrice), se usa
// ese en vez del precio de fallback — así el mismo producto puede venderse a precios
// distintos en cuentas/canales distintos (ej. dos cuentas de Mercado Libre, o "Precio de
// Venta Paris" vs el precio normal del catálogo). Sin override, cae al fallback de siempre.
export async function getEffectivePrice(
  prisma: PrismaService,
  productId: string,
  connectionId: string,
  fallback: number,
): Promise<number> {
  const override = await prisma.channelPrice.findUnique({
    where: { productId_connectionId: { productId, connectionId } },
  });
  return override ? Number(override.price) : fallback;
}
