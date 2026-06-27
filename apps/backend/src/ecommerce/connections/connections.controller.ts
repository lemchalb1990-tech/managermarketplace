import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ConnectionsService } from './connections.service';
import { CreateConnectionDto, LinkProductDto } from './connections.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('ecommerce/connections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConnectionsController {
  constructor(private service: ConnectionsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  list(
    @CurrentUser() user: any,
    @Query('marketplace') marketplace?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.listConnections(user, marketplace, companyId);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  create(@Body() dto: CreateConnectionDto, @CurrentUser() user: any) {
    return this.service.createConnection(dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteConnection(id, user);
  }

  @Post(':id/test')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  test(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.testConnection(id, user);
  }

  @Post(':connectionId/products/:productId/publish')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  publish(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.publishProduct(connectionId, productId, user);
  }

  @Post(':connectionId/products/:productId/link')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  link(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @Body() dto: LinkProductDto,
    @CurrentUser() user: any,
  ) {
    return this.service.linkProduct(connectionId, productId, dto, user);
  }

  @Get('products/:productId/listings')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  listings(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.getProductListings(productId, user);
  }
}
