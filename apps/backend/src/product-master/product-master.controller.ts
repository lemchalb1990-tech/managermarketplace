import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductMasterService } from './product-master.service';
import { CreateProductMasterDto, UpdateProductMasterDto, LinkProductDto, SetVariantAttributesDto } from './dto/product-master.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('product-masters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class ProductMasterController {
  constructor(private service: ProductMasterService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.findAll(user, companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateProductMasterDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductMasterDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Post(':id/link')
  linkProduct(@Param('id') id: string, @Body() dto: LinkProductDto, @CurrentUser() user: any) {
    return this.service.linkProduct(id, dto.productId, user);
  }

  @Post('unlink/:productId')
  unlinkProduct(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.unlinkProduct(productId, user);
  }

  @Patch('products/:productId/attributes')
  setVariantAttributes(
    @Param('productId') productId: string,
    @Body() dto: SetVariantAttributesDto,
    @CurrentUser() user: any,
  ) {
    return this.service.setVariantAttributes(productId, dto.attributes, user);
  }
}
