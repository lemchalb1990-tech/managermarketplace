import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/transfer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('stock-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class TransfersController {
  constructor(private service: TransfersService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('page') page?: string) {
    return this.service.findAllPaginated(user, { companyId, page });
  }

  @Post()
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }
}
