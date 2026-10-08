// Catálogo de proveedores de IA que puede usar la plataforma y qué trabajo hace cada uno.
// La API key y los modelos se guardan en la configuración del sistema (grupo "ia"); qué
// proveedor hace cada tarea se guarda en AI_TASK_<TAREA>.

export type AiTask = 'PHOTO_CHECK' | 'PHOTO_FIX';

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
};

export interface ProviderModelDef { settingKey: string; default: string; label: string; hint: string }

export interface ProviderDef {
  id: string;
  name: string;
  company: string;
  description: string;
  keyUrl: string;
  apiKeySetting: string;
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
    description: 'Modelos GPT con visión y el editor de imágenes GPT Image. Hace las dos tareas.',
    keyUrl: 'https://platform.openai.com/api-keys',
    apiKeySetting: 'OPENAI_API_KEY',
    tasks: ['PHOTO_CHECK', 'PHOTO_FIX'],
    taskNotes: {
      PHOTO_CHECK: 'Cobra por tokens; la foto se envía en baja resolución para que cueste poco.',
      PHOTO_FIX: 'Edita la foto real con alta fidelidad: fondo blanco, centrado y quita textos o marcas de agua. Es la opción más cara por foto.',
    },
    models: {
      PHOTO_CHECK: { settingKey: 'OPENAI_VISION_MODEL', default: 'gpt-5-mini', label: 'Modelo para revisar', hint: 'Ej: gpt-5-mini' },
      PHOTO_FIX: { settingKey: 'OPENAI_IMAGE_MODEL', default: 'gpt-image-1.5', label: 'Modelo para corregir', hint: 'Ej: gpt-image-1.5' },
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
    description: 'Modelos Gemini con visión y la familia de edición de imágenes Nano Banana. Hace las dos tareas.',
    keyUrl: 'https://aistudio.google.com/apikey',
    apiKeySetting: 'GEMINI_API_KEY',
    tasks: ['PHOTO_CHECK', 'PHOTO_FIX'],
    taskNotes: {
      PHOTO_CHECK: 'Los modelos Flash-Lite son de los más económicos para revisar fotos.',
      PHOTO_FIX: 'Edita la foto con instrucciones (fondo blanco, centrado, sin textos).',
    },
    models: {
      PHOTO_CHECK: { settingKey: 'GEMINI_VISION_MODEL', default: 'gemini-3.1-flash-lite', label: 'Modelo para revisar', hint: 'Ej: gemini-3.1-flash-lite' },
      PHOTO_FIX: { settingKey: 'GEMINI_IMAGE_MODEL', default: 'gemini-3.1-flash-image', label: 'Modelo para corregir', hint: 'Ej: gemini-3.1-flash-image' },
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
    for (const m of Object.values(p.models)) {
      if (m) defs.push({ key: m.settingKey, label: `${p.name}: ${m.label}`, group: 'ia', hint: m.hint, sensitive: false, default: m.default });
    }
  }
  for (const t of Object.values(AI_TASKS)) {
    defs.push({ key: t.settingKey, label: `Proveedor para ${t.label.toLowerCase()}`, group: 'ia', hint: 'Id del proveedor de IA asignado a esta tarea.', sensitive: false, default: t.defaultProvider });
  }
  return defs;
}
