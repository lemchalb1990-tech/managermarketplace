import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export const SETTING_DEFINITIONS = [
  {
    key: 'APP_URL',
    label: 'URL del backend',
    group: 'sistema',
    hint: 'URL pública del backend, usada para construir URLs absolutas de imágenes. Ej: https://api.tudominio.com',
    sensitive: false,
  },
  {
    key: 'FRONTEND_URL',
    label: 'URL del frontend',
    group: 'sistema',
    hint: 'URL pública del frontend, usada para redirects OAuth. Ej: https://tudominio.com',
    sensitive: false,
  },
  {
    key: 'ML_REDIRECT_URI',
    label: 'Callback URI de Mercado Libre',
    group: 'mercadolibre',
    hint: 'URL de callback OAuth registrada en la app de ML Developer. Ej: https://api.tudominio.com/api/ecommerce/ml/callback',
    sensitive: false,
  },
  {
    key: 'ML_DEFAULT_CATEGORY',
    label: 'Categoría ML por defecto',
    group: 'mercadolibre',
    hint: 'ID de categoría de Mercado Libre usada cuando el producto no tiene una asignada. Ej: MLC1000',
    sensitive: false,
  },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    // Inicializar settings con valores de env si no existen en BD
    for (const def of SETTING_DEFINITIONS) {
      const exists = await this.prisma.setting.findUnique({ where: { key: def.key } });
      if (!exists) {
        const envValue = this.config.get<string>(def.key) || '';
        await this.prisma.setting.create({
          data: {
            key: def.key,
            value: envValue,
            label: def.label,
            group: def.group,
            hint: def.hint,
            sensitive: def.sensitive,
          },
        });
      }
    }
  }

  async getAll() {
    const rows = await this.prisma.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    return rows.map((r) => ({
      ...r,
      value: r.sensitive ? (r.value ? '••••••••' : '') : r.value,
    }));
  }

  async get(key: string): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value || this.config.get<string>(key) || '';
  }

  async getPlatformSettings() {
    return this.prisma.platformSetting.findMany({ orderBy: { platform: 'asc' } });
  }

  async upsertPlatformSetting(platform: string, data: { displayName?: string; description?: string; logoUrl?: string }) {
    return this.prisma.platformSetting.upsert({
      where: { platform },
      update: { ...data, updatedAt: new Date() },
      create: { platform, ...data },
    });
  }

  async upsertMany(items: { key: string; value: string }[]) {
    const results = [];
    for (const item of items) {
      const def = SETTING_DEFINITIONS.find((d) => d.key === item.key);
      const result = await this.prisma.setting.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: {
          key: item.key,
          value: item.value,
          label: def?.label || item.key,
          group: def?.group || 'otros',
          hint: def?.hint,
          sensitive: def?.sensitive || false,
        },
      });
      results.push(result);
    }
    return results;
  }
}
