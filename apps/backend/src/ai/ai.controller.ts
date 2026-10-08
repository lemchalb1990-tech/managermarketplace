import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiCreditsService } from './ai-credits.service';

class AiPlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) dailyCredits?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) monthlyCredits?: number | null;
}

class AssignPlanDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() aiPlanId?: string | null;
}

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private credits: AiCreditsService) {}

  // Créditos de la empresa (los muestra la revisión de fotos antes de publicar).
  @Get('credits')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  status(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    const cId = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    if (!cId) throw new ForbiddenException('Selecciona una empresa');
    return this.credits.status(cId);
  }

  // ── Planes de IA: solo Super Admin ──

  @Get('plans')
  @Roles(Role.SUPER_ADMIN)
  listPlans() {
    return this.credits.listPlans();
  }

  @Post('plans')
  @Roles(Role.SUPER_ADMIN)
  createPlan(@Body() dto: AiPlanDto) {
    return this.credits.createPlan({ name: dto.name ?? '', dailyCredits: dto.dailyCredits ?? null, monthlyCredits: dto.monthlyCredits ?? null });
  }

  @Patch('plans/:id')
  @Roles(Role.SUPER_ADMIN)
  updatePlan(@Param('id') id: string, @Body() dto: AiPlanDto) {
    return this.credits.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @Roles(Role.SUPER_ADMIN)
  deletePlan(@Param('id') id: string) {
    return this.credits.deletePlan(id);
  }

  @Get('companies')
  @Roles(Role.SUPER_ADMIN)
  companies() {
    return this.credits.companiesOverview();
  }

  @Patch('companies/:companyId/plan')
  @Roles(Role.SUPER_ADMIN)
  assignPlan(@Param('companyId') companyId: string, @Body() dto: AssignPlanDto) {
    return this.credits.assignPlan(companyId, dto.aiPlanId ?? null);
  }
}
