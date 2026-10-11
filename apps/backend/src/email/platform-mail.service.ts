import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';
import { assertIntegrationsEnabled } from '../common/integrations.util';
import { primaryFrontendUrl } from '../common/frontend-url.util';

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Correo de la propia plataforma (no el de cada empresa): recuperación de contraseña, aviso de
 * contraseña cambiada, bienvenida al registrarse y aviso al Super Admin de empresas nuevas.
 * Se configura en Configuración → Correo de la plataforma (PLATFORM_SMTP_*).
 */
@Injectable()
export class PlatformMailService {
  private readonly logger = new Logger(PlatformMailService.name);

  constructor(private settings: SettingsService) {}

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

  // Correo con el diseño de la plataforma: título, párrafos y un botón opcional.
  layout(o: { title: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }) {
    const p = o.paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#37352f">${t}</p>`).join('');
    const btn = o.button
      ? `<p style="margin:22px 0"><a href="${esc(o.button.url)}" style="display:inline-block;background:#0075de;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${esc(o.button.label)}</a></p>
         <p style="margin:0 0 14px;font-size:12px;color:#787774">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${esc(o.button.url)}</span></p>`
      : '';
    return `<!doctype html><html><body style="margin:0;background:#f6f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;padding:28px 16px">
        <div style="font-weight:700;font-size:16px;color:#02093a;margin-bottom:16px">AdminMarket</div>
        <div style="background:#fff;border:1px solid #e9e9e7;border-radius:12px;padding:28px">
          <h1 style="margin:0 0 16px;font-size:22px;color:#02093a">${esc(o.title)}</h1>
          ${p}${btn}
        </div>
        <p style="margin:16px 0 0;font-size:12px;color:#9b9a97;text-align:center">${o.footer ? esc(o.footer) : `© ${new Date().getFullYear()} AdminMarket de OnDataSolution`}</p>
      </div></body></html>`;
  }

  // Envía el correo. Sin correo configurado no falla: avisa en el log y devuelve false.
  async send(to: string, subject: string, html: string, opts: { throwOnError?: boolean } = {}) {
    if (!(await this.isConfigured())) {
      this.logger.warn(`Correo de la plataforma sin configurar: no se envió "${subject}" a ${to}`);
      if (opts.throwOnError) throw new BadRequestException('Configura primero el correo de la plataforma (servidor, usuario y contraseña SMTP)');
      return false;
    }
    try {
      assertIntegrationsEnabled();
      const [host, port, user, pass, fromEmail, fromName] = await Promise.all([
        this.settings.get('PLATFORM_SMTP_HOST'), this.settings.get('PLATFORM_SMTP_PORT'), this.settings.get('PLATFORM_SMTP_USER'),
        this.settings.get('PLATFORM_SMTP_PASS'), this.settings.get('PLATFORM_MAIL_FROM_EMAIL'), this.settings.get('PLATFORM_MAIL_FROM_NAME'),
      ]);
      const portN = Number(port) || 465;
      const transport = nodemailer.createTransport({ host, port: portN, secure: portN === 465, auth: { user, pass } });
      await transport.sendMail({ from: `"${fromName || 'AdminMarket'}" <${fromEmail || user}>`, to, subject, html });
      return true;
    } catch (e: any) {
      this.logger.error(`No se pudo enviar "${subject}" a ${to}: ${e.message}`);
      if (opts.throwOnError) throw new BadRequestException(`No se pudo enviar el correo: ${e.message}`);
      return false;
    }
  }

  async sendTest(to: string) {
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw new BadRequestException('Indica un correo válido');
    await this.send(to, 'Prueba del correo de AdminMarket', this.layout({
      title: 'El correo de la plataforma funciona',
      paragraphs: ['Si recibes este mensaje, la recuperación de contraseña y los avisos de AdminMarket se enviarán correctamente.'],
    }), { throwOnError: true });
    return { ok: true };
  }
}
