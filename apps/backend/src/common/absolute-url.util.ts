import { SettingsService } from '../settings/settings.service';

// Las imágenes propias (ProductImage/ListingImage) se guardan con URL relativa
// ("/api/uploads/xxx.jpg") — un marketplace externo necesita la URL completa para poder
// descargarlas. Mismo criterio que ya usa MercadoLibreService.toAbsolute.
export async function toAbsoluteUrl(settings: SettingsService, url: string): Promise<string> {
  if (url.startsWith('http')) return url;
  const appUrl = await settings.get('APP_URL');
  if (!appUrl) throw new Error('Configura la URL del backend (APP_URL) en Configuración antes de publicar con fotos propias.');
  return `${appUrl}${url}`;
}
