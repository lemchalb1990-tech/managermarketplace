import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiCreditsService, PLAN_FEATURES } from './ai-credits.service';
import { AiProvidersService } from './ai-providers.service';

class AiPlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) dailyCredits?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) monthlyCredits?: number | null;
  @IsOptional() @IsArray() @IsIn(PLAN_FEATURES as unknown as string[], { each: true }) features?: string[];
}

class UpdateProviderDto {
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsBoolean() removeKey?: boolean;
  @IsOptional() @IsObject() models?: Record<string, string>;
  @IsOptional() @IsArray() @IsString({ each: true }) tasks?: string[];
}

class TestProviderDto {
  @IsOptional() @IsString() apiKey?: string;
}

class CostsDto {
  @IsOptional() @IsInt() @Min(0) PHOTO_CHECK?: number;
  @IsOptional() @IsInt() @Min(0) PHOTO_FIX?: number;
  @IsOptional() @IsInt() @Min(0) PHOTO_GENERATE?: number;
}

class AssignPlanDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() aiPlanId?: string | null;
}

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private credits: AiCreditsService, private providers: AiProvidersService) {}

  // Créditos de la empresa (los muestra la revisión de fotos antes de publicar).
  @Get('credits')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  status(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    const cId = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    if (!cId) throw new ForbiddenException('Selecciona una empresa');
    return this.credits.status(cId);
  }

  // Página "Uso" (Ajustes del sistema): plan, créditos y lo usado por la empresa.
  @Get('usage')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  usage(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    const cId = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    if (!cId) throw new ForbiddenException('Selecciona una empresa');
    return this.credits.companyUsage(cId);
  }

  // ── Proveedores de IA y costo de cada tarea: solo Super Admin ──

  @Get('providers')
  @Roles(Role.SUPER_ADMIN)
  async listProviders() {
    const [overview, costs, stats] = await Promise.all([
      this.providers.overview(),
      Promise.all([this.credits.cost('PHOTO_CHECK'), this.credits.cost('PHOTO_FIX'), this.credits.cost('PHOTO_GENERATE')]),
      this.credits.usageStats(),
    ]);
    return { ...overview, costs: { PHOTO_CHECK: costs[0], PHOTO_FIX: costs[1], PHOTO_GENERATE: costs[2] }, stats };
  }

  @Patch('providers/:id')
  @Roles(Role.SUPER_ADMIN)
  updateProvider(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return this.providers.update(id, dto);
  }

  // Verifica la API key (la escrita en el modal o la guardada) sin gastar créditos.
  @Post('providers/:id/test')
  @Roles(Role.SUPER_ADMIN)
  testProvider(@Param('id') id: string, @Body() dto: TestProviderDto) {
    return this.providers.test(id, dto?.apiKey);
  }

  @Patch('costs')
  @Roles(Role.SUPER_ADMIN)
  updateCosts(@Body() dto: CostsDto) {
    return this.credits.updateCosts(dto);
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
    return this.credits.createPlan({ name: dto.name ?? '', dailyCredits: dto.dailyCredits ?? null, monthlyCredits: dto.monthlyCredits ?? null, features: dto.features });
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
