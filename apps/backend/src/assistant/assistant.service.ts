import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AiProvidersService } from '../ai/ai-providers.service';
import { assertIntegrationsEnabled } from '../common/integrations.util';
import { hasPermission, permissionsForUser } from '../common/permissions';
import { matchesModule } from '../common/modules.util';
import { dateKeyStringInTz } from '../common/timezone';
import { buildAssistantTools } from './assistant-tools';

// Módulo por empresa (Empresas → Módulos) y permiso de página.
export const ASSISTANT_MODULE = 'asistente_ia';
export const ASSISTANT_PERMISSION = 'assistant';

// Consultas por empresa al mes si el Super Admin no definió otro valor (AI_ASSISTANT_MONTHLY_LIMIT).
const DEFAULT_MONTHLY_LIMIT = 300;
// Vueltas de herramientas por pregunta y preguntas por conversación (luego se pide una nueva).
const MAX_TOOL_ROUNDS = 6;
const MAX_TURNS = 30;
// Modelos que aceptan el respaldo automático del servidor cuando un filtro rechaza la consulta.
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;

// Instrucciones fijas (van primero y se cachean). Los datos variables (fecha, empresa) van aparte.
const SYSTEM_PROMPT = `Eres el asistente virtual de Admin Marketplace, un sistema de gestión para empresas chilenas que venden en tienda física y en marketplaces (Mercado Libre, Falabella, Paris, Ripley, Walmart y tiendas online).

Respondes consultas del equipo de la empresa usando SOLO las herramientas disponibles, que leen los datos reales de su empresa:
- Antes de responder sobre ventas, stock, órdenes, fabricación, deudores, caja o Mercado Libre, consulta la herramienta que corresponda. No inventes cifras ni supongas datos que no vinieron de una herramienta.
- Interpreta las fechas relativas («hoy», «ayer», «esta semana», «este mes», «el mes pasado») con la fecha actual que se indica abajo. La semana parte el lunes.
- Si no tienes una herramienta para lo que te piden (porque no existe o porque el usuario no tiene permiso o la empresa no tiene ese módulo), dilo en una frase y sugiere dónde verlo en el sistema. No puedes modificar nada: solo consultas.
- Responde en español de Chile, breve y directo: primero el dato que pidieron y luego, si aporta, un par de detalles. Montos en pesos chilenos con separador de miles (ej.: $1.250.000). Usa listas cortas con guiones cuando haya varios elementos; no uses tablas ni encabezados.
- Si la pregunta es ambigua, elige la interpretación más útil, dila en una frase y responde.`;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private ai: AiProvidersService,
  ) {}

  // ── Acceso ───────────────────────────────────────────────────────────

  private async access(user: any, companyIdParam?: string) {
    const companyId = user.role === 'SUPER_ADMIN' ? companyIdParam : user.companyId;
    if (!companyId) throw new BadRequestException('Selecciona una empresa');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, modules: true } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (!matchesModule(company.modules, ASSISTANT_MODULE)) throw new ForbiddenException('La empresa no tiene el asistente con IA');
    if (user.role !== 'SUPER_ADMIN' && !hasPermission(permissionsForUser(user), ASSISTANT_PERMISSION)) {
      throw new ForbiddenException('No tienes permiso para usar el asistente');
    }
    return company;
  }

  private async monthlyLimit() {
    const raw = Number(await this.settings.get('AI_ASSISTANT_MONTHLY_LIMIT').catch(() => ''));
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_MONTHLY_LIMIT;
  }

  private async usedThisMonth(companyId: string) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    return this.prisma.assistantMessage.count({ where: { companyId, role: 'user', createdAt: { gte: start } } });
  }

  async status(user: any, companyId?: string) {
    const company = await this.access(user, companyId);
    const [limit, used] = await Promise.all([this.monthlyLimit(), this.usedThisMonth(company.id)]);
    return { enabled: true, limit, used, remaining: Math.max(0, limit - used) };
  }

  // ── Conversaciones ───────────────────────────────────────────────────

  async listConversations(user: any, companyId?: string) {
    const company = await this.access(user, companyId);
    return this.prisma.assistantConversation.findMany({
      where: { companyId: company.id, userId: user.id },
      orderBy: { updatedAt: 'desc' }, take: 20,
      select: { id: true, title: true, turns: true, updatedAt: true },
    });
  }

  async getConversation(user: any, id: string) {
    const conv = await this.prisma.assistantConversation.findUnique({
      where: { id },
      select: { id: true, title: true, turns: true, userId: true, companyId: true, messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, text: true, viaVoice: true, createdAt: true } } },
    });
    if (!conv || conv.userId !== user.id) throw new NotFoundException('Conversación no encontrada');
    return { id: conv.id, title: conv.title, turns: conv.turns, maxTurns: MAX_TURNS, messages: conv.messages };
  }

  async deleteConversation(user: any, id: string) {
    const conv = await this.prisma.assistantConversation.findUnique({ where: { id }, select: { userId: true } });
    if (!conv || conv.userId !== user.id) throw new NotFoundException('Conversación no encontrada');
    await this.prisma.assistantConversation.delete({ where: { id } });
    return { ok: true };
  }

  // ── Preguntar ────────────────────────────────────────────────────────

  async ask(user: any, dto: { companyId?: string; conversationId?: string; text: string; viaVoice?: boolean }) {
    assertIntegrationsEnabled();
    const company = await this.access(user, dto.companyId);
    const text = String(dto.text || '').trim().slice(0, 2000);
    if (!text) throw new BadRequestException('Escribe tu pregunta');
    const [limit, used] = await Promise.all([this.monthlyLimit(), this.usedThisMonth(company.id)]);
    if (used >= limit) throw new BadRequestException(`La empresa usó las ${limit} consultas del asistente de este mes`);

    let conv = dto.conversationId
      ? await this.prisma.assistantConversation.findUnique({ where: { id: dto.conversationId } })
      : null;
    if (dto.conversationId && (!conv || conv.userId !== user.id || conv.companyId !== company.id)) throw new NotFoundException('Conversación no encontrada');
    if (conv && conv.turns >= MAX_TURNS) throw new BadRequestException('Esta conversación llegó a su límite. Inicia una nueva.');
    if (!conv) {
      conv = await this.prisma.assistantConversation.create({
        data: { companyId: company.id, userId: user.id, title: text.slice(0, 80), apiMessages: [] },
      });
    }

    const { key, model } = await this.ai.credentialsFor('ASSISTANT');
    const client = new Anthropic({ apiKey: key });
    const tz = await this.settings.getTimezone();
    const tools = buildAssistantTools({ prisma: this.prisma, companyId: company.id, user, modules: company.modules, tz });
    const byName = new Map(tools.map((t) => [t.def.name, t]));

    // Historial solo hacia el final: se reenvía tal cual (con sus bloques de pensamiento y de
    // herramientas) y se le agrega lo nuevo. Editar turnos anteriores invalidaría el razonamiento.
    const messages = (Array.isArray(conv.apiMessages) ? conv.apiMessages : []) as unknown as Anthropic.Beta.BetaMessageParam[];
    const today = dateKeyStringInTz(new Date(), tz);
    const weekday = new Date().toLocaleDateString('es-CL', { weekday: 'long', timeZone: tz });
    messages.push({ role: 'user', content: [{ type: 'text', text }] });

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `Empresa: ${company.name}. Usuario: ${user.name ?? user.email}. Fecha actual: ${weekday} ${today} (zona horaria ${tz}).` },
    ];

    let reply = '';
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          system,
          tools: tools.map((t) => t.def),
          messages,
          // Chat de consultas: esfuerzo bajo (respuestas rápidas y económicas).
          output_config: { effort: 'low' },
          ...(FALLBACK_MODELS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        });
        inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0);
        outputTokens += response.usage.output_tokens;
        messages.push({ role: 'assistant', content: response.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });

        if (response.stop_reason === 'refusal') {
          reply = 'No puedo responder esa consulta.';
          break;
        }
        const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        const textOut = response.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('').trim();
        if (response.stop_reason !== 'tool_use' || !toolUses.length) {
          reply = textOut || (response.stop_reason === 'max_tokens' ? 'La respuesta quedó muy larga; intenta acotar la pregunta.' : 'No encontré una respuesta para eso.');
          break;
        }
        if (round === MAX_TOOL_ROUNDS) {
          // Se acabaron las vueltas: se cierra el turno con los resultados pendientes.
          messages.push({ role: 'user', content: toolUses.map((t) => ({ type: 'tool_result' as const, tool_use_id: t.id, content: 'Límite de consultas por pregunta alcanzado.', is_error: true })) });
          reply = textOut || 'La consulta necesitó demasiados pasos. Intenta preguntar algo más acotado.';
          break;
        }
        // Todas las herramientas de esta vuelta y sus resultados en un solo mensaje.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(toolUses.map(async (t) => {
          const def = byName.get(t.name);
          if (!def) return { type: 'tool_result' as const, tool_use_id: t.id, content: 'Herramienta no disponible para este usuario.', is_error: true };
          try {
            const out = await def.run(t.input);
            return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(out) };
          } catch (e: any) {
            this.logger.warn(`Asistente ${t.name}: ${e?.message || e}`);
            return { type: 'tool_result' as const, tool_use_id: t.id, content: `No se pudo consultar: ${e?.message || 'error'}`, is_error: true };
          }
        }));
        messages.push({ role: 'user', content: results });
      }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new BadRequestException('La API key de Claude no es válida (Administrador de plataforma → Inteligencia artificial).');
      if (err instanceof Anthropic.RateLimitError) throw new BadRequestException('El asistente está con mucha demanda; intenta en un momento.');
      if (err instanceof Anthropic.APIError) throw new BadRequestException(`Asistente: ${err.message}`);
      throw err;
    }

    await this.prisma.$transaction([
      this.prisma.assistantMessage.create({ data: { conversationId: conv.id, companyId: company.id, userId: user.id, role: 'user', text, viaVoice: !!dto.viaVoice } }),
      this.prisma.assistantMessage.create({ data: { conversationId: conv.id, companyId: company.id, userId: user.id, role: 'assistant', text: reply, inputTokens, outputTokens } }),
      this.prisma.assistantConversation.update({
        where: { id: conv.id },
        data: { apiMessages: messages as unknown as Prisma.InputJsonValue, turns: { increment: 1 } },
      }),
    ]);
    return { conversationId: conv.id, reply, remaining: Math.max(0, limit - used - 1) };
  }

  // ── Notas de voz ─────────────────────────────────────────────────────

  async transcribe(user: any, companyId: string | undefined, file: Express.Multer.File) {
    assertIntegrationsEnabled();
    await this.access(user, companyId);
    if (!file?.buffer?.length) throw new BadRequestException('No se recibió el audio');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('La nota de voz es muy larga (máximo 10 MB)');
    const { providerId, key, model } = await this.ai.credentialsFor('TRANSCRIBE');
    if (providerId !== 'openai') throw new BadRequestException('La transcripción de audio está disponible con OpenAI');
    const form = new FormData();
    const ext = /ogg/.test(file.mimetype) ? 'ogg' : /mp4|m4a|aac/.test(file.mimetype) ? 'm4a' : /mpeg|mp3/.test(file.mimetype) ? 'mp3' : /wav/.test(file.mimetype) ? 'wav' : 'webm';
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'audio/webm' }), `nota.${ext}`);
    form.append('model', model || 'gpt-4o-mini-transcribe');
    form.append('language', 'es');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(`No se pudo transcribir: ${data?.error?.message || res.statusText}`);
    const text = String(data?.text || '').trim();
    if (!text) throw new BadRequestException('No se entendió el audio; intenta de nuevo');
    return { text };
  }
}
