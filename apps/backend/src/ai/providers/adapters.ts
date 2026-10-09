import { BadRequestException, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  type ImageData, type PhotoCheckContext, type PhotoVerdict,
  VERDICT_SCHEMA, checkPrompt, checkPromptWithJson, fixPrompt, generatePrompt, parseVerdict, extFor,
} from './photo-prompts';

const logger = new Logger('AiProviders');

// Datos extra del proveedor además de la API key (p. ej. { CLOUDFLARE_AI_ACCOUNT_ID }).
export type ProviderExtra = Record<string, string>;

export interface ProviderAdapter {
  check?(key: string, model: string, image: ImageData, ctx: PhotoCheckContext, extra?: ProviderExtra): Promise<PhotoVerdict>;
  fix?(key: string, model: string, image: ImageData, title: string, extra?: ProviderExtra): Promise<ImageData>;
  /** Crea una imagen de referencia desde el título y la descripción. */
  generate?(key: string, model: string, title: string, description?: string | null, extra?: ProviderExtra): Promise<ImageData>;
  /** Verifica la API key con una llamada que no gasta créditos. */
  test(key: string, extra?: ProviderExtra): Promise<void>;
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

  async generate(key, model, title, description) {
    const params: Record<string, string> = {
      model, prompt: generatePrompt(title, description), size: '1024x1024', quality: 'medium', background: 'opaque', output_format: 'jpeg',
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

  async generate(key, model, title, description) {
    const parts = await geminiGenerate(key, model, {
      contents: [{ role: 'user', parts: [{ text: generatePrompt(title, description) }] }],
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

// ── Cloudflare Workers AI ─────────────────────────────────────────────────────

function cfBase(extra?: ProviderExtra) {
  const account = extra?.CLOUDFLARE_AI_ACCOUNT_ID?.trim();
  if (!account) fail('Cloudflare', 'falta el ID de cuenta de Cloudflare.');
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai`;
}

async function cfRun(key: string, extra: ProviderExtra | undefined, model: string, body: unknown): Promise<any> {
  const res = await fetch(`${cfBase(extra)}/run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Algunos modelos de imagen responden los bytes directo en vez de JSON.
  const type = res.headers.get('content-type') || '';
  if (res.ok && type.startsWith('image/')) return { __image: { bytes: Buffer.from(await res.arrayBuffer()), mime: type.split(';')[0] } };
  const data = await readJson(res);
  if (!res.ok || data?.success === false) {
    const msg = data?.errors?.map((e: any) => e.message).join('; ') || `error ${res.status}`;
    const err: any = new BadRequestException(`Cloudflare: ${msg}`);
    err.cfMessage = msg;
    throw err;
  }
  return data?.result ?? data;
}

const cloudflare: ProviderAdapter = {
  async check(key, model, image, ctx, extra) {
    const body = {
      prompt: checkPromptWithJson(ctx),
      image: Array.from(image.bytes),
      max_tokens: 800,
    };
    let result: any;
    try {
      result = await cfRun(key, extra, model, body);
    } catch (err: any) {
      // Los modelos de Meta piden aceptar su licencia una vez por cuenta.
      if (!/agree|licen/i.test(err?.cfMessage || '')) throw err;
      await cfRun(key, extra, model, { prompt: 'agree' }).catch(() => null);
      result = await cfRun(key, extra, model, body);
    }
    const text = typeof result?.response === 'string' ? result.response : JSON.stringify(result?.response ?? '');
    return parseVerdict(text) ?? badVerdict('Cloudflare');
  },

  async generate(key, model, title, description, extra) {
    const result = await cfRun(key, extra, model, { prompt: generatePrompt(title, description).slice(0, 2048), steps: 6 });
    if (result?.__image) return result.__image;
    const b64 = result?.image;
    if (!b64) fail('Cloudflare', 'no devolvió la imagen.');
    return { bytes: Buffer.from(b64, 'base64'), mime: 'image/jpeg' };
  },

  async test(key, extra) {
    const res = await fetch(`${cfBase(extra)}/models/search?per_page=1`, { headers: { Authorization: `Bearer ${key}` } });
    const data = await readJson(res);
    if (!res.ok || data?.success === false) fail('Cloudflare', data?.errors?.map((e: any) => e.message).join('; ') || `error ${res.status}`);
  },
};

// ── Black Forest Labs (FLUX) ──────────────────────────────────────────────────
// Pedido asíncrono: POST /v1/{modelo} → { id, polling_url }; se consulta polling_url hasta
// status "Ready" y la imagen está en result.sample (URL firmada por 10 minutos).

const BFL_API = 'https://api.bfl.ai/v1';

async function bflRun(key: string, model: string, body: Record<string, unknown>): Promise<ImageData> {
  let payload = { ...body };
  let submit: any = null;
  // Si el modelo no acepta un parámetro opcional, se reintenta sin él.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BFL_API}/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: { 'x-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    submit = await readJson(res);
    if (res.ok) break;
    if (res.status === 402) fail('FLUX', 'la cuenta no tiene créditos.');
    if (res.status === 401 || res.status === 403) fail('FLUX', 'la API key no es válida.');
    const msg = JSON.stringify(submit?.detail ?? submit ?? '');
    const bad = ['output_format', 'aspect_ratio'].find((k) => k in payload && msg.includes(k));
    if (!bad) fail('FLUX', (typeof submit?.detail === 'string' ? submit.detail : msg) || `error ${res.status}`);
    const { [bad]: _omit, ...rest } = payload;
    payload = rest;
  }
  const pollUrl: string = submit?.polling_url || (submit?.id ? `${BFL_API}/get_result?id=${submit.id}` : '');
  if (!pollUrl) fail('FLUX', 'no devolvió el pedido.');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(pollUrl, { headers: { 'x-key': key, accept: 'application/json' } });
    const data = await readJson(res);
    const status = String(data?.status || '');
    if (status === 'Ready') {
      const url = data?.result?.sample;
      if (!url) fail('FLUX', 'no devolvió la imagen.');
      const img = await fetch(url);
      if (!img.ok) fail('FLUX', `no se pudo descargar la imagen (${img.status}).`);
      return { bytes: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
    }
    if (/error|failed|moderated|content/i.test(status)) fail('FLUX', `no pudo crear la imagen (${status}).`);
  }
  return fail('FLUX', 'tardó demasiado en responder. Intenta de nuevo.');
}

const bfl: ProviderAdapter = {
  async fix(key, model, image, title) {
    return bflRun(key, model, {
      prompt: fixPrompt(title),
      input_image: image.bytes.toString('base64'),
      output_format: 'jpeg',
    });
  },

  async generate(key, model, title, description) {
    return bflRun(key, model, { prompt: generatePrompt(title, description), aspect_ratio: '1:1', output_format: 'jpeg' });
  },

  async test(key) {
    const res = await fetch(`${BFL_API}/credits`, { headers: { 'x-key': key, accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) fail('FLUX', 'la API key no es válida.');
    if (!res.ok) fail('FLUX', `no se pudo verificar la API key (${res.status}). Prueba creando una imagen.`);
  },
};

export const ADAPTERS: Record<string, ProviderAdapter> = { openai, anthropic, gemini, cloudflare, bfl, photoroom, removebg };
