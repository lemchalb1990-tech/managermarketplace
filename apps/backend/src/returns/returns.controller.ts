import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { CreateReturnDto, ReceiveReturnDto, ScanReturnDto, ListReturnsDto } from './dto/return.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('returns')
export class ReturnsController {
  constructor(private service: ReturnsService) {}

  @Get()
  list(@CurrentUser() user: any, @Query() dto: ListReturnsDto) {
    return this.service.list(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateReturnDto) {
    return this.service.create(user, dto);
  }

  @Post('scan')
  scan(@CurrentUser() user: any, @Body() dto: ScanReturnDto) {
    return this.service.scan(user, dto.code);
  }

  @Post(':id/receive')
  receive(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ReceiveReturnDto) {
    return this.service.receive(user, id, dto);
  }

  @Post(':id/undo')
  undo(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.undo(user, id);
  }
}
