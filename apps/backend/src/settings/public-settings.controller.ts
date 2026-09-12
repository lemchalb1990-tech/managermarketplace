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
