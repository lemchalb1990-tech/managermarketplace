import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import {
  UpsertDriverProfileDto,
  SetOutcomeDto,
  RangeDto,
  CreatePaymentBatchDto,
} from './dto/drivers.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('drivers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DriversController {
  constructor(private service: DriversService) {}

  @Get('fleet')
  @RequirePermissions('drivers.fleet')
  fleet(@CurrentUser() user: any) {
    return this.service.fleet(user);
  }

  @Patch('fleet/:driverId/profile')
  @RequirePermissions('drivers.fleet')
  upsertProfile(
    @CurrentUser() user: any,
    @Param('driverId') driverId: string,
    @Body() dto: UpsertDriverProfileDto,
  ) {
    return this.service.upsertProfile(user, driverId, dto);
  }

  @Patch('stops/:stopId/outcome')
  @RequirePermissions('drivers.fleet', 'despachos')
  setOutcome(
    @CurrentUser() user: any,
    @Param('stopId') stopId: string,
    @Body() dto: SetOutcomeDto,
  ) {
    return this.service.setOutcome(user, stopId, dto);
  }

  @Get('metrics')
  @RequirePermissions('drivers.metrics')
  metrics(@CurrentUser() user: any, @Query() dto: RangeDto) {
    return this.service.metrics(user, dto);
  }

  @Get('payments/summary')
  @RequirePermissions('drivers.payments')
  paymentsSummary(@CurrentUser() user: any, @Query() dto: RangeDto) {
    return this.service.paymentsSummary(user, dto);
  }

  @Post('payments/batch')
  @RequirePermissions('drivers.payments')
  createBatch(@CurrentUser() user: any, @Body() dto: CreatePaymentBatchDto) {
    return this.service.createPaymentBatch(user, dto);
  }

  @Get('payments/batches')
  @RequirePermissions('drivers.payments')
  listBatches(@CurrentUser() user: any, @Query() dto: RangeDto) {
    return this.service.listPaymentBatches(user, dto);
  }

  @Patch('payments/batches/:id/paid')
  @RequirePermissions('drivers.payments')
  markPaid(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.markPaymentPaid(user, id);
  }

  @Get('zones')
  @RequirePermissions('drivers.zones')
  zones(@CurrentUser() user: any, @Query() dto: RangeDto) {
    return this.service.zones(user, dto);
  }
}
