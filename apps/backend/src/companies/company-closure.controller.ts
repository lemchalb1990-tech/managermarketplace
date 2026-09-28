import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CompanyClosureService } from './company-closure.service';

class RequestClosureDto {
  @IsString() @IsNotEmpty() password: string;
  @IsString() @IsNotEmpty() companyName: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() companyId?: string;
}

// Baja de la cuenta por el administrador de la empresa (el servicio exige COMPANY_ADMIN o
// SUPER_ADMIN). Revertirla es solo del super admin: POST /companies/:id/closure/cancel.
@Controller('company-account')
@UseGuards(JwtAuthGuard)
export class CompanyClosureController {
  constructor(private service: CompanyClosureService) {}

  @Get('closure')
  status(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.status(user, companyId);
  }

  @Get('export')
  async export(@CurrentUser() user: any, @Res() res: Response, @Query('companyId') companyId?: string) {
    const { filename, buffer } = await this.service.exportData(user, companyId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('closure')
  request(@CurrentUser() user: any, @Body() dto: RequestClosureDto) {
    return this.service.requestClosure(user, dto);
  }
}
