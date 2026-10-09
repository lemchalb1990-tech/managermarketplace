// Catálogo de proveedores de IA que puede usar la plataforma y qué trabajo hace cada uno.
// La API key y los modelos se guardan en la configuración del sistema (grupo "ia"); qué
// proveedor hace cada tarea se guarda en AI_TASK_<TAREA>.

export type AiTask = 'PHOTO_CHECK' | 'PHOTO_FIX' | 'PHOTO_GENERATE';

export const AI_TASKS: Record<AiTask, { label: string; description: string; settingKey: string; defaultProvider: string }> = {
  PHOTO_CHECK: {
    label: 'Revisar fotos',
    description: 'Mira cada foto y el título, y dice si coinciden, qué se ve y qué problemas tiene para Mercado Libre.',
    settingKey: 'AI_TASK_PHOTO_CHECK',
    defaultProvider: 'openai',
  },
  PHOTO_FIX: {
    label: 'Corregir fotos',
    description: 'Deja la foto real del producto con fondo blanco, centrada y sin textos, para que pase la moderación.',
    settingKey: 'AI_TASK_PHOTO_FIX',
    defaultProvider: 'openai',
  },
  PHOTO_GENERATE: {
    label: 'Crear imagen de referencia',
    description: 'Genera una imagen del producto a partir del título, con fondo blanco, para usar de referencia cuando no hay una foto adecuada.',
    settingKey: 'AI_TASK_PHOTO_GENERATE',
    defaultProvider: 'openai',
  },
};

export interface ProviderModelDef { settingKey: string; default: string; label: string; hint: string }

// Datos extra que pide un proveedor además de la API key (p. ej. el ID de cuenta de Cloudflare).
export interface ProviderExtraField { settingKey: string; label: string; hint: string; sensitive: boolean }

export interface ProviderDef {
  id: string;
  name: string;
  company: string;
  description: string;
  keyUrl: string;
  apiKeySetting: string;
  extraFields?: ProviderExtraField[];
  tasks: AiTask[];
  // Notas por tarea que se muestran en el modal (alcance, costo aproximado).
  taskNotes: Partial<Record<AiTask, string>>;
  models: Partial<Record<AiTask, ProviderModelDef>>;
}

export const AI_PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    company: 'OpenAI',
    description: 'Modelos GPT con visión y GPT Image para editar y crear imágenes. Hace todas las tareas.',
    keyUrl: 'https://platform.openai.com/api-keys',
    apiKeySetting: 'OPENAI_API_KEY',
    tasks: ['PHOTO_CHECK', 'PHOTO_FIX', 'PHOTO_GENERATE'],
    taskNotes: {
      PHOTO_CHECK: 'Cobra por tokens; la foto se envía en baja resolución para que cueste poco.',
      PHOTO_FIX: 'Edita la foto real con alta fidelidad: fondo blanco, centrado y quita textos o marcas de agua. Es la opción más cara por foto.',
      PHOTO_GENERATE: 'Crea la imagen solo desde el título: es una representación, no la foto del producto real.',
    },
    models: {
      PHOTO_CHECK: { settingKey: 'OPENAI_VISION_MODEL', default: 'gpt-5-mini', label: 'Modelo para revisar', hint: 'Ej: gpt-5-mini' },
      PHOTO_FIX: { settingKey: 'OPENAI_IMAGE_MODEL', default: 'gpt-image-1.5', label: 'Modelo para corregir', hint: 'Ej: gpt-image-1.5' },
      PHOTO_GENERATE: { settingKey: 'OPENAI_GENERATE_MODEL', default: 'gpt-image-1.5', label: 'Modelo para crear imágenes', hint: 'Ej: gpt-image-1.5' },
    },
  },
  {
    id: 'anthropic',
    name: 'Claude',
    company: 'Anthropic',
    description: 'Modelos Claude con visión. Solo revisa fotos: no genera ni edita imágenes.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    apiKeySetting: 'ANTHROPIC_API_KEY',
    tasks: ['PHOTO_CHECK'],
    taskNotes: {
      PHOTO_CHECK: 'Cobra por tokens (la imagen cuenta como tokens de entrada). claude-haiku-5-5 es la opción más económica.',
    },
    models: {
      PHOTO_CHECK: { settingKey: 'ANTHROPIC_VISION_MODEL', default: 'claude-opus-5-5', label: 'Modelo para revisar', hint: 'Ej: claude-opus-5-5 o claude-haiku-5-5' },
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    company: 'Google',
    description: 'Modelos Gemini con visión y la familia de imágenes Nano Banana para editar y crear. Hace todas las tareas.',
    keyUrl: 'https://aistudio.google.com/apikey',
    apiKeySetting: 'GEMINI_API_KEY',
    tasks: ['PHOTO_CHECK', 'PHOTO_FIX', 'PHOTO_GENERATE'],
    taskNotes: {
      PHOTO_CHECK: 'Los modelos Flash-Lite son de los más económicos para revisar fotos.',
      PHOTO_FIX: 'Edita la foto con instrucciones (fondo blanco, centrado, sin textos).',
      PHOTO_GENERATE: 'Crea la imagen solo desde el título: es una representación, no la foto del producto real.',
    },
    models: {
      PHOTO_CHECK: { settingKey: 'GEMINI_VISION_MODEL', default: 'gemini-3.1-flash-lite', label: 'Modelo para revisar', hint: 'Ej: gemini-3.1-flash-lite' },
      PHOTO_FIX: { settingKey: 'GEMINI_IMAGE_MODEL', default: 'gemini-3.1-flash-image', label: 'Modelo para corregir', hint: 'Ej: gemini-3.1-flash-image' },
      PHOTO_GENERATE: { settingKey: 'GEMINI_GENERATE_MODEL', default: 'gemini-3.1-flash-image', label: 'Modelo para crear imágenes', hint: 'Ej: gemini-3.1-flash-image' },
    },
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    company: 'Cloudflare',
    description: 'Modelos abiertos en la red de Cloudflare: visión (Llama 3.2 Vision) y creación de imágenes (FLUX.1 schnell). Revisa y crea imágenes; no corrige fotos.',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    apiKeySetting: 'CLOUDFLARE_AI_API_TOKEN',
    extraFields: [
      { settingKey: 'CLOUDFLARE_AI_ACCOUNT_ID', label: 'ID de cuenta de Cloudflare', hint: 'Está en el panel de Cloudflare, en la columna derecha de "Workers & Pages" o en la URL (dash.cloudflare.com/<ID>).', sensitive: false },
    ],
    tasks: ['PHOTO_CHECK', 'PHOTO_GENERATE'],
    taskNotes: {
      PHOTO_CHECK: 'Cobra por "neurons" de Workers AI (incluye una cuota gratis diaria). La primera vez acepta solo la licencia de Meta del modelo.',
      PHOTO_GENERATE: 'FLUX.1 schnell crea la imagen desde el título y la descripción; rápida y económica.',
    },
    models: {
      PHOTO_CHECK: { settingKey: 'CLOUDFLARE_VISION_MODEL', default: '@cf/meta/llama-3.2-11b-vision-instruct', label: 'Modelo para revisar', hint: 'Ej: @cf/meta/llama-3.2-11b-vision-instruct' },
      PHOTO_GENERATE: { settingKey: 'CLOUDFLARE_GENERATE_MODEL', default: '@cf/black-forest-labs/flux-1-schnell', label: 'Modelo para crear imágenes', hint: 'Ej: @cf/black-forest-labs/flux-1-schnell' },
    },
  },
  {
    id: 'bfl',
    name: 'FLUX (Black Forest Labs)',
    company: 'Black Forest Labs',
    description: 'Modelos FLUX para imágenes: Kontext edita la foto real conservando el producto y FLUX.2 crea imágenes de alta calidad. Corrige y crea; no revisa fotos.',
    keyUrl: 'https://dashboard.bfl.ai/',
    apiKeySetting: 'BFL_API_KEY',
    tasks: ['PHOTO_FIX', 'PHOTO_GENERATE'],
    taskNotes: {
      PHOTO_FIX: 'FLUX Kontext edita la foto con instrucciones (fondo blanco, centrado, sin textos) manteniendo el producto. Cobra por imagen.',
      PHOTO_GENERATE: 'FLUX.2 crea la imagen desde el título y la descripción. Cobra por imagen.',
    },
    models: {
      PHOTO_FIX: { settingKey: 'BFL_FIX_MODEL', default: 'flux-kontext-pro', label: 'Modelo para corregir', hint: 'Ej: flux-kontext-pro' },
      PHOTO_GENERATE: { settingKey: 'BFL_GENERATE_MODEL', default: 'flux-2-pro', label: 'Modelo para crear imágenes', hint: 'Ej: flux-2-pro' },
    },
  },
  {
    id: 'photoroom',
    name: 'Photoroom',
    company: 'Photoroom',
    description: 'Especializada en fotos de producto para e-commerce: quita el fondo y lo deja blanco con margen.',
    keyUrl: 'https://app.photoroom.com/api-dashboard',
    apiKeySetting: 'PHOTOROOM_API_KEY',
    tasks: ['PHOTO_FIX'],
    taskNotes: {
      PHOTO_FIX: 'Cambia el fondo a blanco y agrega margen. No quita textos ni marcas de agua puestos sobre el producto. Cobra por imagen.',
    },
    models: {},
  },
  {
    id: 'removebg',
    name: 'remove.bg',
    company: 'Kaleido (Canva)',
    description: 'Quita el fondo de la foto y lo reemplaza por blanco.',
    keyUrl: 'https://www.remove.bg/dashboard#api-key',
    apiKeySetting: 'REMOVEBG_API_KEY',
    tasks: ['PHOTO_FIX'],
    taskNotes: {
      PHOTO_FIX: 'Solo cambia el fondo a blanco: no centra el producto ni quita textos o marcas de agua. Cobra por crédito de imagen.',
    },
    models: {},
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

// Definiciones de configuración que necesita la IA (se agregan a SETTING_DEFINITIONS).
export function aiSettingDefinitions() {
  const defs: { key: string; label: string; group: string; hint: string; sensitive: boolean; default?: string }[] = [];
  for (const p of AI_PROVIDERS) {
    defs.push({ key: p.apiKeySetting, label: `API Key de ${p.name}`, group: 'ia', hint: `Se obtiene en ${p.keyUrl}`, sensitive: true });
    for (const f of p.extraFields || []) defs.push({ key: f.settingKey, label: `${p.name}: ${f.label}`, group: 'ia', hint: f.hint, sensitive: f.sensitive });
    for (const m of Object.values(p.models)) {
      if (m) defs.push({ key: m.settingKey, label: `${p.name}: ${m.label}`, group: 'ia', hint: m.hint, sensitive: false, default: m.default });
    }
  }
  for (const t of Object.values(AI_TASKS)) {
    defs.push({ key: t.settingKey, label: `Proveedor para ${t.label.toLowerCase()}`, group: 'ia', hint: 'Id del proveedor de IA asignado a esta tarea.', sensitive: false, default: t.defaultProvider });
  }
  return defs;
}
