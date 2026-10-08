// Instrucciones y formato de respuesta comunes a todos los proveedores de IA.

export interface ImageData { bytes: Buffer; mime: string }

export interface PhotoCheckContext { title: string; isMain: boolean }

export interface PhotoVerdict {
  matches: boolean;
  confidence: 'alta' | 'media' | 'baja';
  shows: string;
  problems: string[];
  suggestion: string;
  suggestedTitle: string;
}

export const VERDICT_SCHEMA = {
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
} as const;

export function checkPrompt(ctx: PhotoCheckContext) {
  return [
    'Eres revisor de publicaciones de Mercado Libre Chile. Mercado Libre rechaza publicaciones cuando las fotos no coinciden con el título.',
    `Título de la publicación: "${ctx.title}"`,
    ctx.isMain
      ? 'Esta es la FOTO PRINCIPAL: debe mostrar exactamente el producto del título, solo, idealmente con fondo blanco, sin textos, logos agregados ni marcas de agua.'
      : 'Esta es una foto secundaria: puede mostrar detalles, ángulos o el producto en uso, pero debe ser el mismo producto del título, sin textos promocionales ni marcas de agua.',
    'Responde en español. Sé estricto con producto, tipo, color y modelo; no con detalles menores.',
  ].join('\n');
}

// Para proveedores sin formato estructurado garantizado: se pide el JSON explícito.
export function checkPromptWithJson(ctx: PhotoCheckContext) {
  return `${checkPrompt(ctx)}\nResponde solo con un objeto JSON con estas claves: matches (boolean), confidence ("alta" | "media" | "baja"), shows (string), problems (arreglo de strings, vacío si no hay), suggestion (string, vacío si está bien), suggestedTitle (string de máximo 60 caracteres, vacío si el título calza).`;
}

export function fixPrompt(title: string) {
  return [
    `Foto de producto para Mercado Libre. Producto: "${title}".`,
    'Mantén EXACTAMENTE el mismo producto de la foto: misma forma, colores, proporciones, materiales y detalles. No lo reemplaces ni lo rediseñes.',
    'Fondo blanco puro (#FFFFFF) y uniforme. Producto centrado, ocupando cerca del 85% del cuadro, completo y sin cortes.',
    'Iluminación de estudio suave y una sombra sutil bajo el producto.',
    'Quita textos, logos agregados, marcas de agua, bordes, marcos, collages y cualquier objeto que no sea el producto.',
    'No agregues objetos, textos ni accesorios nuevos.',
  ].join(' ');
}

/** Lee el veredicto aunque venga envuelto en ```json ... ``` u otro texto. */
export function parseVerdict(text: string | undefined | null): PhotoVerdict | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    if (typeof v.matches !== 'boolean') return null;
    return {
      matches: v.matches,
      confidence: ['alta', 'media', 'baja'].includes(v.confidence) ? v.confidence : 'media',
      shows: String(v.shows ?? ''),
      problems: Array.isArray(v.problems) ? v.problems.map(String) : [],
      suggestion: String(v.suggestion ?? ''),
      suggestedTitle: String(v.suggestedTitle ?? ''),
    };
  } catch {
    return null;
  }
}

export function extFor(mime: string) {
  return mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
}
