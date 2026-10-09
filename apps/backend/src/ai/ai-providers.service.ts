import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { AI_PROVIDERS, AI_TASKS, type AiTask, providerById } from './providers/catalog';
import { ADAPTERS } from './providers/adapters';
import type { ImageData, PhotoCheckContext, PhotoVerdict } from './providers/photo-prompts';

export type { ImageData, PhotoVerdict } from './providers/photo-prompts';

// Proveedores de IA de la plataforma: configuración (Super Admin) y ejecución de cada tarea
// con el proveedor que tenga asignado.
@Injectable()
export class AiProvidersService {
  constructor(private settings: SettingsService) {}

  private async taskProvider(task: AiTask) {
    const id = await this.settings.get(AI_TASKS[task].settingKey);
    const def = id ? providerById(id) : undefined;
    if (!def || !def.tasks.includes(task)) {
      throw new BadRequestException(`No hay una IA asignada para "${AI_TASKS[task].label}" (Administrador de plataforma → Inteligencia artificial).`);
    }
    const key = await this.settings.get(def.apiKeySetting);
    if (!key) throw new BadRequestException(`Falta la API Key de ${def.name} (Administrador de plataforma → Inteligencia artificial).`);
    const model = def.models[task] ? (await this.settings.get(def.models[task]!.settingKey)) || def.models[task]!.default : '';
    return { def, key, model, extra: await this.extra(def.id), adapter: ADAPTERS[def.id] };
  }

  // Datos extra del proveedor (p. ej. el ID de cuenta de Cloudflare).
  private async extra(providerId: string): Promise<Record<string, string>> {
    const def = providerById(providerId);
    const out: Record<string, string> = {};
    for (const f of def?.extraFields || []) out[f.settingKey] = await this.settings.get(f.settingKey);
    return out;
  }

  /** Tareas que hoy tienen un proveedor asignado y con API key. */
  async readyTasks(): Promise<Record<AiTask, boolean>> {
    const out = {} as Record<AiTask, boolean>;
    for (const task of Object.keys(AI_TASKS) as AiTask[]) {
      out[task] = await this.taskProvider(task).then(() => true, () => false);
    }
    return out;
  }

  async checkPhoto(image: ImageData, ctx: PhotoCheckContext): Promise<PhotoVerdict> {
    const p = await this.taskProvider('PHOTO_CHECK');
    return p.adapter.check!(p.key, p.model, image, ctx, p.extra);
  }

  async fixPhoto(image: ImageData, title: string): Promise<ImageData> {
    const p = await this.taskProvider('PHOTO_FIX');
    return p.adapter.fix!(p.key, p.model, image, title, p.extra);
  }

  async generatePhoto(title: string, description?: string | null): Promise<ImageData> {
    const p = await this.taskProvider('PHOTO_GENERATE');
    return p.adapter.generate!(p.key, p.model, title, description, p.extra);
  }

  // ── Configuración (Super Admin) ──────────────────────────────────────────

  async overview() {
    const assigned: Record<string, string> = {};
    for (const [task, t] of Object.entries(AI_TASKS)) assigned[task] = await this.settings.get(t.settingKey);
    const providers = await Promise.all(AI_PROVIDERS.map(async (p) => {
      const models: Record<string, { value: string; default: string; label: string; hint: string }> = {};
      for (const [task, m] of Object.entries(p.models)) {
        models[task] = { value: (await this.settings.get(m!.settingKey)) || m!.default, default: m!.default, label: m!.label, hint: m!.hint };
      }
      return {
        id: p.id,
        name: p.name,
        company: p.company,
        description: p.description,
        keyUrl: p.keyUrl,
        tasks: p.tasks,
        taskNotes: p.taskNotes,
        configured: !!(await this.settings.get(p.apiKeySetting))
          && (await Promise.all((p.extraFields || []).map((f) => this.settings.get(f.settingKey)))).every(Boolean),
        extraFields: await Promise.all((p.extraFields || []).map(async (f) => ({
          key: f.settingKey, label: f.label, hint: f.hint, sensitive: f.sensitive,
          // Los sensibles no se devuelven: solo si están guardados.
          value: f.sensitive ? '' : await this.settings.get(f.settingKey),
          set: !!(await this.settings.get(f.settingKey)),
        }))),
        assignedTasks: (Object.keys(assigned) as AiTask[]).filter((t) => assigned[t] === p.id),
        models,
      };
    }));
    const tasks = Object.fromEntries(Object.entries(AI_TASKS).map(([task, t]) => [task, {
      label: t.label, description: t.description, providerId: assigned[task] || null,
    }]));
    return { providers, tasks };
  }

  async update(id: string, dto: { apiKey?: string; removeKey?: boolean; models?: Record<string, string>; tasks?: string[]; extra?: Record<string, string> }) {
    const def = providerById(id);
    if (!def) throw new NotFoundException('Proveedor de IA no encontrado');
    const items: { key: string; value: string }[] = [];
    if (dto.removeKey) items.push({ key: def.apiKeySetting, value: '' });
    else if (dto.apiKey?.trim()) items.push({ key: def.apiKeySetting, value: dto.apiKey.trim() });
    for (const f of def.extraFields || []) {
      const v = dto.extra?.[f.settingKey];
      if (v !== undefined && (v.trim() || !f.sensitive)) items.push({ key: f.settingKey, value: v.trim() });
    }
    for (const [task, value] of Object.entries(dto.models || {})) {
      const m = def.models[task as AiTask];
      if (m) items.push({ key: m.settingKey, value: value.trim() || m.default });
    }
    if (dto.tasks) {
      for (const task of def.tasks) {
        const settingKey = AI_TASKS[task].settingKey;
        if (dto.tasks.includes(task)) items.push({ key: settingKey, value: def.id });
        else if ((await this.settings.get(settingKey)) === def.id) items.push({ key: settingKey, value: '' });
      }
    }
    if (items.length) await this.settings.upsertMany(items);
    return this.overview();
  }

  async test(id: string, apiKey?: string, extra?: Record<string, string>) {
    const def = providerById(id);
    if (!def) throw new NotFoundException('Proveedor de IA no encontrado');
    const key = apiKey?.trim() || (await this.settings.get(def.apiKeySetting));
    if (!key) throw new BadRequestException(`Ingresa la API Key de ${def.name} para probarla.`);
    const saved = await this.extra(def.id);
    await ADAPTERS[def.id].test(key, { ...saved, ...Object.fromEntries(Object.entries(extra || {}).filter(([, v]) => v?.trim())) });
    return { ok: true, message: `Conexión con ${def.name} correcta.` };
  }
}
