import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

const OPENAI_API = 'https://api.openai.com/v1';

export interface ImageData { bytes: Buffer; mime: string }

export interface PhotoVerdict {
  matches: boolean;
  confidence: 'alta' | 'media' | 'baja';
  shows: string;
  problems: string[];
  suggestion: string;
  suggestedTitle: string;
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches', 'confidence', 'shows', 'problems', 'suggestion', 'suggestedTitle'],
  properties: {
    matches: { type: 'boolean', description: 'true si la foto muestra el producto que describe el título' },
    confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
    shows: { type: 'string', description: 'Qué producto se ve en la foto, en pocas palabras' },
    problems: {
      type: 'array',
      items: { type: 'string' },
      description: 'Problemas para Mercado Libre: producto distinto al título, color o modelo distinto, varios productos, accesorios que el título no menciona, texto/logo/marca de agua agregados, fondo no blanco en la foto principal, foto borrosa o cortada. Vacío si no hay.',
    },
    suggestion: { type: 'string', description: 'Qué hacer para que la foto pase, en una frase. Vacío si está bien.' },
    suggestedTitle: { type: 'string', description: 'Título de máximo 60 caracteres que describe lo que se ve, solo si el título actual no calza. Vacío si calza.' },
  },
};

// Llamadas a OpenAI: revisar si una foto coincide con el título (visión) y corregir la foto
// real (fondo blanco, centrado, sin textos). La API key y los modelos vienen de Configuración.
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);

  constructor(private settings: SettingsService) {}

  private async apiKey(): Promise<string> {
    const key = await this.settings.get('OPENAI_API_KEY');
    if (!key) throw new BadRequestException('Falta configurar la API Key de OpenAI (Administrador de plataforma → Inteligencia artificial).');
    return key;
  }

  async checkPhoto(image: ImageData, ctx: { title: string; category?: string | null; isMain: boolean }): Promise<PhotoVerdict> {
    const key = await this.apiKey();
    const model = (await this.settings.get('OPENAI_VISION_MODEL')) || 'gpt-5-mini';
    const prompt = [
      'Eres revisor de publicaciones de Mercado Libre Chile. Mercado Libre rechaza publicaciones cuando las fotos no coinciden con el título.',
      `Título de la publicación: "${ctx.title}"`,
      ctx.category ? `Categoría: ${ctx.category}` : '',
      ctx.isMain
        ? 'Esta es la FOTO PRINCIPAL: debe mostrar exactamente el producto del título, solo, idealmente con fondo blanco, sin textos, logos agregados ni marcas de agua.'
        : 'Esta es una foto secundaria: puede mostrar detalles, ángulos o el producto en uso, pero debe ser el mismo producto del título, sin textos promocionales ni marcas de agua.',
      'Responde en español. Sé estricto con producto, tipo, color y modelo; no con detalles menores.',
    ].filter(Boolean).join('\n');

    const res = await fetch(`${OPENAI_API}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:${image.mime};base64,${image.bytes.toString('base64')}`, detail: 'low' },
          ],
        }],
        text: { format: { type: 'json_schema', name: 'photo_check', strict: true, schema: VERDICT_SCHEMA } },
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(`OpenAI: ${data?.error?.message || `error ${res.status}`}`);
    const text = (data.output || [])
      .flatMap((o: any) => o.content || [])
      .find((c: any) => c.type === 'output_text')?.text;
    try {
      return JSON.parse(text) as PhotoVerdict;
    } catch {
      this.logger.warn(`Respuesta de visión no válida: ${String(text).slice(0, 300)}`);
      throw new BadRequestException('OpenAI devolvió una respuesta que no se pudo leer. Intenta de nuevo.');
    }
  }

  /** Edita la foto real: fondo blanco, centrada, sin textos. No inventa otro producto. */
  async fixPhoto(image: ImageData, title: string): Promise<ImageData> {
    const key = await this.apiKey();
    const model = (await this.settings.get('OPENAI_IMAGE_MODEL')) || 'gpt-image-1.5';
    const prompt = [
      `Foto de producto para Mercado Libre. Producto: "${title}".`,
      'Mantén EXACTAMENTE el mismo producto de la foto: misma forma, colores, proporciones, materiales y detalles. No lo reemplaces ni lo rediseñes.',
      'Fondo blanco puro (#FFFFFF) y uniforme. Producto centrado, ocupando cerca del 85% del cuadro, completo y sin cortes.',
      'Iluminación de estudio suave y una sombra sutil bajo el producto.',
      'Quita textos, logos agregados, marcas de agua, bordes, marcos, collages y cualquier objeto que no sea el producto.',
      'No agregues objetos, textos ni accesorios nuevos.',
    ].join(' ');
    const params: Record<string, string> = {
      model, prompt, size: '1024x1024', quality: 'medium',
      input_fidelity: 'high', background: 'opaque', output_format: 'jpeg',
    };
    const ext = image.mime.includes('png') ? 'png' : image.mime.includes('webp') ? 'webp' : 'jpg';

    // Parámetros opcionales que algunos modelos no aceptan: si OpenAI reclama por uno, se
    // reintenta sin él en vez de fallar.
    for (let attempt = 0; attempt < 5; attempt++) {
      const form = new FormData();
      Object.entries(params).forEach(([k, v]) => form.append(k, v));
      form.append('image', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `foto.${ext}`);
      const res = await fetch(`${OPENAI_API}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) throw new BadRequestException('OpenAI no devolvió la imagen corregida.');
        return { bytes: Buffer.from(b64, 'base64'), mime: params.output_format === 'jpeg' ? 'image/jpeg' : 'image/png' };
      }
      const msg: string = data?.error?.message || '';
      const bad = ['input_fidelity', 'background', 'output_format', 'quality'].find((p) => params[p] && (data?.error?.param === p || msg.includes(p)));
      if (!bad) throw new BadRequestException(`OpenAI: ${msg || `error ${res.status}`}`);
      this.logger.warn(`OpenAI ${model} no acepta "${bad}"; se reintenta sin él`);
      delete params[bad];
    }
    throw new BadRequestException('OpenAI no pudo corregir la foto.');
  }
}
