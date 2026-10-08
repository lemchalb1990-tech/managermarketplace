import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PLAN_FEATURES, SubscriptionService } from './subscription.service';

class PlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() description?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) monthlyPrice?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) annualPrice?: number | null;
  @IsOptional() @IsBoolean() priceFrom?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) implementationPrice?: number | null;
  @IsOptional() @IsBoolean() implementationFreeAnnual?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxChannels?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxProducts?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxUsers?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxWarehouses?: number | null;
  @IsOptional() @IsArray() @IsIn(PLAN_FEATURES as unknown as string[], { each: true }) features?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() addons?: string | null;
  @IsOptional() @IsBoolean() isTrial?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) trialDays?: number | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class AssignDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() planId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(['MONTHLY', 'ANNUAL']) billing?: string | null;
}

@Controller('subscription')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionController {
  constructor(private service: SubscriptionService) {}

  // Plan y consumo de la empresa (página Uso).
  @Get('usage')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  usage(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    const cId = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    if (!cId) throw new ForbiddenException('Selecciona una empresa');
    return this.service.usage(cId);
  }

  @Get('plans')
  @Roles(Role.SUPER_ADMIN)
  list() {
    return this.service.listPlans();
  }

  @Post('plans')
  @Roles(Role.SUPER_ADMIN)
  create(@Body() dto: PlanDto) {
    return this.service.createPlan(dto);
  }

  @Patch('plans/:id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: PlanDto) {
    return this.service.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @Roles(Role.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.service.deletePlan(id);
  }

  @Patch('companies/:companyId')
  @Roles(Role.SUPER_ADMIN)
  assign(@Param('companyId') companyId: string, @Body() dto: AssignDto) {
    return this.service.assignPlan(companyId, dto.planId ?? null, dto.billing ?? null);
  }
}
