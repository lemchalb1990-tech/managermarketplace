import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessProfilesService } from './access-profiles.service';
import {
  CreateAccessProfileDto,
  UpdateAccessProfileDto,
} from './dto/access-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('access-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
export class AccessProfilesController {
  constructor(private service: AccessProfilesService) {}

  @Get('catalog')
  catalog() {
    return this.service.catalog();
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.findAll(user, companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateAccessProfileDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAccessProfileDto,
    @CurrentUser() user: any,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}
