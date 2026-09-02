import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ShippingService } from './shipping.service';
import { BoardDto, DispatchDto } from './dto/shipping.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('shipping')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('shipping')
export class ShippingController {
  constructor(private service: ShippingService) {}

  @Get('board')
  board(@CurrentUser() user: any, @Query() dto: BoardDto) {
    return this.service.board(user, dto);
  }

  @Post('dispatch')
  dispatch(@CurrentUser() user: any, @Body() dto: DispatchDto) {
    return this.service.dispatch(user, dto);
  }

  @Get('slip')
  async slip(
    @CurrentUser() user: any,
    @Query('orderIds') orderIds: string,
    @Res() res: Response,
  ) {
    const ids = (orderIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const html = await this.service.slip(user, ids);
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
}
