import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveCompanyId } from '../common/tenant';
import { productionActive } from './production.util';

export interface ProductionSettings {
  // Cuándo se descuentan los materiales: al iniciar la orden, al iniciar la etapa que los usa, o al terminar.
  consumeMaterialsAt: 'START' | 'STAGE' | 'END';
  // No despachar mientras la venta tenga saldo por cobrar.
  blockDispatchWithBalance: boolean;
  // Avisos automáticos al cliente: preparados, todavía apagados (no se envía nada).
  notifications: { email: boolean; whatsapp: boolean };
}

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  consumeMaterialsAt: 'STAGE',
  blockDispatchWithBalance: false,
  notifications: { email: false, whatsapp: false },
};

export function readProductionSettings(raw: unknown): ProductionSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProductionSettings>;
  return {
    consumeMaterialsAt: s.consumeMaterialsAt === 'START' || s.consumeMaterialsAt === 'END' ? s.consumeMaterialsAt : 'STAGE',
    blockDispatchWithBalance: !!s.blockDispatchWithBalance,
    // Los avisos aún no están disponibles: siempre apagados.
    notifications: { email: false, whatsapp: false },
  };
}

export interface StageInput {
  name: string;
  areaId?: string | null;
  estimatedDays?: number | null;
  estimatedHours?: number | null;
  checklist?: string[];
  requiresApproval?: boolean;
  notifyCustomer?: boolean;
  customerVisible?: boolean;
}

@Injectable()
export class ProductionConfigService {
  constructor(private prisma: PrismaService) {}

  async companyFor(user: any, companyId?: string) {
    const cId = resolveCompanyId(user, companyId);
    if (!(await productionActive(this.prisma, cId))) throw new ForbiddenException('La empresa no tiene el módulo de Fabricación');
    return cId;
  }

  // ── Ajustes ──────────────────────────────────────────────────────────

  async getSettings(user: any, companyId?: string) {
    const cId = await this.companyFor(user, companyId);
    const c = await this.prisma.company.findUnique({ where: { id: cId }, select: { productionSettings: true } });
    return readProductionSettings(c?.productionSettings);
  }

  async updateSettings(user: any, dto: Partial<ProductionSettings> & { companyId?: string }) {
    const cId = await this.companyFor(user, dto.companyId);
    const c = await this.prisma.company.findUnique({ where: { id: cId }, select: { productionSettings: true } });
    const next = readProductionSettings({ ...readProductionSettings(c?.productionSettings), ...dto });
    await this.prisma.company.update({ where: { id: cId }, data: { productionSettings: next as unknown as Prisma.InputJsonValue } });
    return next;
  }

  // ── Áreas ────────────────────────────────────────────────────────────

  async listAreas(user: any, companyId?: string) {
    const cId = await this.companyFor(user, companyId);
    return this.prisma.productionArea.findMany({ where: { companyId: cId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  async saveArea(user: any, dto: { id?: string; companyId?: string; name: string; hourlyCost?: number; dailyCapacityHours?: number | null; active?: boolean }) {
    const cId = await this.companyFor(user, dto.companyId);
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Ingresa el nombre del área');
    const data = {
      name,
      hourlyCost: Math.max(0, Number(dto.hourlyCost) || 0),
      dailyCapacityHours: dto.dailyCapacityHours == null || dto.dailyCapacityHours === ('' as any) ? null : Math.max(0, Number(dto.dailyCapacityHours)),
      active: dto.active ?? true,
    };
    try {
      if (dto.id) {
        const area = await this.prisma.productionArea.findUnique({ where: { id: dto.id } });
        if (!area || area.companyId !== cId) throw new NotFoundException('Área no encontrada');
        return await this.prisma.productionArea.update({ where: { id: dto.id }, data });
      }
      return await this.prisma.productionArea.create({ data: { ...data, companyId: cId } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException('Ya existe un área con ese nombre');
      throw e;
    }
  }

  async deleteArea(user: any, id: string) {
    const area = await this.prisma.productionArea.findUnique({ where: { id } });
    if (!area) throw new NotFoundException('Área no encontrada');
    await this.companyFor(user, area.companyId);
    const used = await this.prisma.productionOrderStage.count({ where: { areaId: id } });
    if (used) {
      await this.prisma.productionArea.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.productionArea.delete({ where: { id } });
    return { ok: true };
  }

  // ── Procesos ─────────────────────────────────────────────────────────

  async listProcesses(user: any, companyId?: string) {
    const cId = await this.companyFor(user, companyId);
    return this.prisma.productionProcess.findMany({
      where: { companyId: cId },
      include: {
        stages: { orderBy: { position: 'asc' }, include: { area: { select: { id: true, name: true } } } },
        _count: { select: { products: true, orders: true } },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async saveProcess(user: any, dto: { id?: string; companyId?: string; name: string; description?: string; isRepair?: boolean; active?: boolean; stages: StageInput[] }) {
    const cId = await this.companyFor(user, dto.companyId);
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Ingresa el nombre del proceso');
    const stages = (dto.stages || []).filter((s) => String(s.name || '').trim());
    if (!stages.length) throw new BadRequestException('El proceso debe tener al menos una etapa');
    const areaIds = [...new Set(stages.map((s) => s.areaId).filter(Boolean) as string[])];
    if (areaIds.length) {
      const ok = await this.prisma.productionArea.count({ where: { id: { in: areaIds }, companyId: cId } });
      if (ok !== areaIds.length) throw new BadRequestException('Área no válida');
    }
    const stageData = stages.map((s, i) => ({
      position: i,
      name: String(s.name).trim(),
      areaId: s.areaId || null,
      estimatedDays: s.estimatedDays == null || (s.estimatedDays as any) === '' ? null : Math.max(0, Number(s.estimatedDays)),
      estimatedHours: s.estimatedHours == null || (s.estimatedHours as any) === '' ? null : Math.max(0, Number(s.estimatedHours)),
      checklist: (s.checklist || []).map((c) => String(c).trim()).filter(Boolean),
      requiresApproval: !!s.requiresApproval,
      notifyCustomer: !!s.notifyCustomer,
      customerVisible: s.customerVisible ?? true,
    }));
    const base = { name, description: dto.description?.trim() || null, isRepair: !!dto.isRepair, active: dto.active ?? true };
    // Cambiar las etapas del proceso no altera las órdenes ya creadas (tienen su copia).
    return this.prisma.$transaction(async (tx) => {
      if (dto.id) {
        const p = await tx.productionProcess.findUnique({ where: { id: dto.id } });
        if (!p || p.companyId !== cId) throw new NotFoundException('Proceso no encontrado');
        await tx.productionProcessStage.deleteMany({ where: { processId: dto.id } });
        return tx.productionProcess.update({ where: { id: dto.id }, data: { ...base, stages: { create: stageData } }, include: { stages: { orderBy: { position: 'asc' } } } });
      }
      return tx.productionProcess.create({ data: { ...base, companyId: cId, stages: { create: stageData } }, include: { stages: { orderBy: { position: 'asc' } } } });
    });
  }

  async deleteProcess(user: any, id: string) {
    const p = await this.prisma.productionProcess.findUnique({ where: { id }, include: { _count: { select: { orders: true, products: true } } } });
    if (!p) throw new NotFoundException('Proceso no encontrado');
    await this.companyFor(user, p.companyId);
    if (p._count.orders || p._count.products) {
      await this.prisma.productionProcess.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.productionProcess.delete({ where: { id } });
    return { ok: true };
  }

  // ── Lista de materiales ──────────────────────────────────────────────

  private async productFor(user: any, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, companyId: true, name: true } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    await this.companyFor(user, product.companyId);
    return product;
  }

  async getMaterials(user: any, productId: string) {
    await this.productFor(user, productId);
    const rows = await this.prisma.productMaterial.findMany({
      where: { productId },
      include: { material: { select: { id: true, name: true, sku: true, stock: true, cost: true } } },
      orderBy: { material: { name: 'asc' } },
    });
    return rows.map((r) => ({
      id: r.id, materialId: r.materialId, quantity: Number(r.quantity), stageName: r.stageName, notes: r.notes,
      material: { ...r.material, cost: r.material.cost != null ? Number(r.material.cost) : null },
    }));
  }

  async setMaterials(user: any, productId: string, items: Array<{ materialId: string; quantity: number; stageName?: string | null; notes?: string | null }>) {
    const product = await this.productFor(user, productId);
    const clean = (items || []).filter((i) => i.materialId && Number(i.quantity) > 0);
    if (clean.some((i) => i.materialId === productId)) throw new BadRequestException('Un producto no puede ser material de sí mismo');
    const ids = [...new Set(clean.map((i) => i.materialId))];
    if (ids.length !== clean.length) throw new BadRequestException('Hay materiales repetidos');
    if (ids.length) {
      const ok = await this.prisma.product.count({ where: { id: { in: ids }, companyId: product.companyId } });
      if (ok !== ids.length) throw new BadRequestException('Material no válido');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productMaterial.deleteMany({ where: { productId } });
      if (clean.length) {
        await tx.productMaterial.createMany({
          data: clean.map((i) => ({ productId, materialId: i.materialId, quantity: Number(i.quantity), stageName: i.stageName?.trim() || null, notes: i.notes?.trim() || null })),
        });
      }
    });
    return this.getMaterials(user, productId);
  }
}
