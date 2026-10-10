import { Injectable, OnModuleInit } from '@nestjs/common';
import { aiSettingDefinitions } from '../ai/providers/catalog';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TIMEZONE } from '../common/timezone';

export const SETTING_DEFINITIONS: { key: string; label: string; group: string; hint: string; sensitive: boolean; default?: string }[] = [
  {
    key: 'TITLE_MAX_PARIS',
    label: 'Largo máximo del nombre en Paris',
    group: 'publicacion',
    hint: 'Caracteres que admite Paris en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '',
  },
  {
    key: 'TITLE_MAX_RIPLEY',
    label: 'Largo máximo del nombre en Ripley',
    group: 'publicacion',
    hint: 'Caracteres que admite Ripley en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '',
  },
  {
    key: 'TITLE_MAX_FALABELLA',
    label: 'Largo máximo del nombre en Falabella',
    group: 'publicacion',
    hint: 'Caracteres que admite Falabella en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '',
  },
  {
    key: 'TITLE_MAX_WALMART',
    label: 'Largo máximo del nombre en Walmart',
    group: 'publicacion',
    hint: 'Caracteres que admite Walmart en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '200',
  },
  {
    key: 'TITLE_MAX_HITES',
    label: 'Largo máximo del nombre en Hites',
    group: 'publicacion',
    hint: 'Caracteres que admite Hites en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '',
  },
  {
    key: 'TITLE_MAX_JUMPSELLER',
    label: 'Largo máximo del nombre en JumpSeller',
    group: 'publicacion',
    hint: 'Caracteres que admite JumpSeller en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '',
  },
  {
    key: 'TITLE_MAX_SHOPIFY',
    label: 'Largo máximo del nombre en Shopify',
    group: 'publicacion',
    hint: 'Caracteres que admite Shopify en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '255',
  },
  {
    key: 'TITLE_MAX_WOOCOMMERCE',
    label: 'Largo máximo del nombre en WooCommerce',
    group: 'publicacion',
    hint: 'Caracteres que admite WooCommerce en el nombre del producto. Vacío = solo se cuenta, sin validar.',
    sensitive: false,
    default: '',
  },
  {
    key: 'APP_URL',
    label: 'URL del backend',
    group: 'sistema',
    hint: 'URL pública del backend, usada para construir URLs absolutas de imágenes. Ej: https://api.tudominio.com',
    sensitive: false,
  },
  {
    key: 'ACTIVITY_RETENTION_MONTHS',
    label: 'Meses que se conserva el historial de actividad',
    group: 'sistema',
    hint: 'Los registros del historial de actividad más antiguos que este plazo se borran solos cada noche. Por defecto 12.',
    sensitive: false,
  },
  {
    key: 'DASHBOARD_TIMEZONE',
    label: 'Horario del dashboard',
    group: 'sistema',
    hint: 'Zona horaria usada para calcular "hoy" en el dashboard, tablero de despacho, entregas de repartidores y cutoff de transportistas. Solo Super Admin puede cambiarla.',
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
    key: 'ML_DEFAULT_CATEGORY',
    label: 'Categoría ML por defecto',
    group: 'mercadolibre',
    hint: 'ID de categoría de Mercado Libre usada cuando el producto no tiene una asignada. Ej: MLC1000',
    sensitive: false,
  },
  {
    key: 'GOOGLE_MAPS_KEY',
    label: 'API Key de Google Maps',
    group: 'sistema',
    hint: 'Necesaria para el mapa de "Zonas de demanda". Se obtiene en Google Cloud Console (Maps JavaScript API).',
    sensitive: true,
  },
  // API keys, modelos y tarea asignada de cada proveedor de IA (ver ai/providers/catalog.ts).
  ...aiSettingDefinitions(),
  {
    key: 'AI_CREDITS_PHOTO_CHECK',
    label: 'Créditos por foto revisada',
    group: 'ia',
    hint: 'Créditos del plan de IA que descuenta revisar una foto.',
    sensitive: false,
    default: '1',
  },
  {
    key: 'AI_CREDITS_PHOTO_GENERATE',
    label: 'Créditos por imagen de referencia creada',
    group: 'ia',
    hint: 'Créditos del plan de IA que descuenta crear una imagen de referencia desde el título.',
    sensitive: false,
    default: '5',
  },
  {
    key: 'AI_CREDITS_PHOTO_FIX',
    label: 'Créditos por foto corregida',
    group: 'ia',
    hint: 'Créditos del plan de IA que descuenta corregir una foto (editar imágenes cuesta más que revisarlas).',
    sensitive: false,
    default: '5',
  },
  {
    key: 'NOTIF_SOUND_SALE',
    label: 'Sonido — Nueva venta',
    group: 'notificaciones',
    hint: 'Sonido de la biblioteca que suena al llegar una venta nueva. Vacío = beep por defecto.',
    sensitive: false,
  },
  {
    key: 'NOTIF_SOUND_QUESTION',
    label: 'Sonido — Nueva pregunta',
    group: 'notificaciones',
    hint: 'Sonido de la biblioteca que suena al llegar una pregunta nueva de Mercado Libre. Vacío = beep por defecto.',
    sensitive: false,
  },
  {
    key: 'NOTIF_SOUND_CLAIM',
    label: 'Sonido — Nuevo reclamo',
    group: 'notificaciones',
    hint: 'Sonido de la biblioteca que suena al llegar un reclamo o devolución nuevo. Vacío = beep por defecto.',
    sensitive: false,
  },
];

export const NOTIF_SOUND_SETTING_KEYS = {
  sale: 'NOTIF_SOUND_SALE',
  question: 'NOTIF_SOUND_QUESTION',
  claim: 'NOTIF_SOUND_CLAIM',
} as const;

const SENSITIVE_MASK = '••••••••';

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    // ML_REDIRECT_URI ya no es editable: se deriva de APP_URL + /api/ecommerce/ml/callback
    await this.prisma.setting.deleteMany({ where: { key: 'ML_REDIRECT_URI' } });

    // Inicializar settings con valores de env si no existen en BD
    for (const def of SETTING_DEFINITIONS) {
      const exists = await this.prisma.setting.findUnique({ where: { key: def.key } });
      if (!exists) {
        const envValue = this.config.get<string>(def.key) || (def.key === 'DASHBOARD_TIMEZONE' ? DEFAULT_TIMEZONE : '') || def.default || '';
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
      value: r.sensitive ? (r.value ? SENSITIVE_MASK : '') : r.value,
    }));
  }

  async get(key: string): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value || this.config.get<string>(key) || '';
  }

  /** Zona horaria configurada por el Super Admin para "hoy" en dashboard/despacho/entregas. */
  async getTimezone(): Promise<string> {
    return (await this.get('DASHBOARD_TIMEZONE')) || DEFAULT_TIMEZONE;
  }

  async getPlatformSettings() {
    return this.prisma.platformSetting.findMany({ orderBy: { platform: 'asc' } });
  }

  async upsertPlatformSetting(platform: string, input: { displayName?: string; description?: string; logoUrl?: string; logoScale?: number; logoScales?: Record<string, number> }) {
    const { logoScales, ...rest } = input;
    const data: Record<string, unknown> = { ...rest };
    if (logoScales !== undefined) {
      // Solo vistas conocidas y valores dentro del rango que permite el editor.
      const clean: Record<string, number> = {};
      for (const view of ['panel', 'circle', 'strip', 'login', 'icon']) {
        const v = Number(logoScales?.[view]);
        if (Number.isFinite(v)) clean[view] = Math.min(250, Math.max(30, Math.round(v)));
      }
      data.logoScales = clean;
    }
    return this.prisma.platformSetting.upsert({
      where: { platform },
      update: { ...data, updatedAt: new Date() },
      create: { platform, ...data },
    });
  }

  async listNotificationSounds() {
    return this.prisma.notificationSound.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async addNotificationSound(name: string, url: string) {
    return this.prisma.notificationSound.create({ data: { name, url } });
  }

  async removeNotificationSound(id: string) {
    // Si el sonido eliminado estaba elegido para algún tipo de evento, ese tipo vuelve
    // a usar el beep por defecto en vez de quedar apuntando a un id inexistente.
    const keys = Object.values(NOTIF_SOUND_SETTING_KEYS);
    await this.prisma.setting.updateMany({ where: { key: { in: keys }, value: id }, data: { value: '' } });
    return this.prisma.notificationSound.delete({ where: { id } });
  }

  /** Sonido elegido (o null = beep por defecto) para cada tipo de evento, para el endpoint público. */
  async getNotificationSoundMap(): Promise<Record<'sale' | 'question' | 'claim', string | null>> {
    const [saleId, questionId, claimId] = await Promise.all([
      this.get(NOTIF_SOUND_SETTING_KEYS.sale),
      this.get(NOTIF_SOUND_SETTING_KEYS.question),
      this.get(NOTIF_SOUND_SETTING_KEYS.claim),
    ]);
    const ids = [saleId, questionId, claimId].filter(Boolean);
    const sounds = ids.length
      ? await this.prisma.notificationSound.findMany({ where: { id: { in: ids } } })
      : [];
    const urlById = new Map(sounds.map((s) => [s.id, s.url]));
    return {
      sale: urlById.get(saleId) ?? null,
      question: urlById.get(questionId) ?? null,
      claim: urlById.get(claimId) ?? null,
    };
  }

  async upsertMany(items: { key: string; value: string }[]) {
    const results = [];
    for (const item of items) {
      const def = SETTING_DEFINITIONS.find((d) => d.key === item.key);
      // Los secretos se leen enmascarados: si vuelve la máscara, no se cambió y no se pisa.
      if (def?.sensitive && item.value === SENSITIVE_MASK) continue;
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
