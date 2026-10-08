import { BadRequestException, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  type ImageData, type PhotoCheckContext, type PhotoVerdict,
  VERDICT_SCHEMA, checkPrompt, checkPromptWithJson, fixPrompt, generatePrompt, parseVerdict, extFor,
} from './photo-prompts';

const logger = new Logger('AiProviders');

export interface ProviderAdapter {
  check?(key: string, model: string, image: ImageData, ctx: PhotoCheckContext): Promise<PhotoVerdict>;
  fix?(key: string, model: string, image: ImageData, title: string): Promise<ImageData>;
  /** Crea una imagen de referencia solo desde el título. */
  generate?(key: string, model: string, title: string): Promise<ImageData>;
  /** Verifica la API key con una llamada que no gasta créditos. */
  test(key: string): Promise<void>;
}

function fail(provider: string, msg: string): never {
  throw new BadRequestException(`${provider}: ${msg}`);
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

function badVerdict(provider: string): never {
  return fail(provider, 'devolvió una respuesta que no se pudo leer. Intenta de nuevo.');
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

const OPENAI_API = 'https://api.openai.com/v1';

const openai: ProviderAdapter = {
  async check(key, model, image, ctx) {
    const res = await fetch(`${OPENAI_API}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: checkPrompt(ctx) },
            { type: 'input_image', image_url: `data:${image.mime};base64,${image.bytes.toString('base64')}`, detail: 'low' },
          ],
        }],
        text: { format: { type: 'json_schema', name: 'photo_check', strict: true, schema: VERDICT_SCHEMA } },
      }),
    });
    const data = await readJson(res);
    if (!res.ok) fail('OpenAI', data?.error?.message || `error ${res.status}`);
    const text = (data.output || []).flatMap((o: any) => o.content || []).find((c: any) => c.type === 'output_text')?.text;
    return parseVerdict(text) ?? badVerdict('OpenAI');
  },

  async fix(key, model, image, title) {
    const params: Record<string, string> = {
      model, prompt: fixPrompt(title), size: '1024x1024', quality: 'medium',
      input_fidelity: 'high', background: 'opaque', output_format: 'jpeg',
    };
    // Parámetros opcionales que algunos modelos no aceptan: si OpenAI reclama por uno, se
    // reintenta sin él en vez de fallar.
    for (let attempt = 0; attempt < 5; attempt++) {
      const form = new FormData();
      Object.entries(params).forEach(([k, v]) => form.append(k, v));
      form.append('image', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `foto.${extFor(image.mime)}`);
      const res = await fetch(`${OPENAI_API}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
      const data = await readJson(res);
      if (res.ok) {
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) fail('OpenAI', 'no devolvió la imagen corregida.');
        return { bytes: Buffer.from(b64, 'base64'), mime: params.output_format === 'jpeg' ? 'image/jpeg' : 'image/png' };
      }
      const msg: string = data?.error?.message || '';
      const bad = ['input_fidelity', 'background', 'output_format', 'quality'].find((p) => params[p] && (data?.error?.param === p || msg.includes(p)));
      if (!bad) fail('OpenAI', msg || `error ${res.status}`);
      logger.warn(`OpenAI ${model} no acepta "${bad}"; se reintenta sin él`);
      delete params[bad];
    }
    return fail('OpenAI', 'no pudo corregir la foto.');
  },

  async generate(key, model, title) {
    const params: Record<string, string> = {
      model, prompt: generatePrompt(title), size: '1024x1024', quality: 'medium', background: 'opaque', output_format: 'jpeg',
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${OPENAI_API}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, n: 1 }),
      });
      const data = await readJson(res);
      if (res.ok) {
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) fail('OpenAI', 'no devolvió la imagen.');
        return { bytes: Buffer.from(b64, 'base64'), mime: params.output_format === 'jpeg' ? 'image/jpeg' : 'image/png' };
      }
      const msg: string = data?.error?.message || '';
      const bad = ['background', 'output_format', 'quality'].find((p) => params[p] && (data?.error?.param === p || msg.includes(p)));
      if (!bad) fail('OpenAI', msg || `error ${res.status}`);
      delete params[bad];
    }
    return fail('OpenAI', 'no pudo crear la imagen.');
  },

  async test(key) {
    const res = await fetch(`${OPENAI_API}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) fail('OpenAI', (await readJson(res))?.error?.message || `error ${res.status}`);
  },
};

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

// Modelos que aceptan el respaldo automático del servidor cuando un filtro rechaza la consulta.
const CLAUDE_FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
const CLAUDE_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

const anthropic: ProviderAdapter = {
  async check(key, model, image, ctx) {
    const media = CLAUDE_MEDIA.find((m) => m === image.mime);
    if (!media) fail('Claude', `no acepta imágenes ${image.mime}; usa JPG, PNG o WebP.`);
    const client = new Anthropic({ apiKey: key });
    const useFallback = CLAUDE_FALLBACK_MODELS.test(model);
    try {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 4000,
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        // Tarea simple de clasificación: esfuerzo bajo (menos tokens) — no aplica a Haiku 4.5.
        ...(/haiku-4/.test(model) ? {} : { output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: VERDICT_SCHEMA as any } } }),
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: image.bytes.toString('base64') } },
            { type: 'text', text: /haiku-4/.test(model) ? checkPromptWithJson(ctx) : checkPrompt(ctx) },
          ],
        }],
      });
      if (response.stop_reason === 'refusal') fail('Claude', 'rechazó revisar esta foto.');
      const text = response.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('');
      return parseVerdict(text) ?? badVerdict('Claude');
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof Anthropic.AuthenticationError) fail('Claude', 'la API key no es válida.');
      if (err instanceof Anthropic.RateLimitError) fail('Claude', 'límite de uso alcanzado; intenta en un momento.');
      if (err instanceof Anthropic.APIError) fail('Claude', err.message);
      throw err;
    }
  },

  async test(key) {
    try {
      await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) fail('Claude', 'la API key no es válida.');
      if (err instanceof Anthropic.APIError) fail('Claude', err.message);
      throw err;
    }
  },
};

// ── Google Gemini ─────────────────────────────────────────────────────────────

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

async function geminiGenerate(key: string, model: string, body: unknown) {
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) fail('Gemini', data?.error?.message || `error ${res.status}`);
  return (data?.candidates?.[0]?.content?.parts || []) as any[];
}

const gemini: ProviderAdapter = {
  async check(key, model, image, ctx) {
    const parts = await geminiGenerate(key, model, {
      contents: [{ role: 'user', parts: [
        { text: checkPromptWithJson(ctx) },
        { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } },
      ] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    return parseVerdict(parts.map((p) => p.text || '').join('')) ?? badVerdict('Gemini');
  },

  async fix(key, model, image, title) {
    const parts = await geminiGenerate(key, model, {
      contents: [{ role: 'user', parts: [
        { text: fixPrompt(title) },
        { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } },
      ] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const inline = img?.inlineData || img?.inline_data;
    if (!inline) fail('Gemini', 'no devolvió una imagen. Revisa que el modelo configurado edite imágenes.');
    return { bytes: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || inline.mime_type || 'image/png' };
  },

  async generate(key, model, title) {
    const parts = await geminiGenerate(key, model, {
      contents: [{ role: 'user', parts: [{ text: generatePrompt(title) }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const inline = img?.inlineData || img?.inline_data;
    if (!inline) fail('Gemini', 'no devolvió una imagen. Revisa que el modelo configurado cree imágenes.');
    return { bytes: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || inline.mime_type || 'image/png' };
  },

  async test(key) {
    const res = await fetch(`${GEMINI_API}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) fail('Gemini', (await readJson(res))?.error?.message || `error ${res.status}`);
  },
};

// ── Photoroom ─────────────────────────────────────────────────────────────────

const photoroom: ProviderAdapter = {
  async fix(key, _model, image) {
    const form = new FormData();
    form.append('imageFile', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `foto.${extFor(image.mime)}`);
    form.append('background.color', 'FFFFFF');
    form.append('padding', '10%');
    const res = await fetch('https://image-api.photoroom.com/v2/edit', { method: 'POST', headers: { 'x-api-key': key }, body: form });
    if (!res.ok) {
      const data = await readJson(res);
      fail('Photoroom', data?.detail || data?.message || data?.error?.message || `error ${res.status}`);
    }
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] || 'image/png' };
  },

  async test(key) {
    const res = await fetch('https://image-api.photoroom.com/v1/account', { headers: { 'x-api-key': key } });
    if (res.status === 401 || res.status === 403) fail('Photoroom', 'la API key no es válida.');
    if (!res.ok) fail('Photoroom', `no se pudo verificar la API key (${res.status}). Prueba corrigiendo una foto.`);
  },
};

// ── remove.bg ─────────────────────────────────────────────────────────────────

const removebg: ProviderAdapter = {
  async fix(key, _model, image) {
    const form = new FormData();
    form.append('image_file', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `foto.${extFor(image.mime)}`);
    form.append('size', 'auto');
    form.append('bg_color', 'FFFFFF');
    form.append('format', 'jpg');
    const res = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form });
    if (!res.ok) {
      const data = await readJson(res);
      fail('remove.bg', data?.errors?.[0]?.title || `error ${res.status}`);
    }
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
  },

  async test(key) {
    const res = await fetch('https://api.remove.bg/v1.0/account', { headers: { 'X-Api-Key': key } });
    if (res.status === 401 || res.status === 403) fail('remove.bg', 'la API key no es válida.');
    if (!res.ok) fail('remove.bg', `no se pudo verificar la API key (${res.status}).`);
  },
};

export const ADAPTERS: Record<string, ProviderAdapter> = { openai, anthropic, gemini, photoroom, removebg };
