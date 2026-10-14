import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveCompanyId } from '../common/tenant';

// Estado de puesta en marcha de la empresa: lo usan las pantallas vacías del panel
// ("Primeros pasos") para marcar solos los pasos ya hechos. Solo conteos, cualquier rol.
@Controller('company-account')
@UseGuards(JwtAuthGuard)
export class CompanySetupController {
  constructor(private prisma: PrismaService) {}

  @Get('setup')
  async setup(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    const id = resolveCompanyId(user, companyId);
    const [company, connections, products, sales, channelSales, orders] = await Promise.all([
      this.prisma.company.findUnique({ where: { id }, select: { createdAt: true } }),
      this.prisma.marketplaceConnection.count({ where: { companyId: id, active: true } }),
      this.prisma.product.count({ where: { companyId: id } }),
      this.prisma.sale.count({ where: { companyId: id } }),
      this.prisma.sale.count({ where: { companyId: id, channel: { not: 'POS' } } }),
      this.prisma.order.count({ where: { companyId: id } }),
    ]);
    return { companyCreatedAt: company?.createdAt ?? null, connections, products, sales, channelSales, orders };
  }
}
