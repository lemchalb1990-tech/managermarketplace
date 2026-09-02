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
import { WarehouseService } from './warehouse.service';
import {
  AssignDto,
  ResetAssignmentsDto,
  ScanDto,
  PickItemDto,
  OutOfStockDto,
  BoardQueryDto,
  FlowListDto,
} from './dto/warehouse.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('warehouse')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehouseController {
  constructor(private service: WarehouseService) {}

  @Get('board')
  @RequirePermissions('warehouse.board')
  board(@CurrentUser() user: any, @Query() q: BoardQueryDto) {
    return this.service.board(user, q.warehouseId);
  }

  @Post('assign')
  @RequirePermissions('warehouse.board')
  assign(@CurrentUser() user: any, @Body() dto: AssignDto) {
    return this.service.assign(user, dto);
  }

  @Post('assign/reset')
  @RequirePermissions('warehouse.board')
  reset(@CurrentUser() user: any, @Body() dto: ResetAssignmentsDto) {
    return this.service.resetAssignments(user, dto);
  }

  // ── Picking ──
  @Get('picking')
  @RequirePermissions('warehouse.picking')
  pickingList(@CurrentUser() user: any, @Query() q: FlowListDto) {
    return this.service.pickingList(user, q);
  }

  @Post('picking/scan')
  @RequirePermissions('warehouse.picking')
  pickingScan(@CurrentUser() user: any, @Body() dto: ScanDto) {
    return this.service.pickingScan(user, dto);
  }

  @Patch('picking/:orderId/item/:itemId')
  @RequirePermissions('warehouse.picking')
  pickItem(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: PickItemDto,
  ) {
    return this.service.pickItem(user, orderId, itemId, dto);
  }

  @Patch('picking/:orderId/item/:itemId/out-of-stock')
  @RequirePermissions('warehouse.picking')
  outOfStock(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: OutOfStockDto,
  ) {
    return this.service.setOutOfStock(user, orderId, itemId, dto);
  }

  @Post('picking/:orderId/complete')
  @RequirePermissions('warehouse.picking')
  completePicking(@CurrentUser() user: any, @Param('orderId') orderId: string) {
    return this.service.completePicking(user, orderId);
  }

  // ── Packing ──
  @Get('packing')
  @RequirePermissions('warehouse.packing')
  packingList(@CurrentUser() user: any, @Query() q: FlowListDto) {
    return this.service.packingList(user, q);
  }

  @Post('packing/scan')
  @RequirePermissions('warehouse.packing')
  packingScan(@CurrentUser() user: any, @Body() dto: ScanDto) {
    return this.service.packingScan(user, dto);
  }

  @Post('packing/:orderId/confirm')
  @RequirePermissions('warehouse.packing')
  confirmPacked(@CurrentUser() user: any, @Param('orderId') orderId: string) {
    return this.service.confirmPacked(user, orderId);
  }
}
