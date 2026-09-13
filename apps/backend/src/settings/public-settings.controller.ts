import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

// Sin guard a propósito: el logo/nombre/descripción personalizados de cada plataforma
// (Mercado Libre, Shopify, OpenFactura, etc.) también deben verse en el login y en la
// landing pública, antes de iniciar sesión. No expone nada sensible.
@Controller('public/platform-logos')
export class PublicSettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  getPlatformLogos() {
    return this.service.getPlatformSettings();
  }
}

// Sin guard a propósito: todos los roles necesitan saber en qué huso horario está
// expresado "hoy" en el dashboard/despacho para mostrar horas coherentes, no solo
// quien puede editarlo (eso sigue restringido a Super Admin en SettingsController).
@Controller('public/timezone')
export class PublicTimezoneController {
  constructor(private service: SettingsService) {}

  @Get()
  async getTimezone() {
    return { timezone: await this.service.getTimezone() };
  }
}

// Sin guard a propósito: cualquier rol con la campanita de notificaciones abierta debe
// poder reproducir el sonido elegido por Super Admin para cada tipo de evento, no solo
// quien puede subir/elegir sonidos (eso sigue restringido a Super Admin).
@Controller('public/notification-sounds')
export class PublicNotificationSoundsController {
  constructor(private service: SettingsService) {}

  @Get()
  getSoundMap() {
    return this.service.getNotificationSoundMap();
  }
}
