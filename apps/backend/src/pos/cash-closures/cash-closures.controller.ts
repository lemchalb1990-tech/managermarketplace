import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CashClosuresService } from './cash-closures.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

class CloseCashDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() cashierId?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingCash?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) countedCash: number;
  @IsOptional() @IsString() notes?: string;
}

// Cierre de caja del punto de venta (solo venta directa).
@Controller('pos/cash-closures')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
export class CashClosuresController {
  constructor(private service: CashClosuresService) {}

  @Get('preview')
  preview(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('cashierId') cashierId?: string) {
    return this.service.preview(user, { companyId, cashierId });
  }

  @Get('cashiers')
  cashiers(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.cashiers(user, companyId);
  }

  @Get()
  list(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('page') page?: string) {
    return this.service.list(user, { companyId, page });
  }

  @Get(':id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  close(@CurrentUser() user: any, @Body() dto: CloseCashDto) {
    return this.service.close(user, dto);
  }
}
