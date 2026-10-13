import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationsEnabled } from '../common/integrations.util';
import { primaryFrontendUrl } from '../common/frontend-url.util';
import { currentRequestUser } from '../common/request-context';
import { EmailLogService } from './email-log.service';
import { COMMON_VARS, PLATFORM_TEMPLATES, PlatformTemplateDef, platformTemplate } from './platform-templates';

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;
const DEFAULT_BRAND = 'AdminMarket';
const DEFAULT_COLOR = '#0075de';

export type TemplateText = { subject: string; title: string; body: string; buttonLabel: string | null };
export type Design = { brand: string; logoUrl: string; color: string; footer: string };

// Variables de un texto: cuáles aparecen y si todas quedaron vacías.
const varsIn = (s: string) => [...s.matchAll(VAR_RE)].map((m) => m[1]);
const fill = (s: string, vars: Record<string, string>, html: boolean) =>
  s.replace(VAR_RE, (_, k) => (html ? esc(vars[k] ?? '') : vars[k] ?? ''));
// Una línea cuyas variables quedan todas vacías se omite (datos opcionales).
const keepLine = (line: string, vars: Record<string, string>) => {
  const used = varsIn(line);
  return !used.length || used.some((k) => (vars[k] ?? '').trim());
};
// **negrita** y *cursiva* sobre el texto ya escapado (las variables se reemplazan después).
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');

/**
 * Correo de la propia plataforma (no el de cada empresa): recuperación de contraseña, aviso de
 * contraseña cambiada, bienvenida, invitaciones y aviso al Super Admin de empresas nuevas.
 * Servidor en Ajustes del sistema → Correo de la plataforma (PLATFORM_SMTP_*); textos y diseño en
 * Correos de la plataforma (PlatformEmailTemplate + PLATFORM_MAIL_*). Cada envío queda en EmailLog.
 */
@Injectable()
export class PlatformMailService {
  private readonly logger = new Logger(PlatformMailService.name);

  constructor(private settings: SettingsService, private prisma: PrismaService, private log: EmailLogService) {}

  async isConfigured() {
    const [host, user, pass] = await Promise.all([
      this.settings.get('PLATFORM_SMTP_HOST'), this.settings.get('PLATFORM_SMTP_USER'), this.settings.get('PLATFORM_SMTP_PASS'),
    ]);
    return !!(host && user && pass);
  }

  // URL del panel para los enlaces de los correos (la primera si hay varias).
  async frontendUrl() {
    const v = (await this.settings.get('FRONTEND_URL')).split(',')[0]?.trim();
    return (v || primaryFrontendUrl()).replace(/\/+$/, '');
  }

  // ── Diseño común ──────────────────────────────────────────────────────────

  async design(): Promise<Design> {
    const [brand, logoUrl, color, footer] = await Promise.all([
      this.settings.get('PLATFORM_MAIL_BRAND'), this.settings.get('PLATFORM_MAIL_LOGO_URL'),
      this.settings.get('PLATFORM_MAIL_COLOR'), this.settings.get('PLATFORM_MAIL_FOOTER'),
    ]);
    return { brand: brand || DEFAULT_BRAND, logoUrl, color: /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_COLOR, footer };
  }

  async saveDesign(d: Partial<Design>) {
    if (d.color && !/^#[0-9a-f]{6}$/i.test(d.color)) throw new BadRequestException('El color debe tener el formato #RRGGBB');
    if (d.logoUrl && !/^(https?:\/\/|\/)/.test(d.logoUrl)) throw new BadRequestException('El logo debe ser un enlace http(s)');
    const items = ([['brand', 'PLATFORM_MAIL_BRAND'], ['logoUrl', 'PLATFORM_MAIL_LOGO_URL'], ['color', 'PLATFORM_MAIL_COLOR'], ['footer', 'PLATFORM_MAIL_FOOTER']] as const)
      .filter(([k]) => d[k] !== undefined)
      .map(([k, key]) => ({ key, value: String(d[k] ?? '').trim() }));
    await this.settings.upsertMany(items);
    return this.design();
  }

  // Los correos necesitan enlaces absolutos: un archivo en el disco del servidor (/api/uploads/…) se completa con APP_URL.
  private absolute(url: string) {
    if (!url.startsWith('/')) return url;
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    return base ? `${base}${url}` : url;
  }

  // Correo con el diseño de la plataforma: cabecera (logo o nombre), título, párrafos, botón opcional y pie.
  private layout(o: { title: string; bodyHtml: string; button?: { label: string; url: string } }, d: Design) {
    const header = d.logoUrl
      ? `<img src="${esc(this.absolute(d.logoUrl))}" alt="${esc(d.brand)}" style="display:block;max-height:44px;max-width:220px;border:0">`
      : `<div style="font-weight:700;font-size:16px;color:#02093a">${esc(d.brand)}</div>`;
    const btn = o.button
      ? `<p style="margin:22px 0"><a href="${esc(o.button.url)}" style="display:inline-block;background:${d.color};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${esc(o.button.label)}</a></p>
         <p style="margin:0 0 14px;font-size:12px;color:#787774">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${esc(o.button.url)}</span></p>`
      : '';
    const footer = d.footer ? esc(d.footer).replace(/\{\{\s*anio\s*\}\}/g, String(new Date().getFullYear())) : `© ${new Date().getFullYear()} ${esc(d.brand)} de OnDataSolution`;
    return `<!doctype html><html><body style="margin:0;background:#f6f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;padding:28px 16px">
        <div style="margin-bottom:16px">${header}</div>
        <div style="background:#fff;border:1px solid #e9e9e7;border-top:3px solid ${d.color};border-radius:12px;padding:28px">
          <h1 style="margin:0 0 16px;font-size:22px;color:#02093a">${esc(o.title)}</h1>
          ${o.bodyHtml}${btn}
        </div>
        <p style="margin:16px 0 0;font-size:12px;color:#9b9a97;text-align:center">${footer}</p>
      </div></body></html>`;
  }

  // ── Plantillas ────────────────────────────────────────────────────────────

  private defaults(def: PlatformTemplateDef): TemplateText {
    return { subject: def.subject, title: def.title, body: def.body, buttonLabel: def.buttonLabel };
  }

  private async textOf(def: PlatformTemplateDef): Promise<TemplateText> {
    const row = await this.prisma.platformEmailTemplate.findUnique({ where: { key: def.key } });
    if (!row) return this.defaults(def);
    return { subject: row.subject, title: row.title, body: row.body, buttonLabel: def.buttonLabel === null ? null : row.buttonLabel || def.buttonLabel };
  }

  // Arma asunto y HTML de una plantilla con sus variables.
  async render(key: string, vars: Record<string, string>, text?: TemplateText, designDraft?: Partial<Design>) {
    const def = platformTemplate(key);
    if (!def) throw new NotFoundException('Plantilla no encontrada');
    const t = text ?? (await this.textOf(def));
    const d = await this.design();
    // Diseño en edición (sin guardar) para la vista previa.
    if (designDraft) {
      if (designDraft.brand?.trim()) d.brand = designDraft.brand.trim();
      if (designDraft.logoUrl !== undefined) d.logoUrl = designDraft.logoUrl.trim();
      if (designDraft.color && /^#[0-9a-f]{6}$/i.test(designDraft.color)) d.color = designDraft.color;
      if (designDraft.footer !== undefined) d.footer = designDraft.footer.trim();
    }
    const all: Record<string, string> = { marca: d.brand, ...vars };
    const paragraphs = t.body.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) =>
      p.split('\n').filter((line) => line.trim() && keepLine(line, all)).map((line) => fill(inline(line), all, true)).join('<br>'),
    ).filter(Boolean);
    const bodyHtml = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#37352f">${p}</p>`).join('');
    const button = def.buttonLabel !== null && all.enlace ? { label: fill(t.buttonLabel || def.buttonLabel, all, false), url: all.enlace } : undefined;
    return {
      subject: fill(t.subject, all, false).replace(/\s+/g, ' ').trim(),
      html: this.layout({ title: fill(t.title, all, false), bodyHtml, button }, d),
    };
  }

  // Envía una plantilla de la plataforma. Devuelve false (y lo registra) si no se pudo.
  async sendTemplate(key: string, to: string, vars: Record<string, string>, opts: { companyId?: string | null; throwOnError?: boolean } = {}) {
    const def = platformTemplate(key)!;
    const { subject, html } = await this.render(key, vars);
    return this.send(to, subject, html, { ...opts, type: key, redact: def.sensitiveLink && vars.enlace ? [vars.enlace, esc(vars.enlace)] : [] });
  }

  async listTemplates() {
    const rows = await this.prisma.platformEmailTemplate.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return PLATFORM_TEMPLATES.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key, label: def.label, trigger: def.trigger, hasButton: def.buttonLabel !== null,
        vars: { ...def.vars, ...COMMON_VARS },
        defaults: this.defaults(def),
        current: row ? { subject: row.subject, title: row.title, body: row.body, buttonLabel: def.buttonLabel === null ? null : row.buttonLabel || def.buttonLabel } : this.defaults(def),
        customized: !!row, updatedAt: row?.updatedAt ?? null, updatedByName: row?.updatedByName ?? null,
      };
    });
  }

  // Valida el texto editado: campos obligatorios y solo variables conocidas.
  private checkText(def: PlatformTemplateDef, dto: Partial<TemplateText>): TemplateText {
    const t: TemplateText = {
      subject: String(dto.subject ?? '').trim(), title: String(dto.title ?? '').trim(), body: String(dto.body ?? '').trim(),
      buttonLabel: def.buttonLabel === null ? null : String(dto.buttonLabel ?? '').trim(),
    };
    if (!t.subject || !t.title || !t.body) throw new BadRequestException('El asunto, el título y el cuerpo son obligatorios');
    if (def.buttonLabel !== null && !t.buttonLabel) throw new BadRequestException('El texto del botón es obligatorio');
    if (t.subject.length > 200 || t.title.length > 200 || (t.buttonLabel?.length ?? 0) > 60 || t.body.length > 5000) {
      throw new BadRequestException('El texto es demasiado largo');
    }
    const known = new Set([...Object.keys(def.vars), ...Object.keys(COMMON_VARS)]);
    const unknown = [...new Set(varsIn(`${t.subject} ${t.title} ${t.body} ${t.buttonLabel ?? ''}`).filter((v) => !known.has(v)))];
    if (unknown.length) throw new BadRequestException(`Variables que este correo no tiene: ${unknown.map((v) => `{{${v}}}`).join(', ')}`);
    return t;
  }

  async saveTemplate(key: string, dto: Partial<TemplateText>) {
    const def = platformTemplate(key);
    if (!def) throw new NotFoundException('Plantilla no encontrada');
    const t = this.checkText(def, dto);
    const user = currentRequestUser();
    const data = { subject: t.subject, title: t.title, body: t.body, buttonLabel: t.buttonLabel, updatedByName: user ? user.name || user.email : null };
    await this.prisma.platformEmailTemplate.upsert({ where: { key }, update: data, create: { key, ...data } });
    return (await this.listTemplates()).find((x) => x.key === key);
  }

  async resetTemplate(key: string) {
    if (!platformTemplate(key)) throw new NotFoundException('Plantilla no encontrada');
    await this.prisma.platformEmailTemplate.deleteMany({ where: { key } });
    return (await this.listTemplates()).find((x) => x.key === key);
  }

  // Vista previa con datos de ejemplo: del texto en edición o, sin texto, del guardado; y del diseño en edición si viene.
  async previewTemplate(key: string, dto: Partial<TemplateText> & { design?: Partial<Design> }) {
    const def = platformTemplate(key);
    if (!def) throw new NotFoundException('Plantilla no encontrada');
    const text = dto.subject !== undefined ? this.checkText(def, dto) : undefined;
    return this.render(key, def.sample, text, dto.design);
  }

  // Envía el texto en edición con datos de ejemplo a un correo de prueba.
  async sendTemplateTest(key: string, to: string, dto: Partial<TemplateText>) {
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw new BadRequestException('Indica un correo válido');
    const { subject, html } = await this.previewTemplate(key, dto);
    await this.send(to, `[Prueba] ${subject}`, html, { type: 'TEMPLATE_TEST', throwOnError: true });
    return { ok: true };
  }

  // ── Envío ─────────────────────────────────────────────────────────────────

  // Envía el correo y lo registra. Sin correo configurado no falla: queda registrado como fallido y devuelve false.
  async send(to: string, subject: string, html: string, opts: { type?: string; companyId?: string | null; redact?: string[]; throwOnError?: boolean } = {}) {
    const entry = { channel: 'PLATFORM' as const, type: opts.type || 'OTHER', companyId: opts.companyId ?? null, to, subject, html, redact: opts.redact };
    if (!(await this.isConfigured())) {
      this.logger.warn(`Correo de la plataforma sin configurar: no se envió "${subject}" a ${to}`);
      await this.log.record({ ...entry, error: 'Correo de la plataforma sin configurar (Ajustes del sistema → Correo de la plataforma)' });
      if (opts.throwOnError) throw new BadRequestException('Configura primero el correo de la plataforma (servidor, usuario y contraseña SMTP)');
      return false;
    }
    const [host, port, user, pass, fromEmail, fromName] = await Promise.all([
      this.settings.get('PLATFORM_SMTP_HOST'), this.settings.get('PLATFORM_SMTP_PORT'), this.settings.get('PLATFORM_SMTP_USER'),
      this.settings.get('PLATFORM_SMTP_PASS'), this.settings.get('PLATFORM_MAIL_FROM_EMAIL'), this.settings.get('PLATFORM_MAIL_FROM_NAME'),
    ]);
    const from = fromEmail || user;
    try {
      assertIntegrationsEnabled();
      const portN = Number(port) || 465;
      const transport = nodemailer.createTransport({ host, port: portN, secure: portN === 465, auth: { user, pass } });
      await transport.sendMail({ from: `"${fromName || DEFAULT_BRAND}" <${from}>`, to, subject, html });
      await this.log.record({ ...entry, from });
      return true;
    } catch (e: any) {
      this.logger.error(`No se pudo enviar "${subject}" a ${to}: ${e.message}`);
      await this.log.record({ ...entry, from, error: e.message || String(e) });
      if (opts.throwOnError) throw new BadRequestException(`No se pudo enviar el correo: ${e.message}`);
      return false;
    }
  }

  async sendTest(to: string) {
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw new BadRequestException('Indica un correo válido');
    await this.sendTemplate('TEST', to, {}, { throwOnError: true });
    return { ok: true };
  }
}
