import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { permissionsForUser } from '../common/permissions';
import { SettingsService } from '../settings/settings.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PlatformMailService } from '../email/platform-mail.service';
import { ROLE_LABEL } from '../users/invitations.service';
import { roleForPermissions } from '../common/permissions';
import { ensureDefaultProfiles } from '../access-profiles/default-profiles';

const RESET_TTL_MS = 60 * 60 * 1000; // el enlace de recuperación vence en 1 hora
const MIN_PASSWORD = 8;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const slugify = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'empresa';
const USER_INCLUDE = { company: { include: { subscriptionPlan: true } }, accessProfile: true } as const;

function sanitizeCompany(company: any) {
  if (!company) return company;
  const { mlClientSecret: _, subscriptionPlan, ...rest } = company;
  // Funciones del plan comercial (el menú oculta lo que el plan no incluye). null = sin plan.
  return { ...rest, planName: subscriptionPlan?.name ?? null, planFeatures: subscriptionPlan?.features ?? null };
}

function shapeUser(user: any) {
  const { password: _p, company, accessProfile, ...rest } = user;
  return {
    ...rest,
    company: sanitizeCompany(company),
    accessProfile: accessProfile
      ? { id: accessProfile.id, name: accessProfile.name }
      : null,
    permissions: permissionsForUser(user),
  };
}

// Usuarios de una empresa desactivada (o con la baja en curso) no pueden entrar. El super admin
// no pertenece a ninguna empresa, así que nunca queda bloqueado.
export function assertCompanyActive(user: { role: string; company?: { name: string; active: boolean; closureScheduledFor?: Date | null } | null }) {
  if (user.role === 'SUPER_ADMIN' || !user.company || user.company.active) return;
  if (user.company.closureScheduledFor) {
    const d = user.company.closureScheduledFor.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    throw new UnauthorizedException(`La cuenta de ${user.company.name} fue dada de baja y sus datos se eliminarán el ${d}. Si fue un error, contacta a soporte antes de esa fecha.`);
  }
  throw new UnauthorizedException(`La cuenta de ${user.company.name} está desactivada. Contacta a soporte.`);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private settings: SettingsService,
    private subscription: SubscriptionService,
    private mail: PlatformMailService,
  ) {}

  // El token lleva la versión de sesión del usuario: al cambiar la contraseña sube y los
  // tokens anteriores (otras sesiones abiertas) dejan de valer.
  private session(user: any) {
    const token = this.jwt.sign({ sub: user.id, email: user.email, tv: user.tokenVersion ?? 0 });
    return { access_token: token, user: shapeUser(user) };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, active: true },
      include: { company: { include: { subscriptionPlan: true } }, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');
    assertCompanyActive(user);

    return this.session(user);
  }

  // ── Ingreso y registro con Google ──────────────────────────────────────

  private async flag(key: string) {
    return !/^(false|0|no)$/i.test((await this.settings.get(key)).trim());
  }

  // Configuración pública para la pantalla de ingreso (sin token).
  async publicConfig() {
    const clientId = (await this.settings.get('GOOGLE_CLIENT_ID')).trim();
    const google = !!clientId && (await this.flag('AUTH_GOOGLE_ENABLED'));
    return { googleClientId: google ? clientId : null, signupEnabled: google && (await this.flag('AUTH_SIGNUP_ENABLED')) };
  }

  // Verifica el token de Google (firma, emisor, audiencia y correo verificado) con el servicio oficial.
  private async verifyGoogle(credential: string) {
    const clientId = (await this.settings.get('GOOGLE_CLIENT_ID')).trim();
    if (!clientId || !(await this.flag('AUTH_GOOGLE_ENABLED'))) throw new BadRequestException('El ingreso con Google no está habilitado');
    if (!credential) throw new BadRequestException('Falta la credencial de Google');
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const info: any = await res.json().catch(() => ({}));
    if (!res.ok || !info?.email) throw new UnauthorizedException('Google no validó el ingreso. Intenta de nuevo.');
    if (info.aud !== clientId) throw new UnauthorizedException('La credencial de Google no corresponde a esta aplicación');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw new UnauthorizedException('Emisor de Google no válido');
    if (String(info.email_verified) !== 'true') throw new UnauthorizedException('Tu correo de Google no está verificado');
    if (Number(info.exp) * 1000 < Date.now()) throw new UnauthorizedException('El ingreso con Google venció. Intenta de nuevo.');
    return { email: String(info.email).toLowerCase(), name: String(info.name || info.given_name || '').trim(), sub: String(info.sub) };
  }

  // Ingreso con Google: entra si el correo ya existe; si no, devuelve un permiso de registro
  // (válido 30 min) para crear su empresa, cuando el registro está habilitado.
  async googleLogin(credential: string) {
    const g = await this.verifyGoogle(credential);
    const user = await this.prisma.user.findFirst({ where: { email: { equals: g.email, mode: 'insensitive' } }, include: USER_INCLUDE });
    if (user) {
      if (!user.active) throw new UnauthorizedException('Tu usuario está desactivado. Contacta al administrador de tu empresa.');
      assertCompanyActive(user);
      if (user.googleSub !== g.sub) await this.prisma.user.update({ where: { id: user.id }, data: { googleSub: g.sub } });
      return this.session(user);
    }
    // Tiene una invitación pendiente: entra directo a esa empresa (Google confirmó que el correo es suyo).
    const invitation = await this.prisma.userInvitation.findFirst({
      where: { email: g.email, status: 'PENDING', expiresAt: { gt: new Date() }, company: { active: true } },
      orderBy: { createdAt: 'desc' }, include: { company: { select: { id: true, name: true, active: true } } },
    });
    if (invitation) {
      return this.consumeInvitation(invitation, { name: (invitation.name || g.name || g.email.split('@')[0]).slice(0, 120), passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10), googleSub: g.sub });
    }
    if (!(await this.flag('AUTH_SIGNUP_ENABLED'))) {
      throw new UnauthorizedException(`No hay una cuenta con ${g.email}. Pide a tu administrador que te cree un usuario.`);
    }
    const signupToken = this.jwt.sign({ purpose: 'signup', email: g.email, name: g.name, gsub: g.sub }, { expiresIn: '30m' });
    return { needsSignup: true, signupToken, email: g.email, name: g.name };
  }

  // Registro: crea la empresa con el plan de prueba y a la persona como administradora.
  async googleSignup(dto: { signupToken: string; companyName: string; name?: string; phone?: string; rut?: string }) {
    if (!(await this.flag('AUTH_SIGNUP_ENABLED'))) throw new BadRequestException('El registro de empresas nuevas no está habilitado');
    let payload: any;
    try {
      payload = this.jwt.verify(dto.signupToken);
    } catch {
      throw new UnauthorizedException('El registro venció. Vuelve a entrar con Google.');
    }
    if (payload?.purpose !== 'signup' || !payload.email) throw new UnauthorizedException('Registro no válido');
    const companyName = String(dto.companyName || '').trim().slice(0, 120);
    if (companyName.length < 2) throw new BadRequestException('Escribe el nombre de tu empresa');
    const name = String(dto.name || payload.name || payload.email.split('@')[0]).trim().slice(0, 120);
    const phone = String(dto.phone || '').trim().slice(0, 30);
    const rut = String(dto.rut || '').trim().slice(0, 20);
    if (await this.prisma.user.findFirst({ where: { email: { equals: payload.email, mode: 'insensitive' } } })) {
      throw new ConflictException('Ya existe una cuenta con ese correo. Entra con Google.');
    }
    // Slug único a partir del nombre.
    const base = slugify(companyName);
    let slug = base;
    for (let i = 2; await this.prisma.company.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    // Sin contraseña conocida: entra con Google (o se crea una con "¿Olvidaste tu contraseña?").
    const password = await bcrypt.hash(randomBytes(24).toString('hex'), 10);
    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({ data: { name: companyName, slug } });
      // La empresa parte con sus perfiles base; quien se registra queda con "Administrador".
      const profiles = await ensureDefaultProfiles(tx, c.id);
      await tx.user.create({ data: { name, email: payload.email, password, role: 'COMPANY_ADMIN', companyId: c.id, googleSub: payload.gsub || null, accessProfileId: profiles.COMPANY_ADMIN } });
      return c;
    });
    const trial = await this.prisma.subscriptionPlan.findFirst({ where: { isTrial: true, active: true }, orderBy: { sortOrder: 'asc' } });
    if (trial) await this.subscription.assignPlan(company.id, trial.id).catch((e) => this.logger.warn(`Plan de prueba: ${e.message}`));
    const user = await this.prisma.user.findFirstOrThrow({ where: { email: payload.email }, include: USER_INCLUDE });
    void this.signupEmails(user, company.name, phone, rut, trial?.trialDays ?? 15);
    return this.session(user);
  }

  private async signupEmails(user: any, companyName: string, phone: string, rut: string, days: number) {
    const url = await this.mail.frontendUrl();
    await this.mail.send(user.email, 'Bienvenido a AdminMarket', this.mail.layout({
      title: `¡Bienvenido, ${user.name.split(' ')[0]}!`,
      paragraphs: [
        `Creamos la cuenta de <strong>${esc(companyName)}</strong> con ${days} días de prueba gratis.`,
        'Conecta tus canales de venta, carga tu catálogo y gestiona tus órdenes desde un solo lugar.',
      ],
      button: { label: 'Entrar al panel', url: `${url}/login` },
    }));
    const notify = (await this.settings.get('PLATFORM_NOTIFY_EMAIL')) || (await this.settings.get('CONTACT_EMAIL'));
    if (notify) {
      await this.mail.send(notify, `Nueva empresa registrada: ${companyName}`, this.mail.layout({
        title: 'Nueva empresa registrada',
        paragraphs: [
          `<strong>${esc(companyName)}</strong> se registró con Google y quedó con el plan de prueba.`,
          `Administrador: ${esc(user.name)} (${esc(user.email)})${phone ? `<br>Teléfono: ${esc(phone)}` : ''}${rut ? `<br>RUT: ${esc(rut)}` : ''}`,
        ],
        button: { label: 'Ver empresas', url: `${url}/dashboard/companies` },
      }));
    }
  }

  // ── Invitaciones a una empresa ─────────────────────────────────────────

  private async validInvitation(token: string) {
    const inv = token ? await this.prisma.userInvitation.findUnique({
      where: { tokenHash: sha256(String(token)) }, include: { company: { select: { id: true, name: true, active: true } } },
    }) : null;
    if (!inv || inv.status !== 'PENDING') throw new BadRequestException('La invitación no es válida o ya fue usada. Pide una nueva al administrador de tu empresa.');
    if (inv.expiresAt < new Date()) throw new BadRequestException('La invitación venció. Pide al administrador de tu empresa que te la reenvíe.');
    if (!inv.company.active) throw new BadRequestException('La empresa de esta invitación está desactivada.');
    return inv;
  }

  // Datos para la pantalla de aceptar invitación (sin token de sesión).
  async checkInvitation(token: string) {
    const inv = await this.validInvitation(token);
    const cfg = await this.publicConfig();
    const profile = inv.accessProfileId ? await this.prisma.accessProfile.findUnique({ where: { id: inv.accessProfileId }, select: { name: true } }) : null;
    return {
      email: inv.email, name: inv.name, company: inv.company.name, role: inv.role, roleLabel: profile?.name || ROLE_LABEL[inv.role] || inv.role,
      invitedByName: inv.invitedByName, expiresAt: inv.expiresAt, googleClientId: cfg.googleClientId,
      exists: !!(await this.prisma.user.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' } }, select: { id: true } })),
    };
  }

  // Crea el usuario de la invitación y entra. Con Google se exige que sea el mismo correo invitado.
  private async consumeInvitation(inv: Awaited<ReturnType<AuthService['validInvitation']>>, data: { name: string; passwordHash: string; googleSub?: string | null }) {
    if (await this.prisma.user.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' } } })) {
      throw new ConflictException('Ya existe una cuenta con ese correo. Ingresa desde la pantalla de inicio de sesión.');
    }
    // El límite del plan se revisa de nuevo al aceptar (la invitación ya estaba contada).
    await this.subscription.assertCanAdd(inv.companyId, 'users');
    // El nivel sale del perfil tal como está al aceptar (pudo editarse después de invitar).
    const profile = inv.accessProfileId ? await this.prisma.accessProfile.findUnique({ where: { id: inv.accessProfileId }, select: { permissions: true } }) : null;
    const role = profile ? roleForPermissions(profile.permissions).role : inv.role;
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: inv.email, name: data.name, password: data.passwordHash, role, companyId: inv.companyId,
          accessProfileId: inv.accessProfileId, googleSub: data.googleSub || null,
        },
      });
      await tx.userInvitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId: u.id } });
      return u;
    });
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: USER_INCLUDE });
    assertCompanyActive(full);
    return this.session(full);
  }

  async acceptInvitation(token: string, dto: { name?: string; password: string }) {
    const inv = await this.validInvitation(token);
    const pw = String(dto.password || '');
    if (pw.length < MIN_PASSWORD) throw new BadRequestException(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
    const name = String(dto.name || inv.name || inv.email.split('@')[0]).trim().slice(0, 120);
    return this.consumeInvitation(inv, { name, passwordHash: await bcrypt.hash(pw, 10) });
  }

  async acceptInvitationGoogle(token: string, credential: string) {
    const inv = await this.validInvitation(token);
    const g = await this.verifyGoogle(credential);
    if (g.email !== inv.email.toLowerCase()) {
      throw new UnauthorizedException(`La invitación es para ${inv.email}. Entra con esa cuenta de Google o crea una contraseña.`);
    }
    const name = (inv.name || g.name || inv.email.split('@')[0]).slice(0, 120);
    return this.consumeInvitation(inv, { name, passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10), googleSub: g.sub });
  }

  // ── Recuperación de contraseña ─────────────────────────────────────────

  // Siempre responde lo mismo, exista o no el correo (no revela qué cuentas existen).
  async forgotPassword(emailRaw: string) {
    const email = String(emailRaw || '').trim().toLowerCase();
    const generic = { ok: true, message: 'Si el correo está registrado, te enviamos las instrucciones para crear una nueva contraseña.' };
    if (!/^\S+@\S+\.\S+$/.test(email)) return generic;
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, active: true }, include: { company: true } });
    if (!user || (user.company && !user.company.active)) return generic;
    // Como máximo 3 enlaces por hora por usuario.
    const recent = await this.prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_TTL_MS) } } });
    if (recent >= 3) return generic;
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    const url = `${await this.mail.frontendUrl()}/restablecer?token=${token}`;
    await this.mail.send(user.email, 'Crea una nueva contraseña', this.mail.layout({
      title: 'Recupera tu acceso',
      paragraphs: [
        `Hola ${esc(user.name.split(' ')[0])}, recibimos una solicitud para crear una nueva contraseña en AdminMarket.`,
        'El enlace sirve una sola vez y vence en 1 hora. Si no lo pediste, ignora este correo: tu contraseña actual sigue igual.',
      ],
      button: { label: 'Crear nueva contraseña', url },
    }));
    return generic;
  }

  // Valida el enlace antes de mostrar el formulario.
  async checkResetToken(token: string) {
    const row = await this.validResetToken(token);
    return { ok: true, email: row.user.email };
  }

  private async validResetToken(token: string) {
    const row = token ? await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(String(token)) }, include: { user: true } }) : null;
    if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) {
      throw new BadRequestException('El enlace no es válido o ya venció. Pide uno nuevo desde "¿Olvidaste tu contraseña?".');
    }
    return row;
  }

  async resetPassword(token: string, password: string) {
    const row = await this.validResetToken(token);
    const pw = String(password || '');
    if (pw.length < MIN_PASSWORD) throw new BadRequestException(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
    await this.prisma.$transaction([
      // Cierra las sesiones abiertas en otros equipos.
      this.prisma.user.update({ where: { id: row.userId }, data: { password: await bcrypt.hash(pw, 10), tokenVersion: { increment: 1 } } }),
      // El enlace usado y los demás pendientes del usuario dejan de servir.
      this.prisma.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    void this.mail.send(row.user.email, 'Tu contraseña fue cambiada', this.mail.layout({
      title: 'Contraseña actualizada',
      paragraphs: [
        `Hola ${esc(row.user.name.split(' ')[0])}, la contraseña de tu cuenta de AdminMarket se cambió correctamente y se cerraron las sesiones abiertas en otros equipos.`,
        'Si no fuiste tú, contacta a soporte de inmediato.',
      ],
    }));
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: row.userId }, include: USER_INCLUDE });
    assertCompanyActive(user);
    return this.session(user);
  }

  async validateToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, active: true },
      include: { company: { include: { subscriptionPlan: true } }, accessProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    assertCompanyActive(user);
    return shapeUser(user);
  }
}
