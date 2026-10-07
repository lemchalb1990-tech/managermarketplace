import { mlShipmentLabel } from './ml-shipment-labels';
import { cleanGtinAttributes } from '../../common/gtin.util';
import { ActivityService } from '../../activity/activity.service';
import { assertIntegrationsEnabled } from '../../common/integrations.util';
import { buildLabelsPdf, LabelDetailOrder } from './label-detail';
import {
  Injectable, Logger, BadRequestException, NotFoundException,
  InternalServerErrorException, ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  Role, SaleChannel, MovementType, MarketplaceType,
  MlQuestionStatus, MlClaimStatus, SaleFeedbackRating, ReturnStatus, FulfillmentType, OrderStatus, OrderEventSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService, MERGE_FIELD_KEYS } from '../../catalog/catalog.service';
import { SettingsService } from '../../settings/settings.service';
import { ListingStatus } from '@prisma/client';
import { SyncService } from '../sync/sync.service';
import { InventoryCostingService } from '../../purchases/inventory-costing.service';
import { StockLedgerService } from '../../purchases/stock-ledger.service';
import { getEffectivePrice, getListingPrice } from '../../common/effective-price.util';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolibre.cl';

// Árbol de categorías raíz de MLC (Mercado Libre Chile), hardcodeado: el endpoint público
// GET /sites/MLC/categories devuelve 403 "PolicyAgent" (bloqueado por el WAF de ML, al menos
// desde los servidores donde corre esta app), así que no se puede resolver en vivo. Esta
// lista prácticamente no cambia — cada id se verificó contra GET /categories/{id} (ese sí
// funciona) para confirmar que es una raíz real y tomar su nombre oficial.
const MLC_ROOT_CATEGORIES: { id: string; name: string }[] = [
  { id: 'MLC1747', name: 'Accesorios para Vehículos' },
  { id: 'MLC1512', name: 'Agro' },
  { id: 'MLC1403', name: 'Alimentos y Bebidas' },
  { id: 'MLC1071', name: 'Mascotas' },
  { id: 'MLC1367', name: 'Antigüedades y Colecciones' },
  { id: 'MLC1368', name: 'Arte, Librería y Cordonería' },
  { id: 'MLC1743', name: 'Autos, Motos y Otros' },
  { id: 'MLC1384', name: 'Bebés' },
  { id: 'MLC1246', name: 'Belleza y Cuidado Personal' },
  { id: 'MLC1039', name: 'Cámaras y Accesorios' },
  { id: 'MLC1051', name: 'Celulares y Telefonía' },
  { id: 'MLC1648', name: 'Computación' },
  { id: 'MLC1144', name: 'Consolas y Videojuegos' },
  { id: 'MLC1500', name: 'Construcción' },
  { id: 'MLC1276', name: 'Deportes y Fitness' },
  { id: 'MLC5726', name: 'Electrodomésticos' },
  { id: 'MLC1000', name: 'Electrónica, Audio y Video' },
  { id: 'MLC110931', name: 'Entradas para Eventos' },
  { id: 'MLC178483', name: 'Herramientas' },
  { id: 'MLC1574', name: 'Hogar y Muebles' },
  { id: 'MLC1499', name: 'Industrias y Oficinas' },
  { id: 'MLC1459', name: 'Inmuebles' },
  { id: 'MLC1182', name: 'Instrumentos Musicales' },
  { id: 'MLC1132', name: 'Juegos y Juguetes' },
  { id: 'MLC3025', name: 'Libros, Revistas y Comics' },
  { id: 'MLC1168', name: 'Música y Películas' },
  { id: 'MLC3937', name: 'Relojes y Joyas' },
  { id: 'MLC409431', name: 'Salud y Equipamiento Médico' },
  { id: 'MLC1540', name: 'Servicios' },
  { id: 'MLC435280', name: 'Souvenirs, Cotillón y Fiestas' },
  { id: 'MLC1430', name: 'Vestuario y Calzado' },
  { id: 'MLC1953', name: 'Otras Categorías' },
];

// Raíces de "aviso clasificado": usan un formato de publicación totalmente distinto al de
// un producto normal (piden datos de contacto del vendedor, no manejan stock como
// inventario, etc.), que hoy esta app no arma — ver assertPublishableCategory. Chile no
// tiene categoría de Empleos activa en Mercado Libre.
interface MlShippingAddress {
  addressLine: string | null;
  commune: string | null;
  region: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
}

// Datos del comprador cuando la venta NO usa Mercado Envíos ("acordar con el vendedor"): no hay
// receiver_address, así que se arman desde la orden (buyer) y su información de facturación.
export interface MlBuyerContact {
  name: string | null;
  phone: string | null;
  email: string | null;
  docType: string | null;
  docNumber: string | null;
  address: string | null;
  commune: string | null;
  region: string | null;
}

// Resultado de autorizar una tienda (se muestra al usuario al volver al panel).
export interface MlAuthResult {
  connectionName: string;
  nickname: string | null;
  clientId: string | null;
  clientIdVerified: boolean;
}

// Venta de Mercado Libre sin envío de Mercado Envíos: la entrega se acuerda con el comprador.
const ML_TO_AGREE_COURIER = 'Acordar con el comprador';

type MlListingType = 'PRODUCTO' | 'VEHICULO' | 'INMUEBLE' | 'SERVICIO';
const CLASSIFIED_ROOT_IDS: Record<Exclude<MlListingType, 'PRODUCTO'>, string> = {
  VEHICULO: 'MLC1743',
  INMUEBLE: 'MLC1459',
  SERVICIO: 'MLC1540',
};

@Injectable()
export class MercadolibreService {
  private readonly logger = new Logger(MercadolibreService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private catalog: CatalogService,
    private settings: SettingsService,
    private sync: SyncService,
    private costing: InventoryCostingService,
    private ledger: StockLedgerService,
    private activity: ActivityService,
  ) {}

  // ─── Credenciales por empresa ────────────────────────────────────────────────

  private async getCompanyCredentials(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { mlClientId: true, mlClientSecret: true },
    });
    const clientId = company?.mlClientId || this.config.get('ML_CLIENT_ID');
    const clientSecret = company?.mlClientSecret || this.config.get('ML_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Configura el Client ID y Secret de Mercado Libre en la sección Mercado Libre antes de continuar.',
      );
    }
    return { clientId, clientSecret };
  }

  async getMlSettings(user: any, companyId?: string) {
    const cid = user.role !== Role.SUPER_ADMIN ? user.companyId : companyId;
    if (!cid) return { mlClientId: null, hasSecret: false };
    const company = await this.prisma.company.findUnique({
      where: { id: cid },
      select: { mlClientId: true, mlClientSecret: true },
    });
    return {
      mlClientId: company?.mlClientId || null,
      hasSecret: !!company?.mlClientSecret,
    };
  }

  async saveCredentials(user: any, mlClientId: string, mlClientSecret: string, companyId?: string) {
    const cid = user.role !== Role.SUPER_ADMIN ? user.companyId : companyId;
    if (!cid) throw new BadRequestException('Selecciona una empresa');
    return this.prisma.company.update({
      where: { id: cid },
      data: { mlClientId, mlClientSecret },
      select: { id: true, name: true, mlClientId: true },
    });
  }

  // ─── OAuth ───────────────────────────────────────────────────────────────────

  async createCredentialConnection(user: any, name: string, mlClientId: string, mlClientSecret: string, companyId?: string) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    if (!cid) throw new BadRequestException('companyId requerido');
    if (!mlClientId?.trim() || !mlClientSecret?.trim()) {
      throw new BadRequestException('Client ID y Client Secret son requeridos');
    }
    const conn = await this.prisma.marketplaceConnection.create({
      data: {
        name,
        marketplace: 'MERCADO_LIBRE',
        mlClientId: mlClientId.trim(),
        mlClientSecret: mlClientSecret.trim(),
        accessToken: '',
        active: false,
        // Solo ventas desde que se conecta; las anteriores van como historial.
        lastSalesImportAt: new Date(),
        companyId: cid,
      },
      select: {
        id: true, name: true, marketplace: true, mlClientId: true, active: true, expiresAt: true, createdAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    return { ...conn, authorized: false };
  }

  // Solo Super Admin (ver controller): permite corregir el nombre y/o las credenciales
  // (Client ID / Client Secret) de una conexión ya creada, sin tener que borrarla y
  // volver a crearla (lo que perdería el token de autorización ya obtenido).
  async updateCredentialConnection(
    id: string,
    dto: { name?: string; mlClientId?: string; mlClientSecret?: string },
    user: any,
  ) {
    await this.getConnectionForUser(id, user);
    const data: any = {};
    if (dto.name?.trim()) data.name = dto.name.trim();
    if (dto.mlClientId?.trim()) data.mlClientId = dto.mlClientId.trim();
    if (dto.mlClientSecret?.trim()) data.mlClientSecret = dto.mlClientSecret.trim();
    return this.prisma.marketplaceConnection.update({
      where: { id },
      data,
      select: { id: true, name: true, marketplace: true, mlClientId: true, active: true, expiresAt: true, createdAt: true },
    });
  }

  // Datos que cada cliente pega en SU aplicación de Mercado Libre (developers.mercadolibre.cl):
  // URL de redirección, URL de notificaciones y tópicos que procesa el sistema.
  async getAppSetup() {
    const appUrl = (await this.settings.get('APP_URL'))?.replace(/\/+$/, '') || null;
    return {
      redirectUri: appUrl ? `${appUrl}/api/ecommerce/ml/callback` : null,
      notificationsUrl: appUrl ? `${appUrl}/api/ecommerce/ml/webhook` : null,
      topics: [
        { id: 'orders_v2', label: 'Orders (ventas)' },
        { id: 'questions', label: 'Questions (preguntas)' },
        { id: 'claims', label: 'Claims (reclamos)' },
        { id: 'shipments', label: 'Shipments (envíos)' },
        { id: 'orders_feedback', label: 'Orders feedback (calificaciones)' },
      ],
    };
  }

  private async getRedirectUri(): Promise<string> {
    const appUrl = await this.settings.get('APP_URL');
    if (!appUrl) {
      throw new BadRequestException(
        'Configura la URL del backend (APP_URL) en Configuración antes de conectar Mercado Libre.',
      );
    }
    return `${appUrl.replace(/\/+$/, '')}/api/ecommerce/ml/callback`;
  }

  async getAuthUrlForConnection(connectionId: string, user: any): Promise<string> {
    const conn = await this.getConnectionForUser(connectionId, user);
    if (!conn.mlClientId || !conn.mlClientSecret) {
      throw new BadRequestException('Esta conexión no tiene credenciales guardadas');
    }
    const redirectUri = await this.getRedirectUri();

    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const state = Buffer.from(JSON.stringify({ connectionId: conn.id, codeVerifier })).toString('base64url');
    return `${ML_AUTH}/authorization?response_type=code&client_id=${conn.mlClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  }

  async handleCallback(code: string, state: string, fallbackName: string): Promise<MlAuthResult> {
    let connectionId: string;
    let codeVerifier: string;
    try {
      const decoded = JSON.parse(Buffer.from(state || '', 'base64url').toString());
      connectionId = decoded.connectionId;
      codeVerifier = decoded.codeVerifier;
    } catch {
      throw new BadRequestException(
        'El enlace de autorización no es válido o está incompleto. Vuelve a presionar "Autorizar" desde el panel de Mercado Libre.',
      );
    }
    if (!code) {
      throw new BadRequestException('Mercado Libre no devolvió el código de autorización. Vuelve a presionar "Autorizar" desde el panel.');
    }

    const draft = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!draft) throw new BadRequestException('La tienda que se estaba autorizando ya no existe en el panel. Vuelve a crearla y autorízala.');

    const clientId = draft.mlClientId;
    const clientSecret = draft.mlClientSecret;
    const redirectUri = await this.getRedirectUri();

    const res = await fetch(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!res.ok) {
      const raw = await res.text();
      this.logger.error(`ML token exchange failed [${res.status}] conexión ${connectionId}: ${raw}`);
      throw new BadRequestException(this.describeTokenError(raw, draft.mlClientId));
    }

    const tokens = await res.json() as any;

    // Verificación de la aplicación: el access_token de ML lleva el Client ID de la app que lo
    // emitió (APP_USR-<client_id>-...). Debe ser el mismo Client ID guardado en esta tienda; si
    // no, la autorización se mezcló con la de otra tienda/app y no se guarda nada.
    const tokenAppId = /^APP_USR-(\d+)-/.exec(String(tokens.access_token || ''))?.[1] || null;
    const expectedAppId = String(draft.mlClientId || '').trim();
    if (tokenAppId && expectedAppId && tokenAppId !== expectedAppId) {
      throw new BadRequestException(
        `La autorización se emitió para la aplicación con Client ID ${tokenAppId}, pero esta tienda ("${draft.name}") ` +
        `usa el Client ID ${expectedAppId}. Probablemente se cruzó con la autorización de otra tienda (por ejemplo, ` +
        'dos ventanas de autorización abiertas a la vez). No se guardó nada: cierra las otras ventanas de Mercado Libre ' +
        'y vuelve a presionar "Autorizar" en esta tienda. Si se repite, revisa en "Editar" que el Client ID sea el de la aplicación correcta.',
      );
    }

    // Qué cuenta de Mercado Libre quedó autorizada: si el navegador tenía abierta la sesión de
    // OTRA tienda, ML autoriza esa — y esta tienda nunca recibiría sus propias ventas/preguntas.
    const account = await this.fetchMlAccount(tokens.access_token);
    const mlUserId = account?.id || (tokens.user_id != null ? String(tokens.user_id) : null);
    if (mlUserId) {
      const other = await this.prisma.marketplaceConnection.findFirst({
        where: {
          marketplace: MarketplaceType.MERCADO_LIBRE, active: true, accessToken: { not: '' },
          mlUserId, id: { not: connectionId },
        },
        select: { name: true, companyId: true },
      });
      if (other) {
        const where = other.companyId === draft.companyId ? `en la tienda "${other.name}"` : 'en otra empresa';
        throw new BadRequestException(
          `La cuenta de Mercado Libre "${account?.nickname || mlUserId}" ya está conectada ${where}. ` +
          'Cierra sesión en Mercado Libre (o abre una ventana de incógnito), inicia sesión con la cuenta de esta tienda y vuelve a autorizar.',
        );
      }
    }

    await this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        active: true,
        mlUserId,
        mlNickname: account?.nickname || null,
      },
    });
    void fallbackName;
    return {
      connectionName: draft.name,
      nickname: account?.nickname || null,
      clientId: tokenAppId || expectedAppId || null,
      clientIdVerified: !!tokenAppId && tokenAppId === expectedAppId,
    };
  }

  // Mensaje entendible (con la acción a seguir) para un error del intercambio de código por token.
  private describeTokenError(raw: string, clientId: string | null): string {
    let err: any = {};
    try { err = JSON.parse(raw); } catch { /* respuesta no JSON */ }
    const code = String(err.error || '').toLowerCase();
    const mlMessage = String(err.message || err.error_description || raw || '').slice(0, 200);
    const detail = mlMessage ? ` Detalle de Mercado Libre: ${mlMessage}` : '';
    if (code === 'invalid_client' || /client/i.test(mlMessage) && /invalid|secret/i.test(mlMessage)) {
      return `El Client ID (${clientId || 'sin dato'}) o el Client Secret de esta tienda no son válidos para Mercado Libre. ` +
        'Revisa en "Editar" que sean los de la aplicación correcta y vuelve a autorizar.' + detail;
    }
    if (/redirect/i.test(mlMessage)) {
      return 'La URL de redirección configurada en la aplicación de Mercado Libre no coincide con la del panel. ' +
        'Revisa la "Redirect URI" de la aplicación en developers.mercadolibre.cl y vuelve a autorizar.' + detail;
    }
    if (code === 'invalid_grant' || /code|verifier|expired/i.test(mlMessage)) {
      return 'El código de autorización ya se usó, expiró o se generó con otra aplicación (error de sincronización). ' +
        'Cierra esta ventana y vuelve a presionar "Autorizar" en el panel, con una sola ventana de autorización abierta.' + detail;
    }
    return 'Mercado Libre rechazó la autorización. Vuelve a presionar "Autorizar" en el panel.' + detail;
  }

  // Usuario de Mercado Libre dueño de un token (id y apodo).
  private async fetchMlAccount(accessToken: string): Promise<{ id: string; nickname: string | null } | null> {
    try {
      const res = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;
      const me = await res.json() as any;
      return me?.id != null ? { id: String(me.id), nickname: me.nickname || null } : null;
    } catch {
      return null;
    }
  }

  // ─── Token management ────────────────────────────────────────────────────────

  private async refreshToken(connectionId: string) {
    const conn = await this.prisma.marketplaceConnection.findUnique({
      where: { id: connectionId },
      include: { company: { select: { mlClientId: true, mlClientSecret: true } } },
    });
    if (!conn?.refreshToken) throw new InternalServerErrorException('Sin refresh token');

    const clientId = conn.mlClientId || conn.company?.mlClientId || this.config.get('ML_CLIENT_ID');
    const clientSecret = conn.mlClientSecret || conn.company?.mlClientSecret || this.config.get('ML_CLIENT_SECRET');

    const res = await fetch(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refreshToken,
      }),
    });

    if (!res.ok) throw new InternalServerErrorException('Error al renovar token de ML');

    const tokens = await res.json() as any;
    return this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
  }

  private async getValidToken(connectionId: string): Promise<string> {
    assertIntegrationsEnabled();
    let conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (conn.expiresAt && conn.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      conn = await this.refreshToken(connectionId);
    }
    return conn.accessToken;
  }

  async refreshConnectionToken(connectionId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    const updated = await this.refreshToken(connectionId);
    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
      expiresAt: updated.expiresAt,
    };
  }

  // ─── Connections ─────────────────────────────────────────────────────────────

  async getConnections(user: any, companyId?: string) {
    const where: any = { marketplace: 'MERCADO_LIBRE', OR: [{ active: true }, { accessToken: '' }] };
    if (user.role !== Role.SUPER_ADMIN) {
      where.companyId = user.companyId;
    } else if (companyId) {
      where.companyId = companyId;
    }
    const rows = await this.prisma.marketplaceConnection.findMany({
      where,
      select: {
        id: true, name: true, marketplace: true, mlClientId: true, active: true, accessToken: true,
        expiresAt: true, createdAt: true, mlUserId: true, mlNickname: true, syncEnabled: true,
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Conexiones autorizadas antes de guardar la cuenta: se completa una vez.
    for (const row of rows) {
      if (!row.accessToken || row.mlUserId) continue;
      try {
        const token = await this.getValidToken(row.id);
        const account = await this.fetchMlAccount(token);
        if (account) {
          await this.prisma.marketplaceConnection.update({
            where: { id: row.id }, data: { mlUserId: account.id, mlNickname: account.nickname },
          });
          row.mlUserId = account.id;
          row.mlNickname = account.nickname;
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo identificar la cuenta ML de la conexión ${row.id}: ${err?.message || err}`);
      }
    }

    return rows.map(({ accessToken, ...rest }) => ({
      ...rest,
      authorized: !!accessToken,
      // Otras tiendas activas autorizadas con la misma cuenta de Mercado Libre.
      sharedAccountWith: rest.mlUserId && rest.active
        ? rows.filter((o) => o.id !== rest.id && o.active && o.accessToken && o.mlUserId === rest.mlUserId).map((o) => o.name)
        : [],
    }));
  }

  async removeConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    if (!conn.accessToken) {
      return this.prisma.marketplaceConnection.delete({ where: { id } });
    }
    return this.prisma.marketplaceConnection.update({ where: { id }, data: { active: false } });
  }

  // ─── Categorías ──────────────────────────────────────────────────────────────

  // Categoría raíz (tope del árbol) a la que pertenece una categoría cualquiera.
  private async getCategoryTopId(categoryId: string): Promise<string | null> {
    try {
      const res = await fetch(`${ML_API}/categories/${categoryId}`);
      if (!res.ok) return null;
      const data = await res.json() as any;
      return data.path_from_root?.[0]?.id || null;
    } catch {
      return null;
    }
  }

  // Si la categoría es de aviso clasificado (Vehículos/Inmuebles/Empleos/Servicios), no se
  // puede publicar: esta app solo arma el formato de un producto normal. Se usa antes de
  // publicar/republicar para dar un mensaje claro en vez del error crudo de Mercado Libre.
  private async assertPublishableCategory(categoryId: string) {
    const topId = await this.getCategoryTopId(categoryId);
    if (!topId) return;
    if (Object.values(CLASSIFIED_ROOT_IDS).includes(topId)) {
      const label = MLC_ROOT_CATEGORIES.find((r) => r.id === topId)?.name || 'aviso clasificado';
      throw new BadRequestException(
        `Esta categoría es de ${label} (aviso clasificado de Mercado Libre) y ese tipo de publicación no está soportado todavía. Cambia la categoría ML del producto a una de tipo Producto.`,
      );
    }
  }

  async searchCategories(q: string, type?: string) {
    if (!q?.trim()) return [];
    // Filtrado a categorías de producto normal por defecto: los avisos clasificados
    // (Vehículos/Inmuebles/Empleos/Servicios) no se pueden publicar desde esta app.
    type = type || 'PRODUCTO';
    try {
      const res = await fetch(
        `${ML_API}/sites/MLC/domain_discovery/search?q=${encodeURIComponent(q)}&limit=8`,
      );
      if (!res.ok) {
        this.logger.error(`ML category search HTTP ${res.status}`);
        return [];
      }
      const data = await res.json() as any[];
      let items = (Array.isArray(data) ? data : [])
        .filter((item: any) => item?.category_id)
        .map((item: any) => ({
          id: item.category_id,
          name: item.domain_name,
        }));

      if (type) {
        const classifiedIds = new Set(Object.values(CLASSIFIED_ROOT_IDS));
        const wantedRootId = type === 'PRODUCTO' ? null : CLASSIFIED_ROOT_IDS[type as Exclude<MlListingType, 'PRODUCTO'>];
        const tops = await Promise.all(items.map((it) => this.getCategoryTopId(it.id)));
        items = items.filter((_, i) => {
          const top = tops[i];
          return type === 'PRODUCTO' ? !top || !classifiedIds.has(top) : top === wantedRootId;
        });
      }

      return items;
    } catch (err) {
      this.logger.error('ML category search error', err);
      return [];
    }
  }

  // Navegación del árbol real de categorías de ML, paso a paso, como alternativa al
  // buscador de texto (que a veces no trae resultados útiles). Sin categoryId devuelve las
  // raíces (sin los rubros de aviso clasificado); con categoryId devuelve sus hijas y su
  // camino desde la raíz. isLeaf=true cuando ya no tiene subcategorías (queda seleccionable).
  async browseCategories(categoryId?: string) {
    if (!categoryId) {
      const classifiedIds = new Set(Object.values(CLASSIFIED_ROOT_IDS));
      return {
        id: null,
        name: null,
        path: [] as { id: string; name: string }[],
        children: MLC_ROOT_CATEGORIES.filter((r) => !classifiedIds.has(r.id)),
        isLeaf: false,
      };
    }

    const res = await fetch(`${ML_API}/categories/${categoryId}`);
    if (!res.ok) throw new BadRequestException('Categoría no encontrada');
    const data = await res.json() as any;
    const children = (data.children_categories || []).map((c: any) => ({ id: c.id, name: c.name }));
    return {
      id: data.id as string,
      name: data.name as string,
      path: ((data.path_from_root || []) as any[]).map((p) => ({ id: p.id, name: p.name })),
      children,
      isLeaf: children.length === 0,
    };
  }

  async getCategoryAttributes(categoryId: string) {
    try {
      const [attrsRes, catRes] = await Promise.all([
        fetch(`${ML_API}/categories/${categoryId}/attributes`),
        fetch(`${ML_API}/categories/${categoryId}`),
      ]);

      const attrsData = attrsRes.ok ? await attrsRes.json() as any[] : [];
      const catData = catRes.ok ? await catRes.json() as any : {};

      const settings = catData.settings || {};
      const supportsHtml = !!settings.allow_pictures_in_description;
      const maxTitleLength = Number(settings.max_title_length) || 60;

      const attributes = (Array.isArray(attrsData) ? attrsData : [])
        .filter((a: any) => a.tags?.required || a.tags?.catalog_required)
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          value_type: a.value_type,
          values: Array.isArray(a.values) && a.values.length > 0
            ? a.values.map((v: any) => ({ id: v.id, name: v.name }))
            : [],
          required: !!a.tags?.required,
          catalog_required: !!a.tags?.catalog_required,
        }));

      return { attributes, supportsHtml, maxTitleLength };
    } catch (err) {
      this.logger.error('ML category attributes error', err);
      return { attributes: [], supportsHtml: false, maxTitleLength: 60 };
    }
  }

  // Completa con una unidad de respaldo los atributos "number_unit" (MAX_HEIGHT, DEPTH,
  // WIDTH, WEIGHT, etc — varían según categoría) que quedaron con un valor puramente
  // numérico sin unidad. Mismo criterio que ya se usa para los SELLER_PACKAGE_* (cm/g),
  // pero aplicado a cualquier atributo de la categoría que ML tipifique como number_unit.
  private async withDefaultUnits(categoryId: string, attrs: Array<{ id: string; value_name?: string }>) {
    if (!attrs.length) return attrs;
    const { attributes } = await this.getCategoryAttributes(categoryId).catch(() => ({ attributes: [] as any[] }));
    const valueTypeById = new Map(attributes.map((a: any): [string, string] => [a.id, a.value_type]));
    const bareNumber = /^-?\d+(\.\d+)?$/;

    return attrs.map((attr) => {
      if (valueTypeById.get(attr.id) !== 'number_unit') return attr;
      const value = (attr.value_name ?? '').trim();
      if (!bareNumber.test(value)) return attr;
      const unit = /weight|peso/i.test(attr.id) ? 'g' : 'cm';
      return { ...attr, value_name: `${value} ${unit}` };
    });
  }

  private async upsertMlDescription(
    itemId: string,
    token: string,
    content: { plainText: string } | { html: string },
  ): Promise<string | null> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const body = 'html' in content ? { html: content.html } : { plain_text: content.plainText };
    const payload = JSON.stringify(body);
    this.logger.log(`ML upsertDescription [${itemId}]: ${payload.substring(0, 200)}`);

    for (const method of ['PUT', 'POST'] as const) {
      const res = await fetch(`${ML_API}/items/${itemId}/description`, {
        method, headers, body: payload,
      });
      const text = await res.text();
      this.logger.log(`ML description ${method} [${res.status}]: ${text.substring(0, 100)}`);

      if (res.ok) {
        try {
          const data = JSON.parse(text);
          // ML puede responder 200 pero no guardar nada; verificar que el campo enviado no
          // haya vuelto vacío.
          if ((data.plain_text && data.plain_text.trim()) || (data.html && data.html.trim())) return null;
          if (method === 'PUT') continue; // reintentar con POST
        } catch { return null; }
      }

      if (method === 'PUT' && (res.status === 404 || res.status === 405)) continue;

      try {
        const err = JSON.parse(text);
        return err.message || err.error || `HTTP ${res.status}`;
      } catch {
        return `HTTP ${res.status}`;
      }
    }
    return null;
  }

  // El listado multi-get de /items no trae la descripción (vive en un endpoint aparte);
  // se usa al importar publicaciones para poblar la Descripción detallada del producto
  // nuevo con lo que ya existe en Mercado Libre.
  private async fetchMlDescription(itemId: string, token: string): Promise<string | null> {
    try {
      const res = await fetch(`${ML_API}/items/${itemId}/description`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Antes esto quedaba en silencio (solo se logueaba una excepción de red) — sin
        // registrar el HTTP real no había forma de distinguir "ML no tiene descripción" de
        // "el token no tiene permiso" o un error transitorio de la API.
        const body = await res.text().catch(() => '');
        this.logger.warn(`ML fetchDescription [${itemId}] HTTP ${res.status}: ${body.substring(0, 200)}`);
        return null;
      }
      const data = await res.json() as any;
      const text = (data.plain_text || data.text || '').trim();
      if (!text) {
        this.logger.warn(`ML fetchDescription [${itemId}] sin plain_text/text en la respuesta: ${JSON.stringify(data).substring(0, 200)}`);
      }
      return text || null;
    } catch (err: any) {
      this.logger.warn(`ML fetchDescription [${itemId}] error: ${err?.message || err}`);
      return null;
    }
  }

  // ML enmascara el nombre/teléfono del comprador como "XXXXXXX" hasta que la dirección
  // queda "revelada" (normalmente al confirmar el pago) — nunca hay que guardar esto como
  // si fuera el dato real, ni al crear la orden ni al refrescarla después.
  private isMaskedMlValue(v: string | null | undefined): boolean {
    return !v || /^x+$/i.test(v.trim());
  }

  // Sin shipping.id = la venta no usa Mercado Envíos: la entrega se acuerda con el comprador.
  private isMlToAgree(order: any): boolean {
    return order?.shipping?.id == null;
  }

  // Nombre, teléfono, RUT y dirección del comprador sin depender del envío. Fuentes, de más a
  // menos confiable: la información de facturación de la orden (GET /orders/{id}/billing_info,
  // formato v2 con x-version: 2 y, si no, el v1 con additional_info) y el buyer de la orden.
  private async getMlBuyerContact(order: any, token: string): Promise<MlBuyerContact> {
    const out: MlBuyerContact = { name: null, phone: null, email: null, docType: null, docNumber: null, address: null, commune: null, region: null };
    const clean = (v: any) => {
      const t = v == null ? '' : String(v).trim();
      return t && !this.isMaskedMlValue(t) ? t : null;
    };
    const buyer = order.buyer || {};

    for (const version of ['2', null] as const) {
      try {
        const res = await fetch(`${ML_API}/orders/${order.id}/billing_info`, {
          headers: { Authorization: `Bearer ${token}`, ...(version ? { 'x-version': version } : {}) },
        });
        if (!res.ok) continue;
        const data = await res.json() as any;
        const bi = data?.buyer?.billing_info || data?.billing_info || data;
        // v2: { name, last_name, identification: { type, number }, address: { street_name, ... } }
        // v1: { doc_type, doc_number, additional_info: [{ type: 'FIRST_NAME', value }, ...] }
        const extra: Record<string, string> = {};
        for (const it of bi?.additional_info || []) if (it?.type) extra[String(it.type).toUpperCase()] = it.value;
        const addr = bi?.address || {};
        const name = [clean(bi?.name) ?? clean(extra.FIRST_NAME), clean(bi?.last_name) ?? clean(extra.LAST_NAME)].filter(Boolean).join(' ')
          || clean(extra.BUSINESS_NAME);
        out.name = out.name || name || null;
        out.docType = out.docType || clean(bi?.identification?.type) || clean(bi?.doc_type);
        out.docNumber = out.docNumber || clean(bi?.identification?.number) || clean(bi?.doc_number);
        const street = [clean(addr.street_name) ?? clean(extra.STREET_NAME), clean(addr.street_number) ?? clean(extra.STREET_NUMBER)].filter(Boolean).join(' ');
        const comment = clean(addr.comment) ?? clean(extra.COMMENT);
        out.address = out.address || [street, comment].filter(Boolean).join(', ') || null;
        out.commune = out.commune || clean(addr.city_name) || clean(addr.neighborhood) || clean(extra.CITY_NAME) || null;
        out.region = out.region || clean(addr.state?.name) || clean(addr.state_name) || clean(extra.STATE_NAME) || null;
        if (out.name && out.docNumber) break;
      } catch {
        /* se intenta con el otro formato / con el buyer de la orden */
      }
    }

    out.name = out.name || [clean(buyer.first_name), clean(buyer.last_name)].filter(Boolean).join(' ') || null;
    const phone = buyer.phone;
    const phoneText = phone ? [clean(phone.area_code), clean(phone.number)].filter(Boolean).join(' ') : '';
    out.phone = phoneText || null;
    out.email = clean(buyer.email);
    return out;
  }

  // Nota de gestión para una venta a acordar: cómo coordinar y el documento del comprador.
  private mlToAgreeNote(order: any, contact: MlBuyerContact): string {
    const parts = [
      `Entrega a acordar con el comprador (sin Mercado Envíos): coordínala por la mensajería de Mercado Libre — comprador ${order.buyer?.nickname || ''}.`.replace(' — comprador .', '.'),
      contact.docNumber ? `${contact.docType || 'Documento'}: ${contact.docNumber}` : null,
    ];
    return parts.filter(Boolean).join('\n');
  }

  // Texto que ve el comprador cuando escribió la descripción con el editor enriquecido
  // (mlDescription en HTML) pero la categoría actual ya no admite HTML — sin esto, las
  // etiquetas quedarían visibles como texto literal en la publicación.
  private stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Arma el contenido a enviar a /items/{id}/description: prioriza mlDescription (la
  // descripción escrita específicamente para Mercado Libre) sobre la descripción corta
  // interna y, en último caso, el nombre del producto — antes mlDescription se guardaba
  // pero nunca se usaba acá. Se manda como HTML solo si la categoría lo admite; si no,
  // se limpian las etiquetas y se manda como texto plano.
  private async resolveMlDescriptionContent(
    product: { description?: string | null; mlDescription?: string | null; name: string },
    mlCategoryId?: string | null,
  ): Promise<{ plainText: string } | { html: string }> {
    const raw = (product.mlDescription || product.description || product.name || '').trim();
    const safe = raw.length >= 10 ? raw : `${product.name}. ${product.name}. ${product.name}`;

    if (product.mlDescription && mlCategoryId) {
      const { supportsHtml } = await this.getCategoryAttributes(mlCategoryId).catch(() => ({ supportsHtml: false, attributes: [] }));
      if (supportsHtml) return { html: safe };
    }
    return { plainText: this.stripHtmlTags(safe) };
  }

  // ─── Publicaciones ───────────────────────────────────────────────────────────

  // Algunas categorías (según cuenta/cuándo se migró al modelo "User Products" de ML) exigen
  // mandar la garantía del producto en "sale_terms" del body de /items — si no se manda, ML
  // rechaza la publicación con el críptico "body does not contains ... [family_name]" en vez
  // de decir claramente que falta la garantía. Se consulta con el token de la conexión
  // porque, a diferencia de /categories/{id} y /attributes, este endpoint exige autenticación.
  async getSaleTerms(categoryId: string, connectionId: string, user: any) {
    await this.getConnectionForUser(connectionId, user);
    try {
      const token = await this.getValidToken(connectionId);
      const res = await fetch(`${ML_API}/categories/${categoryId}/sale_terms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as any[];
      return (Array.isArray(data) ? data : []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        valueType: t.value_type as string,
        required: !!t.tags?.required,
        values: Array.isArray(t.values) ? t.values.map((v: any) => ({ id: v.id, name: v.name })) : [],
      }));
    } catch (err) {
      this.logger.error('ML sale_terms fetch error', err);
      return [];
    }
  }

  async publishProduct(
    productId: string,
    connectionId: string,
    user: any,
    saleTerms?: { id: string; value_id?: string; value_name?: string }[],
    title?: string,
  ) {
    const product = await this.catalog.findOne(productId, user);
    // Título de esta cuenta: el elegido al publicar, si no el propio guardado, si no el nombre.
    const fullTitle = (title?.trim() || (product.listings || []).find((l: any) => l.connectionId === connectionId)?.title || product.name).trim();
    let accountTitle = fullTitle.slice(0, 60);
    await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const categoryId = (product as any).mlCategoryId || await this.settings.get('ML_DEFAULT_CATEGORY');
    if (!categoryId) {
      throw new BadRequestException(
        'Debes asignar una categoría de Mercado Libre al producto antes de publicar.',
      );
    }
    await this.assertPublishableCategory(categoryId);
    // Largo de título que admite la categoría (60 en muchas, 200 en otras).
    const { maxTitleLength } = await this.getCategoryAttributes(categoryId);
    accountTitle = fullTitle.slice(0, maxTitleLength || 60);

    const appUrl = await this.settings.get('APP_URL');
    const toAbsolute = (url: string) =>
      url.startsWith('http') ? url : `${appUrl}${url}`;

    // Algunas categorías (sin dato de paquete propio en el catálogo de ML) exigen estos 4
    // atributos para calcular el envío — si el producto no tiene sus dimensiones cargadas, se
    // manda un paquete genérico chico de respaldo para no bloquear la publicación.
    const DEFAULT_PACKAGE = { height: 15, width: 15, length: 10, weight: 500 }; // cm/cm/cm/g
    const p = product as any;
    const packageAttributes = [
      { id: 'SELLER_PACKAGE_HEIGHT', value_name: `${Number(p.packageHeight ?? DEFAULT_PACKAGE.height)} cm` },
      { id: 'SELLER_PACKAGE_WIDTH', value_name: `${Number(p.packageWidth ?? DEFAULT_PACKAGE.width)} cm` },
      { id: 'SELLER_PACKAGE_LENGTH', value_name: `${Number(p.packageLength ?? DEFAULT_PACKAGE.length)} cm` },
      { id: 'SELLER_PACKAGE_WEIGHT', value_name: `${Number(p.packageWeight ?? DEFAULT_PACKAGE.weight)} g` },
    ];

    const effectivePrice = await getEffectivePrice(this.prisma, productId, connectionId, Number(product.mlPrice ?? product.price));

    // ML exige unidad en los atributos "number_unit" (ej. MAX_HEIGHT, DEPTH, WIDTH en
    // categorías de muebles) — si el atributo quedó cargado solo con el número (ej. "15",
    // tipeado a mano o traído de un import viejo sin unidad), ML rechaza la publicación
    // completa en vez de solo ese atributo. Se completa con una unidad de respaldo en vez
    // de obligar a editar el atributo manualmente cada vez.
    const rawAttrs = await this.withDefaultUnits(categoryId, (product as any).mlAttributes || []);
    // Nunca se envía un GTIN de ejemplo o inválido: ML lo rechaza si la cuenta ya lo usó en
    // otra categoría. Sin GTIN válido se declara que el producto no tiene código registrado.
    const { attrs: cleanedAttrs, removed: removedGtins } = cleanGtinAttributes(rawAttrs);
    const userAttrs = removedGtins.length && !cleanedAttrs.some((a: any) => a.id === 'GTIN' || a.id === 'EMPTY_GTIN_REASON')
      ? [...cleanedAttrs, { id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]
      : cleanedAttrs;

    const mlItem = {
      title: accountTitle,
      category_id: categoryId,
      price: Math.round(effectivePrice),
      currency_id: 'CLP',
      available_quantity: product.stock,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      // Semilla inicial nada más — el envío real y definitivo de la descripción (con
      // soporte HTML si la categoría lo permite) ocurre después vía upsertMlDescription.
      description: { plain_text: this.stripHtmlTags((product.mlDescription || product.description || product.name || '').trim()) || product.name },
      // Todo el set de fotos del producto: la principal primero y luego en su orden
      // (Mercado Libre admite hasta 10 por publicación).
      pictures: [...product.images]
        .sort((a: any, b: any) => Number(b.isPrimary) - Number(a.isPrimary) || (a.order ?? 0) - (b.order ?? 0))
        .slice(0, 10)
        .map((img: any) => ({ source: toAbsolute(img.url) })),
      attributes: [
        { id: 'SELLER_SKU', value_name: product.sku },
        ...packageAttributes,
        ...userAttrs,
      ],
      ...(saleTerms?.length ? { sale_terms: saleTerms } : {}),
    };

    const attemptPublish = async (body: any) => {
      const r = await fetch(`${ML_API}/items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) return { ok: true as const, data: await r.json() as any };
      const err = await r.json() as any;
      this.logger.error('ML publish error', JSON.stringify(err));
      // Se arma con el detalle más específico disponible en cada "cause" (si no trae
      // message/reference/code legible, se manda el objeto completo en vez de perderlo) y,
      // si no hay cause, se combinan message + error (código corto tipo "body.invalid_fields")
      // en vez de mostrar solo uno — para no tener que adivinar la causa en la próxima vuelta.
      const causeMessages: string[] = Array.isArray(err.cause)
        ? err.cause.map((c: any) => c.message || c.reference || (c.code ? `${c.code}${c.data ? ` ${JSON.stringify(c.data)}` : ''}` : null) || JSON.stringify(c)).filter(Boolean)
        : [];
      const mlErrors = causeMessages.length
        ? causeMessages
        : [[err.message, err.error].filter(Boolean).join(' — ') || 'Error al publicar en Mercado Libre'];
      return { ok: false as const, mlErrors };
    };

    let lastBody: any = mlItem;
    let attempt = await attemptPublish(mlItem);
    // Cuentas migradas al modelo "Precio por Variación" (User Products) de ML exigen
    // "family_name" (el título de la "familia" del producto en ese modelo, no un nombre de
    // persona) en vez de "title" — mandar ambos juntos lo rechaza ML como campo inválido
    // ("title"), y mandar family_name siempre lo rechazan las cuentas que NO tienen ese
    // modelo activo. Por eso se reintenta reemplazando title por family_name solo si ML pide
    // específicamente family_name en el primer intento.
    if (!attempt.ok && attempt.mlErrors.some((m) => /family_name/i.test(m))) {
      const { title, ...itemWithoutTitle } = mlItem;
      const rawFamilyName = (product as any).mlFamilyName || product.name;
      // ML rechaza family_name de más de 60 caracteres — el nombre interno del catálogo
      // suele ser más descriptivo que un título de ML y fácilmente lo supera. Se recorta
      // en el último espacio antes del límite para no cortar una palabra a la mitad.
      const familyName = rawFamilyName.length > 60
        ? (rawFamilyName.slice(0, 60).replace(/\s+\S*$/, '') || rawFamilyName.slice(0, 60))
        : rawFamilyName;
      lastBody = { ...itemWithoutTitle, family_name: familyName };
      attempt = await attemptPublish(lastBody);
    }

    // ML rechaza un GTIN que la cuenta ya usó en una publicación de otra categoría (pasa con
    // códigos genéricos copiados entre productos, p. ej. 0012345678905). El GTIN no es parte
    // del producto en sí: se reintenta sin él, informando que no tiene código registrado.
    let gtinWarning: string | null = null;
    if (!attempt.ok && attempt.mlErrors.some((m) => /c[oó]digo universal|GTIN/i.test(m))) {
      const usedGtin = (lastBody.attributes || []).find((a: any) => a.id === 'GTIN')?.value_name;
      lastBody = {
        ...lastBody,
        attributes: [
          ...(lastBody.attributes || []).filter((a: any) => a.id !== 'GTIN' && a.id !== 'EMPTY_GTIN_REASON'),
          { id: 'EMPTY_GTIN_REASON', value_id: '17055160' }, // "El producto no tiene código registrado"
        ],
      };
      attempt = await attemptPublish(lastBody);
      if (attempt.ok) {
        gtinWarning = `Se publicó sin código universal${usedGtin ? ` (el GTIN ${usedGtin} ya está usado en otra categoría de esta cuenta)` : ''}.`;
      }
    }

    if (!attempt.ok) {
      const summary = attempt.mlErrors[0];
      await this.prisma.listing.upsert({
        where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
        update: { status: ListingStatus.ERROR, errorMsg: attempt.mlErrors.join(' | ') },
        create: { productId, connectionId, status: ListingStatus.ERROR, errorMsg: attempt.mlErrors.join(' | ') },
      });
      throw new BadRequestException({ message: summary, mlErrors: attempt.mlErrors });
    }

    const mlData = attempt.data;

    // Cuentas con "Precio por Variación" (User Products): ML crea el aviso solo con la primera
    // foto aunque se envíe el set completo. Se cargan todas apenas existe el aviso.
    const sentPictures: any[] = lastBody.pictures || [];
    if (mlData.id && sentPictures.length > (mlData.pictures?.length || 0)) {
      const pr = await fetch(`${ML_API}/items/${mlData.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pictures: sentPictures }),
      }).catch(() => null);
      if (!pr?.ok) this.logger.warn(`ML ${mlData.id}: no se pudieron cargar todas las fotos (${pr?.status ?? 'sin respuesta'})`);
    }
    // Título que quedó en ML (en cuentas con family_name, ML lo compone y puede ser más largo).
    const savedTitle = String(mlData.title || accountTitle).trim();

    // Enviar descripción siempre vía endpoint dedicado
    let descriptionWarning: string | null = null;
    if (mlData.id) {
      const descriptionContent = await this.resolveMlDescriptionContent(product, categoryId);
      const reason = await this.upsertMlDescription(mlData.id, token, descriptionContent);
      if (reason) {
        descriptionWarning = `Publicación creada, pero la descripción fue rechazada por ML (${reason}).`;
      }
    }

    const listing = await this.prisma.listing.upsert({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
      update: {
        externalId: mlData.id,
        externalUrl: mlData.permalink,
        status: ListingStatus.ACTIVE,
        syncedAt: new Date(),
        errorMsg: null,
        title: savedTitle !== product.name.trim() ? savedTitle : null,
      },
      create: {
        productId, connectionId,
        title: savedTitle !== product.name.trim() ? savedTitle : null,
        externalId: mlData.id,
        externalUrl: mlData.permalink,
        status: ListingStatus.ACTIVE,
        syncedAt: new Date(),
      },
    });

    return { ...listing, descriptionWarning: [gtinWarning, descriptionWarning].filter(Boolean).join(' ') || null };
  }

  private async syncListingCore(product: any, listing: any, token: string): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];

    const price = await getListingPrice(this.prisma, { productId: product.id, connectionId: listing.connectionId, price: listing.price }, Number(product.mlPrice ?? product.price));

    // Sincronizar precio y stock (ML no permite cambiar título de items activos)
    const itemRes = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price: Math.round(price),
        available_quantity: product.stock,
      }),
    });

    if (!itemRes.ok) {
      const err = await itemRes.json() as any;
      this.logger.error(`ML sync item error [${itemRes.status}]: ${JSON.stringify(err)}`);
      throw new BadRequestException(err.message || 'Error al sincronizar en Mercado Libre');
    }

    // Sincronizar descripción (prioriza la descripción para Mercado Libre, ver
    // resolveMlDescriptionContent)
    const descriptionContent = await this.resolveMlDescriptionContent(product, product.mlCategoryId);
    this.logger.log(`ML sync description [${listing.externalId}]: ${JSON.stringify(descriptionContent).substring(0, 120)}`);
    const descErr = await this.upsertMlDescription(listing.externalId, token, descriptionContent);
    if (descErr) warnings.push(`Descripción no sincronizada: ${descErr}`);

    return { warnings };
  }

  // listingId: una publicación puntual (p. ej. una adicional de la misma cuenta); si no, la principal.
  async syncStock(productId: string, connectionId: string, user: any, listingId?: string) {
    const product = await this.catalog.findOne(productId, user);
    await this.getConnectionForUser(connectionId, user);
    const listing = await this.findTargetListing(productId, connectionId, listingId);
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const token = await this.getValidToken(connectionId);
    const { warnings } = await this.syncListingCore(product, listing, token);

    const newStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
    const updated = await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: newStatus, syncedAt: new Date() },
    });

    return { ...updated, warnings };
  }

  // Dirección inversa de syncStock: trae los datos actuales de la publicación desde ML y
  // los copia hacia la ficha del producto (nombre, descripción, precio de referencia,
  // categoría/atributos, fotos y stock), en vez de empujar los datos locales hacia ML.
  // ─── Precio por cuenta de Mercado Libre ──────────────────────────────────────
  // Regla: un producto tiene UN precio base de ML (Product.mlPrice) que usan todas las cuentas,
  // salvo las que tengan precio propio (ChannelPrice). Al traer el precio de una publicación de
  // una cuenta: si el producto aún no tiene base (o solo está en esa cuenta) pasa a ser el base;
  // si ya tiene base y el precio es distinto, queda como precio propio de ESA cuenta — así
  // importar varias cuentas no pisa el precio de las otras.
  private async applyMlAccountPrice(client: any, productId: string, connectionId: string, price: number | null | undefined) {
    if (price == null || !(Number(price) > 0)) return;
    const product = await client.product.findUnique({ where: { id: productId }, select: { mlPrice: true } });
    const otherMlListings = await client.listing.count({
      where: { productId, connectionId: { not: connectionId }, connection: { marketplace: MarketplaceType.MERCADO_LIBRE } },
    });
    if (product?.mlPrice == null || otherMlListings === 0) {
      await client.product.update({ where: { id: productId }, data: { mlPrice: price } });
      await client.channelPrice.deleteMany({ where: { productId, connectionId } });
      return;
    }
    if (Math.round(Number(product.mlPrice)) === Math.round(Number(price))) {
      await client.channelPrice.deleteMany({ where: { productId, connectionId } });
    } else {
      await client.channelPrice.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { price },
        create: { productId, connectionId, price },
      });
    }
  }

  // Lee en ML el título, precio y ventas de cada publicación y deja el precio y título de cada
  // cuenta como en ML: igual al base (precio base ML / nombre del producto) = usa el base; distinto
  // = propio de esa cuenta. Solo lectura en ML: no cambia nada en las publicaciones. Sirve para
  // productos importados antes del precio/título por cuenta, donde la última cuenta importada
  // pisaba el precio base y el nombre. `titlesOnlySold`: solo corrige títulos de publicaciones
  // con ventas (ML no deja cambiarlos, así que el título real es el de ML).
  async recoverAccountData(user: any, opts: { companyId?: string; productId?: string; apply?: boolean; titlesOnlySold?: boolean }) {
    const listings = await this.prisma.listing.findMany({
      where: {
        externalId: { not: null },
        connection: { marketplace: MarketplaceType.MERCADO_LIBRE, active: true },
        product: { ...this.companyFilter(user, opts.companyId), ...(opts.productId ? { id: opts.productId } : {}) },
      },
      include: {
        connection: { select: { id: true, name: true } },
        product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true, channelPrices: { select: { connectionId: true, price: true } } } },
      },
      orderBy: [{ productId: 'asc' }, { slot: 'asc' }, { createdAt: 'asc' }],
    });

    // Lectura en ML por cuenta (lotes de 20).
    const items = new Map<string, any>();
    const byConn = new Map<string, string[]>();
    for (const l of listings) byConn.set(l.connectionId, [...(byConn.get(l.connectionId) || []), l.externalId!]);
    const connErrors: string[] = [];
    for (const [connId, ids] of byConn) {
      try {
        const token = await this.getValidToken(connId);
        for (const it of await this.fetchMlItems(Array.from(new Set(ids)), token)) items.set(it.id, it);
      } catch (err: any) {
        connErrors.push(`${listings.find((l) => l.connectionId === connId)?.connection.name}: ${err.message}`);
      }
    }

    type Change = {
      productId: string; listingId: string; slot: number; sku: string; name: string; connection: string; connectionId: string; externalId: string; sold: number;
      mlTitle: string; mlPrice: number; priceBefore: number; priceAfter: number; priceOwn: boolean; titleBefore: string; titleOwn: boolean;
      changed: boolean;
    };
    const rows: Change[] = [];
    const baseSet = new Map<string, number>(); // productId → precio base que se fija (si no tenía)
    // Precio propio de la cuenta tras procesar su publicación principal (para las adicionales).
    const accountOwn = new Map<string, number | null>();
    for (const l of listings) {
      const it = items.get(l.externalId!);
      if (!it) continue;
      const p = l.product;
      const mlTitle = String(it.title || '').trim();
      const mlPrice = Number(it.price);
      const sold = Number(it.sold_quantity || 0);
      const own = p.channelPrices.find((cp) => cp.connectionId === l.connectionId);
      let base = p.mlPrice != null ? Number(p.mlPrice) : baseSet.get(p.id);
      if (base == null && mlPrice > 0) { base = mlPrice; baseSet.set(p.id, mlPrice); }
      const accKey = `${p.id}|${l.connectionId}`;
      const accountPrice = accountOwn.has(accKey) ? accountOwn.get(accKey) : own ? Number(own.price) : null;
      const extra = l.slot > 0;
      // Publicación principal: precio de la cuenta (ChannelPrice) vs precio base. Adicional:
      // precio propio de la publicación (Listing.price) vs precio de su cuenta.
      const ref = extra ? (accountPrice ?? base) : base;
      const stored = extra ? (l.price != null ? Number(l.price) : null) : (own ? Number(own.price) : null);
      const priceBefore = extra
        ? (l.price != null ? Number(l.price) : Number(accountPrice ?? p.mlPrice ?? p.price))
        : (own ? Number(own.price) : Number(p.mlPrice ?? p.price));
      const wantOwnPrice = mlPrice > 0 && ref != null && Math.round(mlPrice) !== Math.round(ref) ? mlPrice : null;
      const priceChanged = !opts.titlesOnlySold && mlPrice > 0
        && ((wantOwnPrice == null) !== (stored == null) || (wantOwnPrice != null && stored != null && Math.round(stored) !== Math.round(wantOwnPrice)));
      if (!extra) accountOwn.set(accKey, opts.titlesOnlySold ? (own ? Number(own.price) : null) : wantOwnPrice);
      const titleBefore = (l.title || p.name).trim();
      const wantTitle = mlTitle && mlTitle !== p.name.trim() ? mlTitle : null;
      const titleChanged = !!mlTitle && (!opts.titlesOnlySold || sold > 0) && (wantTitle ?? null) !== (l.title ? l.title.trim() : null);

      if (opts.apply) {
        if (priceChanged && extra) {
          await this.prisma.listing.update({ where: { id: l.id }, data: { price: wantOwnPrice } });
        } else if (priceChanged) {
          if (wantOwnPrice == null) await this.prisma.channelPrice.deleteMany({ where: { productId: p.id, connectionId: l.connectionId } });
          else await this.prisma.channelPrice.upsert({
            where: { productId_connectionId: { productId: p.id, connectionId: l.connectionId } },
            update: { price: wantOwnPrice }, create: { productId: p.id, connectionId: l.connectionId, price: wantOwnPrice },
          });
        }
        if (titleChanged) await this.prisma.listing.update({ where: { id: l.id }, data: { title: wantTitle } });
      }
      rows.push({
        productId: p.id, listingId: l.id, slot: l.slot, sku: p.sku, name: p.name, connection: l.connection.name, connectionId: l.connectionId, externalId: l.externalId!, sold,
        mlTitle, mlPrice, priceBefore, priceAfter: mlPrice > 0 ? mlPrice : priceBefore, priceOwn: wantOwnPrice != null,
        titleBefore, titleOwn: wantTitle != null, changed: priceChanged || titleChanged || (baseSet.has(p.id) && !opts.titlesOnlySold),
      });
    }
    if (opts.apply && !opts.titlesOnlySold) {
      for (const [productId, price] of baseSet) await this.prisma.product.update({ where: { id: productId }, data: { mlPrice: price } });
    }
    return {
      applied: !!opts.apply, checked: rows.length, affected: rows.filter((r) => r.changed).length,
      changes: opts.productId ? rows : rows.filter((r) => r.changed), errors: connErrors,
    };
  }

  // Publicaciones duplicadas: una misma publicación de ML (MLC…, y variación) vinculada más de una
  // vez en la empresa (en otra tienda o a otro producto). Se conserva un solo vínculo: el de una
  // tienda activa (si hay varias activas, la que tenga autorizada la cuenta dueña del ítem; si no
  // se puede saber, se deja para revisión manual) y se eliminan los demás vínculos. Los productos
  // no se tocan: los que queden sin publicaciones se informan para unificarlos o desactivarlos.
  async reviewDuplicateListings(user: any, opts: { companyId?: string; apply?: boolean; limit?: number }) {
    const listings = await this.prisma.listing.findMany({
      where: {
        externalId: { not: null },
        connection: { marketplace: MarketplaceType.MERCADO_LIBRE, ...this.companyFilter(user, opts.companyId) },
      },
      select: {
        id: true, externalId: true, variationId: true, productId: true, createdAt: true,
        connection: { select: { id: true, name: true, active: true, companyId: true, mlUserId: true } },
        product: { select: { sku: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const groups = new Map<string, typeof listings>();
    for (const l of listings) {
      const key = `${l.connection.companyId}|${l.externalId}|${l.variationId || ''}`;
      groups.set(key, [...(groups.get(key) || []), l]);
    }
    const dupGroups = Array.from(groups.values()).filter((g) => g.length > 1);

    // Dueño real del ítem (seller_id) solo cuando hay más de una tienda activa en el grupo.
    const ambiguous = dupGroups.filter((g) => new Set(g.filter((l) => l.connection.active).map((l) => l.connection.id)).size > 1);
    const sellerOf = new Map<string, string>();
    if (ambiguous.length) {
      const byConn = new Map<string, string[]>();
      for (const g of ambiguous) for (const l of g) if (l.connection.active) byConn.set(l.connection.id, [...(byConn.get(l.connection.id) || []), l.externalId!]);
      for (const [connId, ids] of byConn) {
        try {
          const token = await this.getValidToken(connId);
          for (let i = 0; i < ids.length; i += 20) {
            const chunk = [...new Set(ids)].slice(i, i + 20);
            const res = await fetch(`${ML_API}/items?ids=${chunk.join(',')}&attributes=id,seller_id`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
            if (!res?.ok) continue;
            for (const r of (await res.json()) as any[]) if (r?.code === 200) sellerOf.set(String(r.body.id), String(r.body.seller_id));
          }
        } catch { /* sin token: queda para revisión manual */ }
      }
    }

    const result: {
      externalId: string; keep: { store: string; sku: string } | null; remove: { store: string; sku: string }[]; reason?: string;
    }[] = [];
    const removeIds: string[] = [];
    const plan: { keepProductId: string; removeIds: string[]; removeProductIds: string[] }[] = [];
    for (const g of dupGroups) {
      const active = g.filter((l) => l.connection.active);
      let keep: (typeof g)[number] | undefined;
      if (active.length === 1) keep = active[0];
      else if (active.length > 1) {
        const owners = active.filter((l) => l.connection.mlUserId && sellerOf.get(l.externalId!) === l.connection.mlUserId);
        const ownerConns = new Set(owners.map((l) => l.connection.id));
        if (ownerConns.size === 1) keep = owners[0];
        else if (new Set(active.map((l) => l.connection.id)).size === 1) keep = active[0]; // misma tienda, distinto producto
      } else keep = g[0];
      if (!keep) {
        result.push({ externalId: g[0].externalId!, keep: null, remove: [], reason: 'Varias tiendas activas y no se pudo saber cuál es la dueña: revisar a mano' });
        continue;
      }
      const remove = g.filter((l) => l.id !== keep!.id);
      removeIds.push(...remove.map((l) => l.id));
      plan.push({ keepProductId: keep.productId, removeIds: remove.map((l) => l.id), removeProductIds: [...new Set(remove.map((l) => l.productId))] });
      result.push({
        externalId: keep.externalId!,
        keep: { store: keep.connection.name, sku: keep.product.sku },
        remove: remove.map((l) => ({ store: l.connection.name, sku: l.product.sku })),
      });
    }

    // Productos que quedarían sin ninguna publicación (duplicados del que se conserva).
    const affectedProducts = [...new Set(listings.filter((l) => removeIds.includes(l.id)).map((l) => l.productId))];
    const stillListed = await this.prisma.listing.findMany({
      where: { productId: { in: affectedProducts }, id: { notIn: removeIds } }, select: { productId: true },
    });
    const listedSet = new Set(stillListed.map((l) => l.productId));
    const orphanProducts = affectedProducts.filter((id) => !listedSet.has(id)).length;

    // Aplicar por tandas (cada llamada procesa hasta `limit` publicaciones duplicadas): se borra el
    // vínculo duplicado y, si su producto queda sin publicaciones, se unifica con el producto que
    // se conserva (mismo artículo): su historial pasa a ese producto y el duplicado se elimina. Se
    // conservan todos los datos del producto que se conserva y no se envía nada a los marketplaces.
    let processed = 0, linksRemoved = 0, productsMerged = 0;
    const mergeErrors: string[] = [];
    if (opts.apply) {
      const limit = Math.max(1, Math.min(opts.limit ?? 100, 300));
      for (const step of plan.slice(0, limit)) {
        await this.prisma.listing.deleteMany({ where: { id: { in: step.removeIds } } }); // imágenes: en cascada
        linksRemoved += step.removeIds.length;
        for (const productId of step.removeProductIds) {
          if (productId === step.keepProductId) continue;
          const left = await this.prisma.listing.count({ where: { productId } });
          if (left > 0) continue;
          const keeper = await this.prisma.product.findUnique({ where: { id: step.keepProductId }, select: { id: true, dropshipProduct: { select: { id: true } } } });
          const loser = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, sku: true, dropshipProduct: { select: { id: true } } } });
          if (!keeper || !loser) continue;
          try {
            await this.catalog.mergeProducts({
              productIds: [keeper.id, loser.id], survivorId: keeper.id,
              fieldSources: Object.fromEntries(MERGE_FIELD_KEYS.map((k) => [k, keeper.id])) as any,
              imagesFromProductId: keeper.id,
              dropshipFromProductId: keeper.dropshipProduct ? keeper.id : loser.dropshipProduct ? loser.id : null,
            } as any, user, { quiet: true });
            productsMerged++;
          } catch (err: any) {
            mergeErrors.push(`${loser.sku}: ${err.message}`);
          }
        }
        processed++;
      }
      this.logger.log(`Publicaciones duplicadas: ${processed} grupos, ${linksRemoved} vínculos borrados, ${productsMerged} productos unificados.`);
    }
    return {
      applied: !!opts.apply,
      groups: dupGroups.length, linksToRemove: removeIds.length, manual: result.filter((r) => !r.keep).length,
      orphanProducts, sample: result.slice(0, 200),
      processed, linksRemoved, productsMerged, mergeErrors, remaining: Math.max(0, plan.length - processed),
    };
  }

  // Datos en vivo de cada cuenta para la tarjeta "Precios y títulos por cuenta": título, precio y
  // ventas en ML. Las publicaciones con ventas quedan con el título que tienen en ML.
  async getMlAccountInfo(productId: string, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { companyId: true } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();
    const r = await this.recoverAccountData(user, { companyId: product.companyId, productId, apply: true, titlesOnlySold: true });
    return r.changes.map((c) => ({ listingId: c.listingId, slot: c.slot, connectionId: c.connectionId, mlTitle: c.mlTitle, mlPrice: c.mlPrice, sold: c.sold }));
  }

  // Guarda el precio base de ML y el de cada cuenta (null = usa el base) y lo envía de inmediato
  // a las publicaciones activas/pausadas de esas cuentas.
  async setMlAccountPrices(productId: string, dto: {
    basePrice?: number | null;
    accounts: { connectionId: string; price: number | null; title?: string | null }[];
    // Publicaciones adicionales de una misma cuenta (slot > 0): precio y título propios.
    publications?: { listingId: string; price: number | null; title?: string | null }[];
  }, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();
    const connIds = (dto.accounts || []).map((a) => a.connectionId);
    const conns = await this.prisma.marketplaceConnection.findMany({
      where: { id: { in: connIds }, companyId: product.companyId, marketplace: MarketplaceType.MERCADO_LIBRE },
      select: { id: true },
    });
    if (conns.length !== connIds.length) throw new BadRequestException('Alguna cuenta no es de Mercado Libre de esta empresa.');
    const pubs = dto.publications || [];
    if (pubs.length) {
      const owned = await this.prisma.listing.count({ where: { id: { in: pubs.map((x) => x.listingId) }, productId } });
      if (owned !== pubs.length) throw new BadRequestException('Alguna publicación no pertenece a este producto.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const pub of pubs) {
        await tx.listing.update({ where: { id: pub.listingId }, data: { price: pub.price != null && Number(pub.price) > 0 ? pub.price : null } });
      }
      if (dto.basePrice !== undefined) {
        await tx.product.update({ where: { id: productId }, data: { mlPrice: dto.basePrice != null && dto.basePrice > 0 ? dto.basePrice : null } });
      }
      for (const a of dto.accounts || []) {
        if (a.price == null || !(Number(a.price) > 0)) {
          await tx.channelPrice.deleteMany({ where: { productId, connectionId: a.connectionId } });
        } else {
          await tx.channelPrice.upsert({
            where: { productId_connectionId: { productId, connectionId: a.connectionId } },
            update: { price: a.price },
            create: { productId, connectionId: a.connectionId, price: a.price },
          });
        }
      }
    });

    // Título por cuenta (title undefined = no se toca; null/vacío = usa el nombre del producto).
    // Solo aplica a cuentas con publicación; si cambió, se intenta actualizar en ML (ML no deja
    // cambiar el título de una publicación que ya tiene ventas: se informa como error).
    const titleResults: { connection: string; ok: boolean; error?: string }[] = [];
    const titleJobs: { where: any; title: string | null | undefined }[] = [
      ...(dto.accounts || []).map((a) => ({ where: { productId_connectionId_slot: { productId, connectionId: a.connectionId, slot: 0 } }, title: a.title })),
      ...pubs.map((x) => ({ where: { id: x.listingId }, title: x.title })),
    ];
    for (const a of titleJobs) {
      if (a.title === undefined) continue;
      const l = await this.prisma.listing.findUnique({ where: a.where, include: { connection: { select: { name: true } } } });
      if (!l) continue;
      const wanted = String(a.title ?? '').trim();
      const newTitle = wanted && wanted !== String(product.name).trim() ? wanted : null;
      const before = (l.title || product.name).trim();
      const after = (newTitle || product.name).trim();
      await this.prisma.listing.update({ where: { id: l.id }, data: { title: newTitle } });
      if (before === after || !l.externalId || !([ListingStatus.ACTIVE, ListingStatus.PAUSED] as ListingStatus[]).includes(l.status)) continue;
      const token = await this.getValidToken(l.connectionId).catch(() => null);
      const [current] = token ? await this.fetchMlItems([l.externalId], token) : [];
      const keepMlTitle = async () => {
        const t = String(current?.title || '').trim();
        if (t) await this.prisma.listing.update({ where: { id: l.id }, data: { title: t !== String(product.name).trim() ? t : null } });
      };
      if (Number(current?.sold_quantity || 0) > 0) {
        await keepMlTitle();
        titleResults.push({ connection: l.connection.name, ok: false, error: 'título: la publicación tiene ventas y Mercado Libre no permite cambiarlo; se mantiene el título de la publicación' });
        continue;
      }
      try {
        if (!token) throw new Error('sin token de la cuenta');
        const res = await fetch(`${ML_API}/items/${l.externalId}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: after }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as any;
          const causes = Array.isArray(err.cause) ? err.cause.map((c: any) => c.message).filter(Boolean).join('; ') : '';
          throw new Error(causes || err.message || `HTTP ${res.status}`);
        }
        titleResults.push({ connection: l.connection.name, ok: true });
      } catch (err: any) {
        await keepMlTitle();
        titleResults.push({ connection: l.connection.name, ok: false, error: `título: ${err.message} (se mantiene el título de la publicación)` });
      }
    }

    // Envía el precio vigente a cada publicación de ML del producto.
    const fresh = await this.prisma.product.findUnique({ where: { id: productId } });
    const base = Number(fresh!.mlPrice ?? fresh!.price);
    const listings = await this.prisma.listing.findMany({
      where: { productId, externalId: { not: null }, status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] }, connection: { marketplace: MarketplaceType.MERCADO_LIBRE } },
      include: { connection: { select: { name: true } } },
    });
    const results: { connection: string; price: number; ok: boolean; error?: string }[] = [];
    for (const l of listings) {
      const price = Math.round(await getListingPrice(this.prisma, l, base));
      try {
        const token = await this.getValidToken(l.connectionId);
        const res = await fetch(`${ML_API}/items/${l.externalId}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ price }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as any;
          throw new Error(err.message || `HTTP ${res.status}`);
        }
        await this.prisma.listing.update({ where: { id: l.id }, data: { syncedAt: new Date(), errorMsg: null } });
        results.push({ connection: l.connection.name, price, ok: true });
      } catch (err: any) {
        await this.prisma.listing.update({ where: { id: l.id }, data: { errorMsg: err.message } }).catch(() => {});
        results.push({ connection: l.connection.name, price, ok: false, error: err.message });
      }
    }
    return { basePrice: fresh!.mlPrice != null ? Number(fresh!.mlPrice) : null, pushed: results, titles: titleResults };
  }

  async pullProductFromMl(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    await this.getConnectionForUser(connectionId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
    });
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const token = await this.getValidToken(connectionId);
    const [item] = await this.fetchMlItems([listing.externalId], token);
    if (!item) throw new BadRequestException('No se pudo obtener la publicación desde Mercado Libre');

    const mlDesc = await this.fetchMlDescription(listing.externalId, token);
    const additionalAttrs = this.extractAdditionalAttributes(item.attributes);
    const newStock = typeof item.available_quantity === 'number' ? item.available_quantity : product.stock;
    const stockDelta = newStock - product.stock;

    // Con varias cuentas de ML el nombre del producto es el título base: el título de esta
    // publicación queda como título propio de la cuenta (si es distinto) en vez de pisar el nombre.
    const otherMlListings = await this.prisma.listing.count({
      where: { productId, connectionId: { not: connectionId }, connection: { marketplace: MarketplaceType.MERCADO_LIBRE } },
    });
    const pulledTitle = String(item.title || '').trim();
    const baseName = otherMlListings === 0 && pulledTitle ? pulledTitle : String(product.name).trim();
    await this.prisma.listing.update({
      where: { id: listing.id }, data: { title: pulledTitle && pulledTitle !== baseName ? pulledTitle : null },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ...(otherMlListings === 0 && item.title ? { name: item.title } : {}),
          description: mlDesc || product.description,
          // Antes se ponía en null si fetchMlDescription fallaba (timeout, permiso, ML sin
          // devolver plain_text/text) — cada resincronización fallida borraba silenciosamente
          // la descripción ya guardada en vez de dejarla intacta.
          mlDescription: mlDesc || (product as any).mlDescription || null,
          mlCategoryId: item.category_id || null,
          mlFamilyName: item.family_name || null,
          mlAttributes: additionalAttrs.length ? additionalAttrs : undefined,
        },
      });
      // Precio de ESTA cuenta: base si es la única cuenta (o no hay base), si no precio propio.
      await this.applyMlAccountPrice(tx, productId, connectionId, item.price);
      // El stock que trae ML se aplica como ajuste en la bodega del producto (kardex).
      if (stockDelta !== 0) {
        await this.ledger.move(tx, {
          productId, delta: stockDelta, type: MovementType.ADJUSTMENT,
          reason: `Sincronizado desde Mercado Libre (${listing.externalId})`,
          userId: user.id, reference: { type: 'ADJUSTMENT' },
        });
      }
    });

    const pictures: Array<{ secure_url?: string; url?: string }> = Array.isArray(item.pictures) && item.pictures.length
      ? item.pictures
      : (item.secure_thumbnail || item.thumbnail ? [{ url: item.secure_thumbnail || item.thumbnail }] : []);

    if (pictures.length) {
      await this.prisma.productImage.deleteMany({ where: { productId } });
      for (let i = 0; i < pictures.length; i++) {
        const url = pictures[i].secure_url || pictures[i].url;
        if (!url) continue;
        await this.prisma.productImage.create({
          data: { productId, filename: `${listing.externalId}-${i}.jpg`, url, isPrimary: i === 0, order: i },
        });
      }
    }

    await this.prisma.listing.update({ where: { id: listing.id }, data: { syncedAt: new Date() } });

    if (stockDelta !== 0) this.sync.syncProduct(productId, newStock).catch(() => {});

    return this.catalog.findOne(productId, user);
  }

  async syncAllListings(productId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const listings = await this.prisma.listing.findMany({
      where: {
        productId,
        externalId: { not: null },
        status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] },
        connection: { marketplace: 'MERCADO_LIBRE' },
      },
      include: { connection: { select: { id: true, name: true } } },
    });

    if (!listings.length) {
      throw new BadRequestException('Este producto no tiene publicaciones activas en Mercado Libre.');
    }

    const results: Array<{ connectionId: string; connectionName: string; success: boolean; warnings: string[]; error: string | null }> = [];

    for (const listing of listings) {
      try {
        const token = await this.getValidToken(listing.connectionId);
        const { warnings } = await this.syncListingCore(product, listing, token);
        const newStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { status: newStatus, syncedAt: new Date() },
        });
        results.push({ connectionId: listing.connectionId, connectionName: listing.connection.name, success: true, warnings, error: null });
      } catch (err: any) {
        results.push({ connectionId: listing.connectionId, connectionName: listing.connection.name, success: false, warnings: [], error: err.message || 'Error desconocido' });
      }
    }

    return {
      syncedCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      results,
    };
  }

  async syncProductListings(productId: string, newStock: number) {
    const listings = await this.prisma.listing.findMany({
      where: { productId, status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] } },
    });
    if (!listings.length) return;

    for (const listing of listings) {
      if (!listing.externalId) continue;
      try {
        const token = await this.getValidToken(listing.connectionId);
        const newMlStatus = newStock === 0 ? 'paused' : 'active';
        await fetch(`${ML_API}/items/${listing.externalId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ available_quantity: newStock, status: newMlStatus }),
        });
        const newStatus = newStock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { status: newStatus, syncedAt: new Date() },
        });
        this.logger.log(`ML post-venta: item=${listing.externalId} stock=${newStock} status=${newMlStatus}`);
      } catch (err) {
        this.logger.error(`ML post-venta sync error listing=${listing.id}`, err);
      }
    }
  }

  async toggleListingStatus(productId: string, connectionId: string, user: any, listingId?: string) {
    const product = await this.catalog.findOne(productId, user);
    await this.getConnectionForUser(connectionId, user);
    const listing = await this.findTargetListing(productId, connectionId, listingId);
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const isActive = listing.status === ListingStatus.ACTIVE;
    const newMlStatus = isActive ? 'paused' : 'active';

    if (!isActive && product.stock === 0) {
      throw new BadRequestException('No se puede activar la publicación: el producto no tiene stock.');
    }

    const token = await this.getValidToken(connectionId);
    const res = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newMlStatus }),
    });

    if (!res.ok) {
      const err = await res.json() as any;
      throw new BadRequestException(err.message || `Error al ${isActive ? 'pausar' : 'activar'} en Mercado Libre`);
    }

    const newStatus = newMlStatus === 'active' ? ListingStatus.ACTIVE : ListingStatus.PAUSED;
    return this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: newStatus, syncedAt: new Date() },
    });
  }

  // Publicación sobre la que actúa una acción: la indicada (debe ser de ese producto y cuenta) o
  // la principal de la cuenta.
  private async findTargetListing(productId: string, connectionId: string, listingId?: string) {
    if (!listingId) {
      return this.prisma.listing.findUnique({ where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } } });
    }
    const l = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!l || l.productId !== productId || l.connectionId !== connectionId) throw new NotFoundException('Publicación no encontrada');
    return l;
  }

  // ─── Importación de publicaciones existentes ─────────────────────────────────

  private async getConnectionForUser(connectionId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return conn;
  }

  private extractSku(attributes: any[]): string | null {
    const attr = Array.isArray(attributes) ? attributes.find((a) => a.id === 'SELLER_SKU') : null;
    const value = attr?.value_name?.trim();
    return value || null;
  }

  // Dimensiones/peso de paquete que la publicación de origen ya tenía cargadas (atributos
  // SELLER_PACKAGE_*, formato "15 cm" / "500 g") — se rescatan al importar para no obligar
  // al usuario a volver a tipearlas si luego se republica el producto.
  private parsePackageDimensions(attributes: any[]): {
    packageHeight?: number; packageWidth?: number; packageLength?: number; packageWeight?: number;
  } {
    if (!Array.isArray(attributes)) return {};
    const find = (id: string) => attributes.find((a) => a.id === id);
    const parseNum = (attr: any): number | undefined => {
      const raw = attr?.value_name;
      if (raw == null) return undefined;
      const num = parseFloat(String(raw));
      return Number.isFinite(num) ? num : undefined;
    };
    const result: { packageHeight?: number; packageWidth?: number; packageLength?: number; packageWeight?: number } = {};
    const height = parseNum(find('SELLER_PACKAGE_HEIGHT'));
    const width = parseNum(find('SELLER_PACKAGE_WIDTH'));
    const length = parseNum(find('SELLER_PACKAGE_LENGTH'));
    const weight = parseNum(find('SELLER_PACKAGE_WEIGHT'));
    if (height !== undefined) result.packageHeight = height;
    if (width !== undefined) result.packageWidth = width;
    if (length !== undefined) result.packageLength = length;
    if (weight !== undefined) result.packageWeight = weight;
    return result;
  }

  // Atributos propios de la categoría (color, material, modelo, etc.) que la publicación
  // de origen ya tenía, excluyendo SKU y paquete (que se guardan en columnas propias) —
  // se guardan tal cual para reenviarlos si el producto se vuelve a publicar.
  // Medio de pago de una orden de ML (siempre procesado por Mercado Pago): tipo + medio,
  // p. ej. "Mercado Pago · Tarjeta de crédito (visa)". Usa el primer pago aprobado.
  private mlPaymentLabel(order: any): string | null {
    const payments: any[] = Array.isArray(order?.payments) ? order.payments : [];
    const p = payments.find((x) => x?.status === 'approved') || payments[0];
    if (!p) return null;
    const TYPES: Record<string, string> = {
      credit_card: 'Tarjeta de crédito', debit_card: 'Tarjeta de débito', prepaid_card: 'Tarjeta prepago',
      account_money: 'Dinero en cuenta', ticket: 'Pago en efectivo', bank_transfer: 'Transferencia',
      atm: 'Cajero', digital_currency: 'Mercado Crédito', digital_wallet: 'Billetera digital',
    };
    const type = TYPES[p.payment_type] || (p.payment_type ? String(p.payment_type).replace(/_/g, ' ') : '');
    const method = p.payment_method_id && !['account_money', p.payment_type].includes(p.payment_method_id) ? ` (${p.payment_method_id})` : '';
    const installments = Number(p.installments) > 1 ? ` en ${p.installments} cuotas` : '';
    return `Mercado Pago${type ? ` · ${type}${method}${installments}` : ''}`;
  }

  private extractAdditionalAttributes(attributes: any[]): Array<{ id: string; value_name?: string; value_id?: string }> {
    if (!Array.isArray(attributes)) return [];
    const excluded = new Set([
      'SELLER_SKU', 'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT',
    ]);
    const attrs = attributes
      .filter((a) => a?.id && !excluded.has(a.id) && (a.value_name || a.value_id))
      .map((a) => ({ id: a.id, value_name: a.value_name, ...(a.value_id ? { value_id: a.value_id } : {}) }));
    // Los GTIN de ejemplo o inválidos (p. ej. 0012345678905) no se guardan en el producto.
    return cleanGtinAttributes(attrs).attrs;
  }

  // El ID de publicación de ML (item.id) es solo un identificador externo y se guarda
  // como externalId del Listing. Nunca debe usarse como SKU: cuando la publicación no
  // trae SELLER_SKU, se genera un SKU correlativo por empresa, editable luego por el usuario.
  private async nextSku(companyId: string): Promise<string> {
    let n = (await this.prisma.product.count({ where: { companyId } })) + 1;
    let sku = `SKU-${String(n).padStart(6, '0')}`;
    while (
      await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } })
    ) {
      n++;
      sku = `SKU-${String(n).padStart(6, '0')}`;
    }
    return sku;
  }

  private async fetchMlItems(itemIds: string[], token: string): Promise<any[]> {
    const attrs = 'id,title,price,available_quantity,sold_quantity,thumbnail,secure_thumbnail,permalink,status,category_id,attributes,pictures,family_name';
    const items: any[] = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      try {
        const res = await fetch(
          `${ML_API}/items?ids=${batch.join(',')}&attributes=${attrs}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          this.logger.warn(`ML items batch fetch HTTP ${res.status}, se omite este lote`);
          continue;
        }
        const data = await res.json() as any[];
        for (const entry of data) {
          if (entry.code === 200 && entry.body) items.push(entry.body);
        }
      } catch (err: any) {
        this.logger.warn(`ML items batch fetch error, se omite este lote: ${err?.message || err}`);
      }
    }
    return items;
  }

  async previewImport(connectionId: string, user: any, scrollId?: string) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    try {
      const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!meRes.ok) throw new BadRequestException('No se pudo obtener el usuario de Mercado Libre');
      const me = await meRes.json() as any;

      // Catálogos grandes (>1000) requieren la API de "scan" de ML, que pagina por
      // cursor (scroll_id) en vez de offset, sin techo de resultados totales.
      const PAGES_PER_BATCH = 3; // 3 x 100 = hasta 300 publicaciones por llamada
      const itemIds: string[] = [];
      let currentScrollId = scrollId;
      let total = 0;
      let lastPageEmpty = false;

      for (let i = 0; i < PAGES_PER_BATCH; i++) {
        const params = new URLSearchParams({ search_type: 'scan', limit: '100' });
        if (currentScrollId) params.set('scroll_id', currentScrollId);
        const searchRes = await fetch(
          `${ML_API}/users/${me.id}/items/search?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!searchRes.ok) {
          const errBody = await searchRes.text();
          this.logger.error(`ML items scan failed [${searchRes.status}]: ${errBody}`);
          throw new BadRequestException(
            `Mercado Libre rechazó la búsqueda de publicaciones (HTTP ${searchRes.status}). Revisa los logs del backend para más detalle.`,
          );
        }
        const searchData = await searchRes.json() as any;
        total = searchData.paging?.total || total;
        currentScrollId = searchData.scroll_id;
        const pageResults: string[] = searchData.results || [];
        itemIds.push(...pageResults);
        if (pageResults.length === 0) { lastPageEmpty = true; break; }
      }

      const nextScrollId = currentScrollId || null;
      const hasMore = !lastPageEmpty && !!nextScrollId;

      const mlItems = await this.fetchMlItems(itemIds, token);

      const skus = mlItems.map((i) => this.extractSku(i.attributes)).filter((s): s is string => !!s);
      // Un SKU que se repite en 2+ publicaciones DISTINTAS de este mismo lote es señal de
      // que el vendedor usó un SKU genérico/reutilizado (ej. un código de barras "relleno")
      // en vez de uno propio por producto — no es confiable para vincular automáticamente.
      const skuCounts = new Map<string, number>();
      for (const sku of skus) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);

      const [existingProducts, existingListings] = await Promise.all([
        this.prisma.product.findMany({
          where: { companyId: conn.companyId, sku: { in: skus } },
          select: { id: true, sku: true, name: true },
        }),
        // Una publicación de ML (MLC…) es única en todo el sitio: si ya está vinculada en
        // cualquier tienda de ML de la empresa, ya está importada y no se vuelve a traer.
        this.prisma.listing.findMany({
          where: {
            externalId: { in: mlItems.map((i) => i.id) },
            connection: { companyId: conn.companyId, marketplace: MarketplaceType.MERCADO_LIBRE },
          },
          select: { externalId: true, productId: true, connectionId: true, connection: { select: { name: true } }, product: { select: { name: true } } },
        }),
      ]);
      const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
      const listingByExternalId = new Map(existingListings.map((l) => [l.externalId, l]));
      const elsewhere = new Map<string, number>();
      for (const l of existingListings) {
        if (l.connectionId !== connectionId) elsewhere.set(l.connection.name, (elsewhere.get(l.connection.name) || 0) + 1);
      }

      const items = mlItems
        .filter((i) => !listingByExternalId.has(i.id))
        .map((i) => {
          const sku = this.extractSku(i.attributes);
          const skuSuspicious = !!sku && (skuCounts.get(sku) || 0) > 1;
          const matchedProduct = sku ? productBySku.get(sku) : undefined;
          return {
            externalId: i.id,
            title: i.title,
            price: i.price,
            stock: i.available_quantity,
            thumbnail: i.secure_thumbnail || i.thumbnail,
            permalink: i.permalink,
            status: i.status,
            sku,
            skuSuspicious,
            matchedProductId: matchedProduct?.id || null,
            matchedProductName: matchedProduct?.name || null,
          };
        });

      const alreadyImportedCount = mlItems.length - items.length;

      return {
        connectionName: conn.name, total, hasMore, nextScrollId, alreadyImportedCount, items,
        alreadyImportedElsewhere: Array.from(elsewhere, ([store, count]) => ({ store, count })),
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`previewImport error: ${err?.message || err}`, err?.stack);
      throw new BadRequestException(
        'Ocurrió un error inesperado al buscar publicaciones en Mercado Libre. Revisa los logs del backend.',
      );
    }
  }

  async confirmImport(connectionId: string, externalIds: string[], user: any, unlinkIds: string[] = []) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);
    const unlinkSet = new Set(unlinkIds);

    let mlItems: any[];
    try {
      mlItems = await this.fetchMlItems(externalIds, token);
    } catch (err: any) {
      this.logger.error(`confirmImport fetchMlItems error: ${err?.message || err}`, err?.stack);
      throw new BadRequestException('No se pudo obtener el detalle de las publicaciones desde Mercado Libre.');
    }

    let imported = 0;
    let linked = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Mismo resguardo que previewImport, pero verificado de nuevo acá (el frontend podría
    // no haberlo aplicado): un SKU que se repite en 2+ publicaciones de este lote es
    // genérico/reutilizado y NUNCA debe vincularse automáticamente a un producto existente,
    // así el caller haya o no marcado "quitar vínculo" para ese ítem puntual.
    const skuCountsInBatch = new Map<string, number>();
    for (const item of mlItems) {
      const s = this.extractSku(item.attributes);
      if (s) skuCountsInBatch.set(s, (skuCountsInBatch.get(s) || 0) + 1);
    }

    // Productos que ya tienen publicación en esta conexión. Si otro ítem de ML resuelve al mismo
    // SKU, se vincula como publicación adicional (slot siguiente) en vez de omitirse.
    const preexistingListings = await this.prisma.listing.findMany({
      where: { connectionId },
      select: { productId: true },
    });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));

    for (const item of mlItems) {
      try {
        // Ya importada en esta u otra tienda de ML de la empresa: no se duplica.
        const alreadyLinked = await this.prisma.listing.findFirst({
          where: { externalId: item.id, connection: { companyId: conn.companyId, marketplace: MarketplaceType.MERCADO_LIBRE } },
          include: { connection: { select: { name: true } } },
        });
        if (alreadyLinked) {
          skipped++;
          if (alreadyLinked.connectionId !== connectionId) errors.push(`${item.id}: ya está importada en la tienda "${alreadyLinked.connection.name}" (no se duplica).`);
          continue;
        }

        const status = item.status === 'active' ? ListingStatus.ACTIVE : ListingStatus.PAUSED;
        const matchedSku = this.extractSku(item.attributes);
        const skuSuspicious = !!matchedSku && (skuCountsInBatch.get(matchedSku) || 0) > 1;
        const forceNew = unlinkSet.has(item.id) || skuSuspicious;
        const sku = (!forceNew && matchedSku) || (await this.nextSku(conn.companyId));
        if (skuSuspicious) {
          this.logger.warn(`confirmImport: SKU "${matchedSku}" repetido ${skuCountsInBatch.get(matchedSku)}x en este lote (ítem ${item.id}) — se crea como producto nuevo, no se vincula automáticamente.`);
        }

        const product = forceNew ? null : await this.prisma.product.findUnique({
          where: { sku_companyId: { sku, companyId: conn.companyId } },
        });

        // Si el SKU ya tiene una publicación en esta cuenta, esta se vincula como publicación
        // adicional del mismo producto (mismo stock), con su precio y título propios.

        const packageDims = this.parsePackageDimensions(item.attributes);
        const additionalAttrs = this.extractAdditionalAttributes(item.attributes);

        if (product) {
          // Solo se completan campos que el producto del catálogo aún no tenía cargados —
          // no se pisa lo que el usuario ya haya editado a mano.
          const fillData: Record<string, any> = {};
          if (!product.mlCategoryId && item.category_id) fillData.mlCategoryId = item.category_id;
          if (!(product as any).mlFamilyName && item.family_name) fillData.mlFamilyName = item.family_name;
          if (!(product as any).mlAttributes && additionalAttrs.length) fillData.mlAttributes = additionalAttrs;
          if ((product as any).packageHeight == null && packageDims.packageHeight !== undefined) fillData.packageHeight = packageDims.packageHeight;
          if ((product as any).packageWidth == null && packageDims.packageWidth !== undefined) fillData.packageWidth = packageDims.packageWidth;
          if ((product as any).packageLength == null && packageDims.packageLength !== undefined) fillData.packageLength = packageDims.packageLength;
          if ((product as any).packageWeight == null && packageDims.packageWeight !== undefined) fillData.packageWeight = packageDims.packageWeight;
          if (!product.description || !(product as any).mlDescription) {
            const mlDesc = await this.fetchMlDescription(item.id, token);
            if (mlDesc) {
              if (!product.description) fillData.description = mlDesc;
              if (!(product as any).mlDescription) fillData.mlDescription = mlDesc;
            }
          }
          if (Object.keys(fillData).length) {
            await this.prisma.product.update({ where: { id: product.id }, data: fillData });
          }

          const usedSlots = (await this.prisma.listing.findMany({ where: { productId: product.id, connectionId }, select: { slot: true } })).map((x) => x.slot);
          let slot = 0;
          while (usedSlots.includes(slot)) slot++;
          await this.prisma.listing.create({
            data: {
              productId: product.id,
              connectionId,
              slot,
              // Publicación adicional: precio propio si difiere del de la cuenta/base.
              ...(slot > 0 && item.price != null && Math.round(Number(item.price)) !== Math.round(await getEffectivePrice(this.prisma, product.id, connectionId, Number(product.mlPrice ?? product.price)))
                ? { price: item.price } : {}),
              externalId: item.id,
              externalUrl: item.permalink,
              status,
              syncedAt: new Date(),
              // Título de esta cuenta: propio solo si difiere del nombre del producto (título base).
              title: item.title && String(item.title).trim() !== String(product.name).trim() ? String(item.title).trim() : null,
            },
          });
          // Sin esto, la sincronización le enviaba el precio base a la publicación de esta cuenta
          // y le cambiaba el precio en ML: el precio que tiene en ML queda como el de esta cuenta.
          if (slot === 0) await this.applyMlAccountPrice(this.prisma, product.id, connectionId, item.price);
          linkedProductIds.add(product.id);
          linked++;
        } else {
          const mlDesc = await this.fetchMlDescription(item.id, token);
          const newProduct = await this.prisma.product.create({
            data: {
              sku,
              name: item.title,
              price: item.price,
              mlPrice: item.price,
              stock: item.available_quantity,
              mlCategoryId: item.category_id,
              mlFamilyName: item.family_name || null,
              mlAttributes: additionalAttrs.length ? additionalAttrs : undefined,
              description: mlDesc || undefined,
              mlDescription: mlDesc || undefined,
              ...packageDims,
              companyId: conn.companyId,
            },
          });
          const pictures: Array<{ secure_url?: string; url?: string }> = Array.isArray(item.pictures) && item.pictures.length
            ? item.pictures
            : (item.secure_thumbnail || item.thumbnail ? [{ url: item.secure_thumbnail || item.thumbnail }] : []);

          for (let i = 0; i < pictures.length; i++) {
            const url = pictures[i].secure_url || pictures[i].url;
            if (!url) continue;
            await this.prisma.productImage.create({
              data: {
                productId: newProduct.id,
                filename: `${item.id}-${i}.jpg`,
                url,
                isPrimary: i === 0,
                order: i,
              },
            });
          }
          await this.prisma.listing.create({
            data: {
              productId: newProduct.id,
              connectionId,
              externalId: item.id,
              externalUrl: item.permalink,
              status,
              syncedAt: new Date(),
            },
          });
          linkedProductIds.add(newProduct.id);
          imported++;
        }
      } catch (err: any) {
        this.logger.error(`confirmImport item ${item?.id} error: ${err?.message || err}`, err?.stack);
        errors.push(`${item?.id || 'ítem'}: ${err?.message || 'error desconocido'}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importación de ventas históricas (sin descontar stock) ──────────────────

  private computeOrderCharges(order: any) {
    const payment = (order.payments || [])[0] || {};
    // Respaldo si el pago no trae marketplace_fee: sale_fee de ML es por unidad (× cantidad).
    const itemFees = (order.order_items || []).reduce((sum: number, oi: any) => sum + Number(oi.sale_fee || 0) * (oi.quantity || 1), 0);
    return {
      shippingCost: Math.round(Number(payment.shipping_cost || order.shipping?.cost || 0)),
      marketplaceFee: Math.round(Number(payment.marketplace_fee || itemFees || 0)),
      taxes: Math.round(Number(payment.taxes_amount || 0)),
      coupon: Math.round(Number(payment.coupon_amount || 0)),
      totalPaid: Math.round(Number(payment.total_paid_amount ?? order.total_amount ?? 0)),
    };
  }

  // Neto real que recibe el vendedor: precio del producto - comisión - envío a su cargo - impuestos.
  // Verificado contra el panel de ML: $8.499 - $1.530 - $799 = $6.170.
  // El cupón/descuento de ML (payments.coupon_amount) NO se descuenta: lo financia Mercado Libre
  // y al vendedor le liquida el precio completo. Verificado: orden 2000018772264136 → 45500 − 5005
  // (comisión) + 289 (bonificación Flex) = 40784, con un cupón de 9100 que pagó ML. Se guarda en
  // Sale.discount solo como información.
  private computeSellerNetAmount(order: any, charges: { marketplaceFee: number; shippingCost: number; taxes: number; coupon: number }): number {
    const productTotal = Math.round(Number(order.total_amount || 0));
    return productTotal - charges.marketplaceFee - charges.shippingCost - charges.taxes;
  }

  private static readonly ML_LOGISTIC_LABELS: Record<string, string> = {
    fulfillment: 'Full',
    self_service: 'Flex',
    drop_off: 'Colecta (agencia)',
    xd_drop_off: 'Colecta (agencia)',
    cross_docking: 'Colecta (a domicilio)',
    not_specified: 'A coordinar',
  };

  // TEMPORAL: diagnóstico directo de una orden puntual, sin pasar por logs.
  async debugOrder(connectionId: string, orderId: string, user: any) {
    await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!orderRes.ok) {
      return { error: `No se pudo obtener la orden (HTTP ${orderRes.status})` };
    }
    const order = await orderRes.json() as any;

    const shippingId = order.shipping?.id;
    let shipment: any = null;
    let costs: any = null;
    if (shippingId) {
      const [shipmentRes, costsRes] = await Promise.all([
        fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${ML_API}/shipments/${shippingId}/costs`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      shipment = shipmentRes.ok ? await shipmentRes.json() : { error: `HTTP ${shipmentRes.status}` };
      costs = costsRes.ok ? await costsRes.json() : { error: `HTTP ${costsRes.status}` };
    }

    const billing = await this.findBillingDetailsForOrder(orderId, order.date_created, token);

    // Datos del comprador sin envío ("acordar con el vendedor"): lo que se usaría para la orden.
    const buyerContact = await this.getMlBuyerContact(order, token);

    return {
      to_agree: this.isMlToAgree(order),
      buyer: { id: order.buyer?.id, nickname: order.buyer?.nickname, first_name: order.buyer?.first_name, last_name: order.buyer?.last_name },
      buyer_contact: buyerContact,
      order_tags: order.tags,
      order_total_amount: order.total_amount,
      order_date_created: order.date_created,
      order_items: (order.order_items || []).map((oi: any) => ({ title: oi.item?.title, sale_fee: oi.sale_fee, unit_price: oi.unit_price })),
      payments: order.payments,
      shipping_id: shippingId,
      shipment,
      costs,
      billing,
    };
  }

  // TEMPORAL: recorre la API de Billing de ML para ubicar los cargos/bonificaciones
  // de una orden puntual. Encadena: listar períodos -> ubicar el que contiene la fecha
  // de la venta -> paginar el detalle de ese período (probando grupos MP y ML) ->
  // filtrar por sales_info[].order_id.
  private async findBillingDetailsForOrder(orderId: string, saleDateIso: string, token: string): Promise<any> {
    const result: any = { periods_lookup: {}, period_key: {}, matched_details: [], raw_sample: null, errors: [] };
    const saleDate = new Date(saleDateIso);

    for (const group of ['ML', 'MP']) {
      let periods: any[] = [];
      try {
        const periodsRes = await fetch(`${ML_API}/billing/integration/periods?group=${group}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!periodsRes.ok) {
          result.errors.push(`GET /billing/integration/periods?group=${group} -> HTTP ${periodsRes.status}: ${await periodsRes.text()}`);
          continue;
        }
        const periodsData = await periodsRes.json() as any;
        result.periods_lookup[group] = periodsData;
        periods = Array.isArray(periodsData) ? periodsData : (periodsData.results || periodsData.periods || []);
      } catch (err: any) {
        result.errors.push(`GET /billing/integration/periods?group=${group} error: ${err?.message || err}`);
        continue;
      }

      const period = periods.find((p: any) => {
        const from = p.date_from ? new Date(p.date_from) : null;
        const to = p.date_to ? new Date(p.date_to) : null;
        return from && to && saleDate >= from && saleDate <= new Date(to.getTime() + 24 * 60 * 60 * 1000);
      });
      if (!period) {
        result.errors.push(`No se encontró un período (group=${group}) que contenga la fecha de la venta.`);
        continue;
      }
      result.period_key[group] = period.key;

      let offset = 0;
      const limit = 100;
      let total = Infinity;
      let sampleCaptured = false;
      while (offset < total && offset < 2000) {
        try {
          const url = `${ML_API}/billing/integration/periods/key/${period.key}/group/${group}/details?document_type=BILL&limit=${limit}&offset=${offset}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) {
            result.errors.push(`GET group=${group} offset=${offset} -> HTTP ${res.status}: ${await res.text()}`);
            break;
          }
          const data = await res.json() as any;
          total = data.paging?.total ?? data.total ?? 0;
          const details = data.results || data.details || [];
          if (!sampleCaptured && details.length > 0) {
            result.raw_sample = details[0];
            sampleCaptured = true;
          }
          for (const d of details) {
            const salesInfo = d.sales_info || [];
            if (salesInfo.some((s: any) => String(s.order_id) === String(orderId))) {
              result.matched_details.push({ group, ...d });
            }
          }
          offset += limit;
          if (details.length === 0) break;
        } catch (err: any) {
          result.errors.push(`GET group=${group} offset=${offset} error: ${err?.message || err}`);
          break;
        }
      }
    }

    return result;
  }

  private async getMlShippingInfo(order: any, token: string): Promise<{
    method: string | null; sellerCost: number | null; address: MlShippingAddress | null; trackingCode: string | null;
  }> {
    const orderId = order.id;
    const buyerShippingPaid = Number((order.payments || [])[0]?.shipping_cost || 0);

    const shippingId = order.shipping?.id;
    if (!shippingId) return { method: null, sellerCost: null, address: null, trackingCode: null };
    try {
      const [shipmentRes, costsRes] = await Promise.all([
        fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${ML_API}/shipments/${shippingId}/costs`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      let shipment: any = {};
      if (shipmentRes.ok) shipment = await shipmentRes.json();

      let costs: any = null;
      if (costsRes.ok) {
        costs = await costsRes.json();
        this.logger.log(`ML shipment ${shippingId} costs: ${JSON.stringify(costs).slice(0, 2000)}`);
      }

      const logisticType = shipment.logistic_type || shipment.shipping_option?.name;
      // Turbo NO es un logistic_type propio en la API de ML — un envío Turbo devuelve
      // logistic_type "self_service" igual que un Flex normal; la única forma de
      // distinguirlo es por el tag "turbo" en shipment.tags. Sin este chequeo, todo pedido
      // Turbo se etiquetaba como "Flex" común.
      // Ver https://developers.mercadolibre.com.ar/es_ar/envios-turbo#Identificar-órdenes-Turbo
      const isTurbo = Array.isArray(shipment.tags) && shipment.tags.includes('turbo');
      const method = isTurbo
        ? 'Turbo'
        : logisticType ? (MercadolibreService.ML_LOGISTIC_LABELS[logisticType] || logisticType) : null;

      const sender = Array.isArray(costs?.senders) ? costs.senders[0] : undefined;

      // Bonificación al vendedor (ej. Flex): compensation directa + suma de compensations[] + charge_flex
      // negativo si ML lo expresa como cargo negativo. Reduce el costo neto a cargo del vendedor.
      const compensationsSum = Array.isArray(sender?.compensations)
        ? sender.compensations.reduce((s: number, c: any) => s + Number(c?.amount ?? c ?? 0), 0)
        : 0;
      const flexCharge = Number(sender?.charges?.charge_flex || 0);

      // Caso confirmado: Flex con descuento "loyal" 100% al comprador (envío gratis) y costo $0
      // al vendedor en costs.senders — ahí costs.gross_amount es la bonificación real que ML
      // acredita al vendedor (ej. orden 2000017435932280: gross_amount=3090 = "Bonificación por envío").
      const isFlex = logisticType === 'self_service';
      const senderCostRaw = sender?.cost != null ? Number(sender.cost) : null;
      const grossAmount = costs?.gross_amount != null ? Number(costs.gross_amount) : 0;
      const flexFullBonus = isFlex && senderCostRaw === 0 && grossAmount > 0 ? grossAmount : 0;
      if (flexFullBonus > 0) {
        this.logger.log(`ML orden ${orderId} bonificación Flex por gross_amount detectada: ${flexFullBonus}`);
      }

      const bonus = Number(sender?.compensation || 0) + compensationsSum - flexCharge + flexFullBonus;

      // Caso confirmado: Flex con costo informado al vendedor (costs.senders.cost > 0) — ese costo
      // NO se le cobra (el envío Flex lo paga el comprador / ML y lo entrega el vendedor); lo que ML
      // acredita como "Bonificación por envío" son los descuentos del vendedor (senders.discounts,
      // promoted_amount). Ej. orden 2000018780690098: cost=2601, discount mandatory 10% = 289 →
      // ML liquida 24528 − 3679 + 289 = 21138.
      const senderDiscounts = Array.isArray(sender?.discounts)
        ? sender.discounts.reduce((s: number, d: any) => s + Number(d?.promoted_amount || 0), 0)
        : 0;
      const flexWithCost = isFlex && senderCostRaw != null && senderCostRaw > 0;
      if (flexWithCost) {
        this.logger.log(`ML orden ${orderId} Flex con costo informado ${senderCostRaw}: no se cobra; bonificación = descuentos ${senderDiscounts} + compensaciones ${bonus}`);
      }

      // 1) Si /costs trae el cargo real al vendedor, se usa directo (menos la bonificación, si existe).
      //    Flex con costo: solo la bonificación (negativo = a favor del vendedor).
      const sendersCost = flexWithCost
        ? -(senderDiscounts + bonus)
        : sender?.cost != null ? Number(sender.cost) - bonus : undefined;

      // 2) Si no, se infiere: costo real de envío menos lo que pagó el comprador.
      //    Positivo = se le cobra la diferencia al vendedor (ej. envío "gratis" para el comprador).
      //    Negativo = Mercado Libre le bonifica el excedente al vendedor (ej. Flex, buyerPaid > costo real)
      //    — sin Math.max(0, ...): ese excedente debe sumarse al total, no descartarse.
      const actualShippingCost = shipment.shipping_option?.cost;
      const inferredSellerCost = actualShippingCost != null
        ? Number(actualShippingCost) - buyerShippingPaid
        : null;

      const rawSellerCost = sendersCost != null ? sendersCost : inferredSellerCost;
      const sellerCost = rawSellerCost != null ? Math.round(rawSellerCost) : null;

      if (bonus !== 0) {
        this.logger.log(`ML orden ${orderId} bonificación de envío detectada: ${bonus} (compensation=${sender?.compensation}, compensations=${JSON.stringify(sender?.compensations)}, charge_flex=${flexCharge})`);
      }

      this.logger.log(
        `ML orden ${orderId} envío: pagó comprador=${buyerShippingPaid}, costo real=${actualShippingCost ?? 'n/d'}, ` +
        `costo vendedor (senders.cost)=${sendersCost ?? 'n/d'}, costo vendedor (inferido)=${inferredSellerCost ?? 'n/d'}`,
      );

      const ra = shipment.receiver_address;
      const address: MlShippingAddress | null = ra
        ? {
            addressLine: ra.address_line || [ra.street_name, ra.street_number].filter(Boolean).join(' ') || null,
            // ML no separa "comuna"/"ciudad" para Chile: city.name es la comuna real
            // (ej. "Providencia") y state.name es la región (ej. "Región Metropolitana").
            commune: ra.city?.name || null,
            region: ra.state?.name || null,
            receiverName: ra.receiver_name || null,
            receiverPhone: ra.receiver_phone || null,
          }
        : null;
      const trackingCode = shipment.tracking_number ? String(shipment.tracking_number) : null;

      return { method, sellerCost, address, trackingCode };
    } catch (err: any) {
      this.logger.warn(`No se pudo obtener datos de envío de la orden ${orderId}: ${err?.message || err}`);
      return { method: null, sellerCost: null, address: null, trackingCode: null };
    }
  }

  async previewSalesImport(connectionId: string, user: any, from?: string, to?: string) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) throw new BadRequestException('No se pudo obtener el usuario de Mercado Libre');
    const me = await meRes.json() as any;

    const MAX_ORDERS = 300;
    const baseParams = new URLSearchParams({ seller: String(me.id), limit: '50' });
    if (from) baseParams.set('order.date_created.from', new Date(from).toISOString());
    if (to) baseParams.set('order.date_created.to', new Date(`${to}T23:59:59`).toISOString());

    const orders: any[] = [];
    let offset = 0;
    let total = 0;
    do {
      const params = new URLSearchParams(baseParams);
      params.set('offset', String(offset));
      const res = await fetch(`${ML_API}/orders/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`ML orders/search failed [${res.status}]: ${errBody}`);
        throw new BadRequestException(
          `Mercado Libre rechazó la búsqueda de ventas (HTTP ${res.status}). Revisa los logs del backend para más detalle.`,
        );
      }
      const data = await res.json() as any;
      total = data.paging?.total || 0;
      orders.push(...(data.results || []));
      offset += 50;
    } while (offset < total && orders.length < MAX_ORDERS);

    const truncated = total > orders.length;

    const orderIds = orders.map((o) => String(o.id));
    const itemIds = Array.from(new Set(
      orders.flatMap((o) => (o.order_items || []).map((oi: any) => oi.item?.id).filter(Boolean)),
    ));

    const [existingSales, listings] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          channel: SaleChannel.MERCADO_LIBRE,
          OR: [{ externalId: { in: orderIds } }, { mlMergedOrderIds: { hasSome: orderIds } }],
        },
        select: { externalId: true, mlMergedOrderIds: true },
      }),
      this.prisma.listing.findMany({
        where: { connectionId, externalId: { in: itemIds } },
        select: { externalId: true, productId: true, product: { select: { name: true } } },
      }),
    ]);
    const existingIds = new Set(existingSales.flatMap((s) => [s.externalId, ...s.mlMergedOrderIds]));
    const listingByItemId = new Map(listings.map((l) => [l.externalId, l]));

    // Se muestran TODAS las órdenes del rango, ya estén registradas o no, para tener el
    // panorama completo del período — las ya registradas quedan marcadas y no se pueden
    // volver a seleccionar, pero no se ocultan.
    const orderResults = orders.map((o) => {
      const orderItems = (o.order_items || []).map((oi: any) => {
        const listing = listingByItemId.get(oi.item?.id);
        return {
          title: oi.item?.title || 'Ítem',
          quantity: oi.quantity || 1,
          unitPrice: Number(oi.unit_price || 0),
          resolved: !!listing,
          productName: listing?.product?.name || null,
        };
      });
      const alreadyRegistered = existingIds.has(String(o.id));
      const importable = !alreadyRegistered && orderItems.length > 0 && orderItems.every((i: any) => i.resolved);
      const charges = this.computeOrderCharges(o);
      return {
        externalId: String(o.id),
        date: o.date_created,
        total: Number(o.total_amount || 0),
        buyerNickname: o.buyer?.nickname || null,
        items: orderItems,
        charges,
        importable,
        alreadyRegistered,
      };
    });

    const alreadyImportedCount = orderResults.filter((o) => o.alreadyRegistered).length;

    return { connectionName: conn.name, total, truncated, alreadyImportedCount, orders: orderResults };
  }

  // createDispatchOrder: además de registrar la venta, corre el mismo processOrder() que
  // usan el webhook y el cron (crea la Orden de despacho en Pendiente, consolida packs)
  // pero SIN descontar stock ni pausar publicaciones — pensado para recuperar una venta
  // real que quedó sin Orden porque el webhook falló en su momento, no para reimportar
  // historial ya despachado. El stock nunca se toca acá: si la orden es reciente y de
  // verdad hace falta descontarlo, el barrido/webhook en vivo se encarga por su cuenta.
  async confirmSalesImport(connectionId: string, externalOrderIds: string[], user: any, createDispatchOrder?: boolean) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const orderId of externalOrderIds) {
      const existing = await this.prisma.sale.findFirst({
        where: { channel: SaleChannel.MERCADO_LIBRE, ...this.mlOrderMatch(orderId) },
      });
      if (existing) { skipped++; continue; }

      const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!orderRes.ok) { errors.push(`Orden ${orderId}: no se pudo obtener de Mercado Libre`); continue; }
      const order = await orderRes.json() as any;

      if (createDispatchOrder) {
        // skipStockEffects: esta orden ya pasó (o el webhook la trató como perdida) — nunca
        // se descuenta stock acá para no restar dos veces algo que ya se despachó o que un
        // proceso en vivo terminará de resolver por su cuenta.
        const result = await this.processOrder(orderId, order, token, conn.companyId, conn.id, { skipStockEffects: true });
        if (result === 'imported' || result === 'merged') {
          imported++;
          // La orden nace en "Pendiente" por defecto, pero si es una recuperación de algo
          // que ya pasó hace días, puede que en ML ya esté cancelada, despachada o incluso
          // entregada — se refleja ese estado real de una vez, con la misma lógica que usa
          // el webhook/barrido, en vez de dejarla mostrando "Pendiente" para siempre.
          try {
            await this.syncInternalOrderFromMl(order, token);
          } catch (err: any) {
            this.logger.warn(`No se pudo sincronizar el estado real de la orden ${orderId} tras importarla: ${err?.message || err}`);
          }
        } else {
          skipped++; errors.push(`Orden ${orderId}: sin productos vinculados en el catálogo`);
        }
        continue;
      }

      const resolvedItems: Array<{ productId: string; quantity: number; unitPrice: number }> = [];
      let allResolved = true;
      for (const oi of order.order_items || []) {
        const listing = await this.prisma.listing.findFirst({
          where: { connectionId, externalId: oi.item?.id },
        });
        if (!listing) { allResolved = false; break; }
        resolvedItems.push({ productId: listing.productId, quantity: oi.quantity || 1, unitPrice: Number(oi.unit_price || 0) });
      }
      if (!allResolved || !resolvedItems.length) {
        errors.push(`Orden ${orderId}: uno o más productos no están vinculados en el catálogo`);
        continue;
      }

      const charges = this.computeOrderCharges(order);
      const shippingInfo = await this.getMlShippingInfo(order, token);
      if (shippingInfo.sellerCost != null) charges.shippingCost = shippingInfo.sellerCost;
      charges.totalPaid = this.computeSellerNetAmount(order, charges);
      const historySale = await this.prisma.sale.create({
        data: {
          channel: SaleChannel.MERCADO_LIBRE,
          externalId: orderId,
          total: Number(order.total_amount || 0),
          shippingCost: charges.shippingCost,
          marketplaceFee: charges.marketplaceFee,
          taxes: charges.taxes,
          discount: charges.coupon,
          netAmount: charges.totalPaid,
          shippingMethod: shippingInfo.method,
          paymentMethodName: this.mlPaymentLabel(order),
          companyId: conn.companyId,
          connectionId: conn.id,
          customerName: order.buyer?.nickname || null,
          buyerNickname: order.buyer?.nickname || null,
          createdAt: new Date(order.date_created),
          items: { create: resolvedItems },
        },
      });
      // Toda venta importada queda con su orden de despacho, sin mover stock (historial).
      await this.createOrderForExistingSale(historySale.id, { role: Role.SUPER_ADMIN }, { withoutStock: true }).catch((err) =>
        this.logger.warn(`Venta ML ${orderId} importada sin orden de despacho: ${err?.message || err}`));
      imported++;
    }

    return { imported, skipped, errors };
  }

  // ─── Procesamiento de órdenes (compartido entre webhook y auto-sync) ─────────

  // Crea la venta y descuenta stock de forma atómica. Usado tanto por el webhook de ML
  // como por el cron de auto-sync, para que ambos caminos tengan exactamente el mismo efecto.
  // companyIdHint / connectionId: si el caller ya conoce la conexión (p.ej. el cron, que
  // parte de una MarketplaceConnection concreta), se pasan para acotar la resolución de
  // los ítems a ESA conexión. Sin esto, un mismo item de ML vinculado en dos conexiones
  // (dos cuentas / dos empresas) haría que la venta descuente stock de la cuenta equivocada.
  // Aplica el descuento de stock (o el paso dropship) y el pausado por stock crítico de
  // UN ítem ya resuelto. Compartido entre crear una venta nueva y sumar ítems a una venta
  // de pack ya existente, para que ambos caminos tengan exactamente el mismo efecto.
  private async applyItemStockEffects(
    tx: any,
    companyId: string,
    orderId: string,
    listing: any,
    quantity: number,
    saleItemId: string,
  ): Promise<void> {
    const product = listing.product;

    // Productos dropship: no descuentan stock propio ni pausan la publicación.
    // El módulo de dropshipping genera el pedido al proveedor y costea la línea.
    if (product.dropship) {
      await tx.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.ACTIVE, syncedAt: new Date() },
      });
      return;
    }

    const newStock = Math.max(0, product.stock - quantity);

    const totalCost = await this.costing.consumeForSale(tx, {
      companyId,
      productId: listing.productId,
      warehouseId: product.warehouseId,
      quantity,
      saleItemId,
      reason: `Venta Mercado Libre orden #${orderId}`,
      reference: { type: 'SALE', number: `ML ${orderId}` },
    });
    if (totalCost != null) {
      await tx.saleItem.update({ where: { id: saleItemId }, data: { totalCost } });
    }

    // Pausa la publicación al llegar al stock crítico del producto (0 por defecto).
    const criticalStock = Math.max(0, product.criticalStock ?? 0);
    const belowCritical = newStock <= criticalStock;
    const newStatus = belowCritical ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
    await tx.listing.update({
      where: { id: listing.id },
      data: { status: newStatus, syncedAt: new Date() },
    });

    // Pausar en ML solo al cruzar el umbral (evita re-pausar una publicación ya pausada).
    if (belowCritical && listing.status !== ListingStatus.PAUSED) {
      const itemToken = await this.getValidToken(listing.connectionId);
      await fetch(`${ML_API}/items/${listing.externalId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${itemToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paused' }),
      });
      this.logger.log(`ML orden ${orderId}: producto=${listing.productId} pausado por stock crítico (${newStock} ≤ ${criticalStock})`);
    }

    this.logger.log(`ML orden ${orderId}: producto=${listing.productId} stock=${product.stock}→${newStock}`);
  }

  // Montos de una venta formada por una o varias órdenes de ML (un carrito): total, comisión y
  // neto con la misma regla de la importación, pero contando el costo de cada ENVÍO una sola vez
  // (las órdenes de un carrito comparten envío). Incluye la comisión por producto del catálogo.
  private async computeMlSaleAmounts(mlOrders: any[], token: string, connectionId: string) {
    let total = 0, fee = 0, net = 0, shippingCost = 0, taxes = 0, coupon = 0;
    let shippingMethod: string | null = null;
    const seenShipments = new Set<string>();
    const feeByProduct = new Map<string, number>();
    for (const o of mlOrders) {
      const c = this.computeOrderCharges(o);
      const si = await this.getMlShippingInfo(o, token);
      if (si.sellerCost != null) c.shippingCost = si.sellerCost;
      shippingMethod = shippingMethod || si.method;
      const shipKey = o.shipping?.id != null ? String(o.shipping.id) : `order:${o.id}`;
      const firstOfShipment = !seenShipments.has(shipKey);
      seenShipments.add(shipKey);
      const shipping = firstOfShipment ? c.shippingCost : 0;
      total += Number(o.total_amount || 0);
      fee += c.marketplaceFee;
      taxes += c.taxes;
      coupon += c.coupon;
      shippingCost += shipping;
      net += this.computeSellerNetAmount(o, { ...c, shippingCost: shipping });
      for (const oi of o.order_items || []) {
        if (oi.sale_fee == null) continue;
        const listing = await this.prisma.listing.findFirst({ where: { externalId: oi.item?.id, connectionId }, select: { productId: true } });
        if (!listing) continue;
        feeByProduct.set(listing.productId, (feeByProduct.get(listing.productId) || 0) + Math.round(Number(oi.sale_fee) * (oi.quantity || 1)));
      }
    }
    return { total, fee, net, shippingCost, taxes, coupon, shippingMethod, feeByProduct };
  }

  // Reparte la comisión de cada producto entre sus líneas de venta (por cantidad).
  private async applyItemFees(client: any, saleId: string, feeByProduct: Map<string, number>) {
    const items = await client.saleItem.findMany({ where: { saleId }, select: { id: true, productId: true, quantity: true } });
    const qtyByProduct = new Map<string, number>();
    for (const i of items) qtyByProduct.set(i.productId, (qtyByProduct.get(i.productId) || 0) + i.quantity);
    for (const i of items) {
      const fee = feeByProduct.get(i.productId);
      if (fee == null) continue;
      await client.saleItem.update({ where: { id: i.id }, data: { marketplaceFee: Math.round((fee * i.quantity) / (qtyByProduct.get(i.productId) || 1)) } });
    }
  }

  // ─── Recalcular montos de ventas de carrito ───────────────────────────────────
  // Hasta oct-2026 el envío de un carrito se restaba una vez por cada orden del pack (neto más
  // bajo de lo real) y no se guardaba la comisión por producto. Revisa las ventas de carrito
  // contra ML y, con apply=true, corrige total/comisión/envío/neto y la comisión de cada línea.
  async recalculatePackAmounts(user: any, opts: { companyId?: string; apply?: boolean }) {
    const sales = await this.prisma.sale.findMany({
      where: {
        ...this.companyFilter(user, opts.companyId),
        channel: SaleChannel.MERCADO_LIBRE,
        connectionId: { not: null },
        // Carritos (envío compartido) y ventas Flex (bonificación de envío mal calculada antes de oct-2026).
        // + ventas con cupón de ML (antes se descontaba del neto).
        OR: [{ mlPackId: { not: null } }, { mlMergedOrderIds: { isEmpty: false } }, { shippingMethod: 'Flex' }, { discount: { gt: 0 } }],
      },
      select: {
        id: true, externalId: true, mlPackId: true, mlShippingId: true, mlMergedOrderIds: true, connectionId: true,
        total: true, netAmount: true, marketplaceFee: true, shippingCost: true, order: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const report: any[] = [];
    for (const sale of sales) {
      const entry: any = {
        saleId: sale.id, orderId: sale.order?.id || null, mlOrderId: sale.externalId, packId: sale.mlPackId,
        before: { total: Number(sale.total), fee: sale.marketplaceFee != null ? Number(sale.marketplaceFee) : null, shipping: sale.shippingCost != null ? Number(sale.shippingCost) : null, net: sale.netAmount != null ? Number(sale.netAmount) : null },
        fixed: false,
      };
      try {
        const token = await this.getValidToken(sale.connectionId!);
        const ids = (sale.mlPackId || sale.mlMergedOrderIds.length ? await this.packOrderIds(sale, token) : null)
          || [sale.externalId!, ...sale.mlMergedOrderIds];
        if (sale.externalId && !ids.includes(sale.externalId)) { entry.error = 'El pack de Mercado Libre no incluye la orden principal: no se modifica'; report.push(entry); continue; }
        const mlOrders: any[] = [];
        for (const id of ids) {
          const res = await fetch(`${ML_API}/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`no se pudo leer la orden ${id} (HTTP ${res.status})`);
          mlOrders.push(await res.json());
        }
        const a = await this.computeMlSaleAmounts(mlOrders, token, sale.connectionId!);
        entry.after = { total: a.total, fee: a.fee, shipping: a.shippingCost, net: a.net };
        entry.orders = ids;
        const changed = Math.round(entry.before.total) !== Math.round(a.total)
          || Math.round(entry.before.net ?? -1) !== Math.round(a.net)
          || Math.round(entry.before.fee ?? -1) !== Math.round(a.fee)
          || Math.round(entry.before.shipping ?? -1) !== Math.round(a.shippingCost);
        if (!changed) continue;
        report.push(entry);
        if (opts.apply) {
          await this.prisma.$transaction(async (tx) => {
            await tx.sale.update({
              where: { id: sale.id },
              data: {
                total: a.total, marketplaceFee: a.fee, shippingCost: a.shippingCost, netAmount: a.net,
                mlMergedOrderIds: ids.filter((id) => id !== sale.externalId),
              },
            });
            await this.applyItemFees(tx, sale.id, a.feeByProduct);
          });
          entry.fixed = true;
        }
      } catch (err: any) {
        entry.error = err.message;
        report.push(entry);
      }
    }
    return { checked: sales.length, affected: report.length, applied: !!opts.apply, sales: report };
  }

  // ─── Reparar ventas de pack duplicadas ────────────────────────────────────────
  // Hasta oct-2026, cada vez que llegaba el webhook o corría el cron para la 2ª orden de un
  // pack (carrito), sus productos se volvían a sumar a la venta del pack (con su descuento de
  // stock, su línea de verificación y su monto). Esto revisa esas ventas contra lo que dice
  // Mercado Libre (las órdenes reales del pack) y, con apply=true, quita lo duplicado:
  // devuelve el stock descontado de más a la bodega, borra las líneas sobrantes de la venta y
  // de la orden de despacho, corrige total/neto/comisión y registra las órdenes fusionadas.
  // Solo se consideran ventas con algún producto repetido en sus líneas (la huella del bug).

  private async packOrderIds(sale: { externalId: string | null; mlPackId: string | null; mlShippingId: string | null }, token: string): Promise<string[] | null> {
    const headers = { Authorization: `Bearer ${token}` };
    if (sale.mlPackId) {
      const res = await fetch(`${ML_API}/packs/${sale.mlPackId}`, { headers });
      if (res.ok) {
        const pack = await res.json() as any;
        const ids = (pack.orders || []).map((o: any) => String(o.id)).filter(Boolean);
        if (ids.length) return ids;
      }
    }
    if (sale.mlShippingId) {
      const res = await fetch(`${ML_API}/shipments/${sale.mlShippingId}/items`, { headers });
      if (res.ok) {
        const items = await res.json() as any;
        const ids = (Array.isArray(items) ? items : []).map((i: any) => i.order_id != null ? String(i.order_id) : null).filter(Boolean) as string[];
        if (ids.length) return Array.from(new Set(ids));
      }
    }
    return null;
  }

  async repairPackDuplicates(user: any, opts: { companyId?: string; apply?: boolean; saleIds?: string[] }) {
    const sales = await this.prisma.sale.findMany({
      where: {
        ...this.companyFilter(user, opts.companyId),
        channel: SaleChannel.MERCADO_LIBRE,
        connectionId: { not: null },
        OR: [{ mlPackId: { not: null } }, { mlShippingId: { not: null } }],
        ...(opts.saleIds?.length ? { id: { in: opts.saleIds } } : {}),
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } }, orderBy: { id: 'asc' } },
        order: { include: { itemChecks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const candidates = sales.filter((s) => new Set(s.items.map((i) => i.productId)).size < s.items.length);

    const report: any[] = [];
    const touched = new Set<string>();
    for (const sale of candidates) {
      const entry: any = {
        saleId: sale.id, orderId: sale.order?.id || null, mlOrderId: sale.externalId, packId: sale.mlPackId,
        totalBefore: Number(sale.total), products: [], fixed: false,
      };
      report.push(entry);
      try {
        const token = await this.getValidToken(sale.connectionId!);
        const orderIds = await this.packOrderIds(sale, token);
        if (!orderIds?.length) { entry.error = 'No se pudo leer el pack en Mercado Libre: no se modifica'; continue; }
        if (sale.externalId && !orderIds.includes(sale.externalId)) {
          entry.error = `El pack informado por Mercado Libre no incluye la orden #${sale.externalId}: no se modifica`;
          continue;
        }

        // Lo que realmente se vendió según ML, por producto del catálogo.
        const expected = new Map<string, number>();
        const packOrders: any[] = [];
        for (const id of orderIds) {
          const res = await fetch(`${ML_API}/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`no se pudo leer la orden ${id} (HTTP ${res.status})`);
          packOrders.push(await res.json());
        }
        const amounts = await this.computeMlSaleAmounts(packOrders, token, sale.connectionId!);
        const { total, net, fee } = amounts;
        for (const order of packOrders) {
          for (const oi of order.order_items || []) {
            const listing = await this.prisma.listing.findFirst({
              where: { externalId: oi.item?.id, connectionId: sale.connectionId! },
              select: { productId: true },
            });
            if (listing) expected.set(listing.productId, (expected.get(listing.productId) || 0) + (oi.quantity || 1));
          }
        }

        // Líneas sobrantes: por producto se conservan las primeras hasta cubrir lo vendido.
        const extraItems: typeof sale.items = [];
        const byProduct = new Map<string, typeof sale.items>();
        for (const it of sale.items) byProduct.set(it.productId, [...(byProduct.get(it.productId) || []), it]);
        for (const [productId, items] of byProduct) {
          const want = expected.get(productId) ?? items.reduce((s, i) => s + i.quantity, 0);
          let kept = 0;
          const extra = [];
          for (const it of items) {
            if (kept >= want) extra.push(it); else kept += it.quantity;
          }
          const have = items.reduce((s, i) => s + i.quantity, 0);
          if (extra.length) {
            const movements = await this.prisma.stockMovement.findMany({
              where: { saleItemId: { in: extra.map((e) => e.id) }, type: MovementType.SALE },
              select: { quantity: true },
            });
            entry.products.push({
              productId, name: items[0].product.name, sku: items[0].product.sku,
              registered: have, real: want, extraLines: extra.length,
              stockToReturn: movements.reduce((s, m) => s - m.quantity, 0),
            });
            extraItems.push(...extra);
          }
        }
        entry.totalAfter = total;
        entry.realOrders = orderIds;
        if (!extraItems.length) continue;

        if (opts.apply) {
          const mergedIds = orderIds.filter((id) => id !== sale.externalId);
          await this.prisma.$transaction(async (tx) => {
            const extraIds = extraItems.map((e) => e.id);
            const movements = await tx.stockMovement.findMany({
              where: { saleItemId: { in: extraIds }, type: MovementType.SALE },
              select: { productId: true, warehouseId: true, quantity: true },
            });
            const back = new Map<string, { productId: string; warehouseId: string | null; qty: number }>();
            for (const m of movements) {
              const key = `${m.productId}|${m.warehouseId}`;
              const cur = back.get(key) || { productId: m.productId, warehouseId: m.warehouseId, qty: 0 };
              cur.qty += -m.quantity;
              back.set(key, cur);
            }
            for (const r of back.values()) {
              if (r.qty <= 0) continue;
              await this.ledger.move(tx, {
                productId: r.productId, warehouseId: r.warehouseId, delta: r.qty, type: MovementType.ADJUSTMENT,
                reason: `Corrección: venta Mercado Libre #${sale.externalId} duplicada (pack ${sale.mlPackId || sale.mlShippingId})`,
                userId: user.id,
                reference: { type: 'ADJUSTMENT', id: sale.id, number: `ML ${sale.externalId}` },
              });
              touched.add(r.productId);
            }
            // El historial de movimientos se conserva; solo se desliga de las líneas que se borran.
            await tx.stockMovement.updateMany({ where: { saleItemId: { in: extraIds } }, data: { saleItemId: null } });
            await tx.dropshipOrderItem.updateMany({ where: { saleItemId: { in: extraIds } }, data: { saleItemId: null } });
            await tx.saleItem.deleteMany({ where: { id: { in: extraIds } } });

            // Líneas de verificación sobrantes de la orden de despacho (primero las no verificadas).
            if (sale.order) {
              const checksByProduct = new Map<string, typeof sale.order.itemChecks>();
              for (const c of sale.order.itemChecks) {
                if (!c.productId) continue;
                checksByProduct.set(c.productId, [...(checksByProduct.get(c.productId) || []), c]);
              }
              const deleteIds: string[] = [];
              for (const [productId, checks] of checksByProduct) {
                const want = expected.get(productId);
                if (want == null) continue;
                const ordered = [...checks.filter((c) => c.checked), ...checks.filter((c) => !c.checked)];
                let kept = 0;
                for (const c of ordered) {
                  if (kept >= want) deleteIds.push(c.id); else kept += c.expectedQty;
                }
              }
              if (deleteIds.length) await tx.orderItemCheck.deleteMany({ where: { id: { in: deleteIds } } });
            }

            await tx.sale.update({
              where: { id: sale.id },
              data: { total, netAmount: net, marketplaceFee: fee, shippingCost: amounts.shippingCost, mlMergedOrderIds: mergedIds },
            });
            await this.applyItemFees(tx, sale.id, amounts.feeByProduct);
          });
          entry.fixed = true;
        }
      } catch (err: any) {
        entry.error = err.message;
      }
    }

    // Empuja el stock corregido al resto de los canales.
    for (const productId of touched) {
      const p = await this.prisma.product.findUnique({ where: { id: productId }, select: { stock: true } });
      if (p) this.sync.syncProduct(productId, p.stock).catch((e) => this.logger.error(`Sync tras reparar pack: ${e.message}`));
    }

    const affected = report.filter((r) => r.products.length || r.error);
    return { checked: candidates.length, affected: affected.length, applied: !!opts.apply, sales: affected };
  }

  // ─── Reasignar datos de una tienda conectada con la cuenta equivocada ─────────
  // Si una tienda se autorizó con la cuenta de ML de OTRA tienda, todo lo que sincronizó
  // (ventas con su orden, publicaciones, precios por canal, preguntas, reclamos) pertenece a esa
  // otra cuenta. Esto lo pasa a la tienda correcta, verificando CADA registro contra ML con el
  // token de la tienda destino (la orden/el ítem debe ser de esa cuenta); lo que no se pueda
  // verificar se deja donde está y se informa. Sin apply solo informa qué movería.

  async listMlConnectionsForTransfer(user: any, companyId?: string) {
    const rows = await this.prisma.marketplaceConnection.findMany({
      where: { marketplace: MarketplaceType.MERCADO_LIBRE, ...this.companyFilter(user, companyId) },
      select: {
        id: true, name: true, active: true, mlNickname: true, accessToken: true, createdAt: true,
        _count: { select: { sales: true, listings: true, mlQuestions: true, mlClaims: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ accessToken, _count, ...r }) => ({ ...r, authorized: !!accessToken, counts: _count }));
  }

  async transferConnectionData(fromId: string, toId: string, user: any, apply = false) {
    if (fromId === toId) throw new BadRequestException('Elige dos tiendas distintas.');
    const [from, to] = await Promise.all([
      this.prisma.marketplaceConnection.findUnique({ where: { id: fromId } }),
      this.prisma.marketplaceConnection.findUnique({ where: { id: toId } }),
    ]);
    if (!from || !to) throw new NotFoundException('Tienda no encontrada');
    if (from.marketplace !== MarketplaceType.MERCADO_LIBRE || to.marketplace !== MarketplaceType.MERCADO_LIBRE) {
      throw new BadRequestException('Solo aplica a tiendas de Mercado Libre.');
    }
    if (from.companyId !== to.companyId) throw new BadRequestException('Las dos tiendas deben ser de la misma empresa.');
    if (user.role !== Role.SUPER_ADMIN && from.companyId !== user.companyId) throw new ForbiddenException();
    if (!to.accessToken || !to.active) throw new BadRequestException(`La tienda destino "${to.name}" debe estar activa y autorizada.`);

    const token = await this.getValidToken(to.id);
    const account = await this.fetchMlAccount(token);
    if (!account) throw new BadRequestException(`No se pudo identificar la cuenta de Mercado Libre de "${to.name}".`);
    const headers = { Authorization: `Bearer ${token}` };

    // Ítems (MLC...) que pertenecen a la cuenta destino, consultados de a 20.
    const ownedItems = new Set<string>();
    const checkItems = async (ids: string[]) => {
      const pending = [...new Set(ids.filter(Boolean))].filter((id) => !ownedItems.has(id));
      for (let i = 0; i < pending.length; i += 20) {
        const chunk = pending.slice(i, i + 20);
        const res = await fetch(`${ML_API}/items?ids=${chunk.join(',')}&attributes=id,seller_id`, { headers }).catch(() => null);
        if (!res?.ok) continue;
        const rows = await res.json() as any[];
        for (const r of rows || []) {
          if (r?.code === 200 && String(r.body?.seller_id) === account.id) ownedItems.add(String(r.body.id));
        }
      }
    };
    const orderOwned = new Map<string, boolean>();
    const checkOrder = async (id: string) => {
      if (orderOwned.has(id)) return orderOwned.get(id)!;
      const res = await fetch(`${ML_API}/orders/${id}`, { headers }).catch(() => null);
      const ok = !!res?.ok && String(((await res!.json()) as any)?.seller?.id) === account.id;
      orderOwned.set(id, ok);
      return ok;
    };

    // Ventas
    const sales = await this.prisma.sale.findMany({
      where: { connectionId: from.id }, select: { id: true, externalId: true, createdAt: true, order: { select: { id: true } } },
    });
    const salesToMove: string[] = [];
    const salesSkipped: string[] = [];
    for (const s of sales) {
      if (s.externalId && await checkOrder(s.externalId)) salesToMove.push(s.id); else salesSkipped.push(s.externalId || s.id);
    }

    // Publicaciones
    const listings = await this.prisma.listing.findMany({
      where: { connectionId: from.id },
      select: { id: true, productId: true, externalId: true, product: { select: { name: true } } },
    });
    await checkItems(listings.map((l) => l.externalId || ''));
    const toListings = await this.prisma.listing.findMany({ where: { connectionId: to.id }, select: { productId: true, externalId: true } });
    const toByProduct = new Map(toListings.map((l) => [l.productId, l.externalId]));
    const toByItem = new Map(toListings.filter((l) => l.externalId).map((l) => [l.externalId!, l.productId]));
    const listingsToMove: string[] = [];
    const listingsDuplicated: string[] = []; // la tienda destino ya tiene ese mismo vínculo
    const listingConflicts: string[] = [];
    let listingsNotOwned = 0;
    for (const l of listings) {
      if (!l.externalId || !ownedItems.has(l.externalId)) { listingsNotOwned++; continue; }
      const sameProductItem = toByProduct.get(l.productId);
      const sameItemProduct = toByItem.get(l.externalId);
      if (sameProductItem === l.externalId) listingsDuplicated.push(l.id);
      else if (sameProductItem || (sameItemProduct && sameItemProduct !== l.productId)) {
        listingConflicts.push(`${l.product.name} (${l.externalId})`);
      } else listingsToMove.push(l.id);
    }
    const movedProductIds = listings.filter((l) => listingsToMove.includes(l.id)).map((l) => l.productId);

    // Preguntas y reclamos
    const questions = await this.prisma.mlQuestion.findMany({ where: { connectionId: from.id }, select: { id: true, itemId: true } });
    await checkItems(questions.map((q) => q.itemId));
    const questionsToMove = questions.filter((q) => ownedItems.has(q.itemId)).map((q) => q.id);
    const claims = await this.prisma.mlClaim.findMany({ where: { connectionId: from.id }, select: { id: true, saleId: true, orderExternalId: true } });
    const movedSaleIds = new Set(salesToMove);
    const claimsToMove: string[] = [];
    for (const c of claims) {
      if ((c.saleId && movedSaleIds.has(c.saleId)) || (c.orderExternalId && await checkOrder(c.orderExternalId))) claimsToMove.push(c.id);
    }

    const summary = {
      from: from.name, to: to.name, toAccount: account.nickname,
      sales: { total: sales.length, move: salesToMove.length, notVerified: salesSkipped },
      listings: {
        total: listings.length, move: listingsToMove.length, alreadyInDestination: listingsDuplicated.length,
        conflicts: listingConflicts, notFromThisAccount: listingsNotOwned,
      },
      questions: { total: questions.length, move: questionsToMove.length },
      claims: { total: claims.length, move: claimsToMove.length },
      applied: false,
    };
    if (!apply) return summary;

    await this.prisma.$transaction(async (tx) => {
      if (salesToMove.length) await tx.sale.updateMany({ where: { id: { in: salesToMove } }, data: { connectionId: to.id } });
      if (listingsToMove.length) await tx.listing.updateMany({ where: { id: { in: listingsToMove } }, data: { connectionId: to.id } });
      if (listingsDuplicated.length) await tx.listing.deleteMany({ where: { id: { in: listingsDuplicated } } });
      // Precio por canal de los productos movidos: pasa a la tienda destino si allí no tenía uno.
      for (const productId of movedProductIds) {
        const exists = await tx.channelPrice.findUnique({ where: { productId_connectionId: { productId, connectionId: to.id } } });
        if (exists) await tx.channelPrice.deleteMany({ where: { productId, connectionId: from.id } });
        else await tx.channelPrice.updateMany({ where: { productId, connectionId: from.id }, data: { connectionId: to.id } });
      }
      await tx.syncQueueItem.deleteMany({ where: { connectionId: from.id, productId: { in: movedProductIds } } });
      if (questionsToMove.length) await tx.mlQuestion.updateMany({ where: { id: { in: questionsToMove } }, data: { connectionId: to.id } });
      if (claimsToMove.length) await tx.mlClaim.updateMany({ where: { id: { in: claimsToMove } }, data: { connectionId: to.id } });
    });
    this.logger.log(`Reasignación ML ${from.name} → ${to.name}: ${JSON.stringify({ ...summary, applied: true })}`);
    return { ...summary, applied: true };
  }

  // ─── Reimportar una venta desde Mercado Libre ────────────────────────────────
  // Una venta de ML no se puede borrar y volver a importar (ya movió stock, puede tener factura y
  // la orden tiene historial). En cambio, se vuelven a leer de ML la(s) orden(es) de la venta y se
  // SOBRESCRIBEN sus datos: cliente, dirección y envío, montos/comisión/neto, y lo mismo en la
  // orden de despacho (o se recrea si se había eliminado). Stock, productos verificados, factura
  // e historial se conservan; si los productos/cantidades no calzan con ML solo se informa.
  async reimportSaleFromMl(saleId: string, user: any) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: { select: { name: true } } } }, order: { select: { id: true } } },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) throw new ForbiddenException();
    if (sale.channel !== SaleChannel.MERCADO_LIBRE || !sale.externalId || !sale.connectionId) {
      throw new BadRequestException('Solo aplica a ventas de Mercado Libre con su tienda asociada.');
    }

    // Tienda dueña de la venta: la que la tiene asignada si su cuenta de ML puede leer la orden y
    // es la vendedora; si no (p. ej. se importó mientras la tienda estaba conectada con la cuenta
    // de OTRA tienda), la tienda activa de la empresa cuya cuenta sí es la vendedora.
    let ownerConnectionId = sale.connectionId;
    let token = await this.getValidToken(sale.connectionId).catch(() => '');
    const isSeller = async (connId: string, tk: string) => {
      if (!tk) return false;
      const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connId }, select: { mlUserId: true, active: true } });
      const res = await fetch(`${ML_API}/orders/${sale.externalId}`, { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
      if (!res?.ok) return false;
      const sellerId = String(((await res.json()) as any)?.seller?.id || '');
      return !!conn?.active && (!conn.mlUserId || conn.mlUserId === sellerId);
    };
    if (!(await isSeller(sale.connectionId, token))) {
      const candidates = await this.prisma.marketplaceConnection.findMany({
        where: { companyId: sale.companyId, marketplace: MarketplaceType.MERCADO_LIBRE, active: true, accessToken: { not: '' }, id: { not: sale.connectionId } },
        select: { id: true },
      });
      for (const c of candidates) {
        const tk = await this.getValidToken(c.id).catch(() => '');
        if (await isSeller(c.id, tk)) { ownerConnectionId = c.id; token = tk; break; }
      }
      if (ownerConnectionId === sale.connectionId && !token) {
        throw new BadRequestException('Ninguna tienda activa de la empresa puede leer esta venta en Mercado Libre.');
      }
    }
    const storeChanged = ownerConnectionId !== sale.connectionId;
    const orderIds = [sale.externalId, ...sale.mlMergedOrderIds];
    const mlOrders: any[] = [];
    for (const id of orderIds) {
      const res = await fetch(`${ML_API}/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new BadRequestException(
          `No se pudo leer la orden #${id} en Mercado Libre (HTTP ${res.status})` +
          (res.status === 403 ? ': la tienda no tiene acceso a esa orden (¿está conectada con la cuenta correcta?).' : '.'),
        );
      }
      mlOrders.push(await res.json());
    }
    const main = mlOrders[0];

    // Montos con la regla de la importación, contando el envío compartido del carrito una vez.
    const amounts = await this.computeMlSaleAmounts(mlOrders, token, ownerConnectionId);
    const { total, net, fee } = amounts;
    const charges = { shippingCost: amounts.shippingCost, taxes: amounts.taxes, coupon: amounts.coupon };
    const shippingInfo = await this.getMlShippingInfo(main, token);

    const toAgree = this.isMlToAgree(main);
    const contact = await this.getMlBuyerContact(main, token);
    const receiverName = !this.isMaskedMlValue(shippingInfo.address?.receiverName) ? shippingInfo.address!.receiverName : null;
    const receiverPhone = !this.isMaskedMlValue(shippingInfo.address?.receiverPhone) ? shippingInfo.address!.receiverPhone : null;
    const customerName = receiverName || contact.name || main.buyer?.nickname || null;
    const customerPhone = receiverPhone || contact.phone || null;

    // Productos: solo se compara (cambiarlos movería stock); el detalle va en la respuesta.
    const mlQty = new Map<string, number>();
    for (const o of mlOrders) {
      for (const oi of o.order_items || []) {
        const listing = await this.prisma.listing.findFirst({
          where: { externalId: oi.item?.id, connectionId: { in: [ownerConnectionId, sale.connectionId] } }, select: { productId: true },
        });
        const key = listing?.productId || `ml:${oi.item?.title}`;
        mlQty.set(key, (mlQty.get(key) || 0) + (oi.quantity || 1));
      }
    }
    const saleQty = new Map<string, number>();
    for (const i of sale.items) saleQty.set(i.productId, (saleQty.get(i.productId) || 0) + i.quantity);
    const itemsMatch = mlQty.size === saleQty.size && [...mlQty].every(([k, q]) => saleQty.get(k) === q);

    const before = { customerName: sale.customerName, total: Number(sale.total), netAmount: sale.netAmount != null ? Number(sale.netAmount) : null };
    await this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        total,
        shippingCost: charges.shippingCost,
        marketplaceFee: fee,
        taxes: charges.taxes,
        discount: charges.coupon,
        netAmount: net,
        shippingMethod: shippingInfo.method || amounts.shippingMethod,
        paymentMethodName: this.mlPaymentLabel(main) || sale.paymentMethodName,
        customerName,
        buyerNickname: main.buyer?.nickname || sale.buyerNickname,
        customerPhone,
        customerEmail: contact.email || sale.customerEmail,
        mlPackId: main.pack_id != null ? String(main.pack_id) : sale.mlPackId,
        mlShippingId: main.shipping?.id != null ? String(main.shipping.id) : sale.mlShippingId,
        ...(storeChanged ? { connectionId: ownerConnectionId } : {}),
      },
    });
    await this.applyItemFees(this.prisma, sale.id, amounts.feeByProduct);
    const storeName = storeChanged
      ? (await this.prisma.marketplaceConnection.findUnique({ where: { id: ownerConnectionId }, select: { name: true } }))?.name || null
      : null;

    let orderId = sale.order?.id || null;
    let orderRecreated = false;
    if (orderId) {
      const current = await this.prisma.order.findUnique({ where: { id: orderId }, select: { notes: true } });
      // La nota de "a acordar" se regenera; el resto de las notas internas se conserva.
      const otherNotes = (current?.notes || '').split('\n').filter((l) => l && !l.startsWith('Entrega a acordar') && !/^(RUT|DNI|CI|Documento|[A-Z]{2,5}): /.test(l));
      const notes = [...otherNotes, ...(toAgree ? [this.mlToAgreeNote(main, contact)] : [])].join('\n') || null;
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          customerName,
          customerPhone,
          customerEmail: contact.email || null,
          address: shippingInfo.address?.addressLine || contact.address || null,
          commune: shippingInfo.address?.commune || contact.commune || null,
          region: shippingInfo.address?.region || contact.region || null,
          courier: toAgree ? ML_TO_AGREE_COURIER : shippingInfo.method,
          trackingCode: shippingInfo.trackingCode,
          notes,
        },
      });
      await this.prisma.orderStatusEvent.create({
        data: {
          orderId, source: OrderEventSource.MERCADO_LIBRE, title: 'Datos reimportados desde Mercado Libre',
          detail: `Cliente, envío y montos actualizados · venta #${sale.externalId}${storeName ? ` · tienda corregida a "${storeName}"` : ''}`, occurredAt: new Date(),
        },
      });
      await this.syncInternalOrderFromMl(main, token).catch(() => false);
    } else {
      const created = await this.createOrderForExistingSale(sale.id, user);
      orderId = created.id || null;
      orderRecreated = true;
    }

    return {
      saleId: sale.id,
      orderId,
      orderRecreated,
      storeChangedTo: storeName,
      toAgree,
      before,
      after: { customerName, total, netAmount: net },
      itemsMatch,
      itemsWarning: itemsMatch ? null
        : 'Los productos o cantidades de la venta no coinciden con Mercado Libre. No se cambiaron (moverían stock): revísalos o usa la revisión de ventas de carrito duplicadas.',
    };
  }

  // ─── Recrear la orden de despacho de una venta ya registrada ─────────────────
  // Caso típico: se eliminó la orden (Órdenes → Eliminar) para "reimportarla", pero la venta
  // sigue registrada y la importación la salta. Reimportar duplicaría la venta y el descuento de
  // stock; en cambio se recrea solo la orden con los datos actuales de ML (cliente, envío,
  // productos) y luego se sincroniza su estado/historial. El stock se descuenta solo si esta
  // venta nunca lo descontó y el envío sigue pendiente.
  // withoutStock: crea la orden sin descontar stock (también si está cancelada en ML: queda
  // Cancelada al sincronizar). Se usa para las ventas importadas como historial.
  async createOrderForExistingSale(saleId: string, user: any, opts: { withoutStock?: boolean } = {}) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true, warehouseId: true } } } },
        order: { select: { id: true } },
      },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) throw new ForbiddenException();
    if (sale.channel !== SaleChannel.MERCADO_LIBRE || !sale.externalId || !sale.connectionId) {
      throw new BadRequestException('Solo aplica a ventas de Mercado Libre con su tienda asociada.');
    }
    if (sale.order) throw new BadRequestException('Esta venta ya tiene su orden de despacho.');

    const token = await this.getValidToken(sale.connectionId);
    const orderRes = await fetch(`${ML_API}/orders/${sale.externalId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!orderRes.ok) {
      throw new BadRequestException(`No se pudo consultar la orden #${sale.externalId} en Mercado Libre (HTTP ${orderRes.status}).`);
    }
    const mlOrder = await orderRes.json() as any;
    if (mlOrder.status === 'cancelled' && !opts.withoutStock) {
      throw new BadRequestException(`La orden #${sale.externalId} está cancelada en Mercado Libre: no se crea orden de despacho.`);
    }

    const shippingInfo = await this.getMlShippingInfo(mlOrder, token);
    const toAgree = this.isMlToAgree(mlOrder);
    const buyerContact = toAgree || this.isMaskedMlValue(shippingInfo.address?.receiverName)
      ? await this.getMlBuyerContact(mlOrder, token) : null;

    // ¿Esta venta ya descontó stock alguna vez? (si vino del webhook/cron, sí; si fue importada
    // como historial, no). Solo se descuenta ahora si nunca lo hizo y el envío no ha salido.
    const itemIds = sale.items.map((i) => i.id);
    const alreadyMoved = await this.prisma.stockMovement.count({ where: { saleItemId: { in: itemIds }, type: MovementType.SALE } });
    let shipmentStatus: string | null = null;
    if (mlOrder.shipping?.id) {
      const sr = await fetch(`${ML_API}/shipments/${mlOrder.shipping.id}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (sr?.ok) shipmentStatus = ((await sr.json()) as any)?.status || null;
    }
    const notShippedYet = !shipmentStatus || ['pending', 'handling', 'ready_to_ship'].includes(shipmentStatus);
    const deductStock = !opts.withoutStock && alreadyMoved === 0 && notShippedYet;

    const warehouseCounts: Record<string, number> = {};
    for (const i of sale.items) {
      if (i.product.warehouseId) warehouseCounts[i.product.warehouseId] = (warehouseCounts[i.product.warehouseId] || 0) + i.quantity;
    }
    const warehouseId = Object.entries(warehouseCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          status: OrderStatus.PENDING,
          fulfillmentType: FulfillmentType.DELIVERY,
          customerName: (!this.isMaskedMlValue(shippingInfo.address?.receiverName) ? shippingInfo.address!.receiverName : null)
            || buyerContact?.name || sale.customerName || mlOrder.buyer?.nickname || null,
          customerPhone: (!this.isMaskedMlValue(shippingInfo.address?.receiverPhone) ? shippingInfo.address!.receiverPhone : null)
            || buyerContact?.phone || sale.customerPhone || null,
          customerEmail: buyerContact?.email || sale.customerEmail || null,
          address: shippingInfo.address?.addressLine || buyerContact?.address || null,
          commune: shippingInfo.address?.commune || buyerContact?.commune || null,
          region: shippingInfo.address?.region || buyerContact?.region || null,
          courier: toAgree ? ML_TO_AGREE_COURIER : shippingInfo.method,
          trackingCode: shippingInfo.trackingCode,
          notes: toAgree && buyerContact ? this.mlToAgreeNote(mlOrder, buyerContact) : undefined,
          // Fecha de la venta, para que Órdenes siga el orden de las ventas (más reciente primero).
          createdAt: sale.createdAt,
          companyId: sale.companyId,
          saleId: sale.id,
          warehouseId: warehouseId || undefined,
          itemChecks: {
            create: sale.items.map((i) => ({
              productId: i.productId, productName: i.product.name, productSku: i.product.sku, expectedQty: i.quantity,
            })),
          },
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id, status: OrderStatus.PENDING, source: OrderEventSource.MERCADO_LIBRE,
          title: 'Orden de despacho recreada desde Mercado Libre',
          detail: deductStock ? `Orden #${sale.externalId} · se descontó el stock` : `Orden #${sale.externalId} · sin mover stock`,
          occurredAt: new Date(),
        },
      });
      if (deductStock) {
        for (const item of sale.items) {
          const listing = await tx.listing.findFirst({
            where: { productId: item.productId, connectionId: sale.connectionId! },
            include: { product: true, connection: true },
          });
          if (listing) await this.applyItemStockEffects(tx, sale.companyId, sale.externalId!, listing, item.quantity, item.id);
        }
      }
      return order;
    });

    // Estado del envío (en camino/entregada/cancelada) e historial de seguimiento desde ML.
    await this.syncInternalOrderFromMl(mlOrder, token).catch((err) =>
      this.logger.warn(`Recrear orden ${created.id}: no se pudo sincronizar el estado con ML: ${err?.message || err}`));

    const order = await this.prisma.order.findUnique({ where: { id: created.id }, select: { id: true, status: true } });
    return {
      ...order,
      stockDeducted: deductStock,
      marketplaceStatus: shipmentStatus || mlOrder.status || 'sin envío',
    };
  }

  // Una orden de ML ya registrada: es la que creó la venta (externalId) o una orden del mismo
  // pack/envío que se fusionó en ella (mlMergedOrderIds).
  private mlOrderMatch(orderId: string) {
    return { OR: [{ externalId: orderId }, { mlMergedOrderIds: { has: orderId } }] };
  }

  private async processOrder(
    orderId: string,
    order: any,
    token: string,
    companyIdHint?: string,
    connectionId?: string,
    opts?: { skipStockEffects?: boolean },
  ): Promise<'imported' | 'skipped' | 'merged'> {
    const orderTotal = Number(order.total_amount || 0);
    const packId = order.pack_id != null ? String(order.pack_id) : null;
    const mlShippingId = order.shipping?.id != null ? String(order.shipping.id) : null;

    let companyId: string | null = companyIdHint || null;
    const resolvedItems: Array<{ listing: any; quantity: number; unitPrice: number; fee: number | null }> = [];

    for (const orderItem of order.order_items || []) {
      const itemId = orderItem.item?.id;
      const quantity = orderItem.quantity || 1;
      const unitPrice = Number(orderItem.unit_price || 0);

      const listing = await this.prisma.listing.findFirst({
        where: {
          externalId: itemId,
          ...(connectionId
            ? { connectionId }
            : { connection: { marketplace: MarketplaceType.MERCADO_LIBRE } }),
        },
        include: { product: true, connection: true },
      });
      if (!listing) continue;

      // La venta pertenece a una empresa concreta: nunca resolvemos un ítem contra el
      // catálogo de otra empresa (evita mezclar cuentas de Mercado Libre).
      if (companyIdHint && listing.connection.companyId !== companyIdHint) continue;

      companyId = companyId || listing.connection.companyId;
      // sale_fee de ML es por unidad: la comisión de la línea es sale_fee × cantidad.
      const fee = orderItem.sale_fee != null ? Math.round(Number(orderItem.sale_fee) * quantity) : null;
      resolvedItems.push({ listing, quantity, unitPrice, fee });
    }

    if (!resolvedItems.length || !companyId) return 'skipped';

    const charges = this.computeOrderCharges(order);
    const shippingInfo = await this.getMlShippingInfo(order, token);
    if (shippingInfo.sellerCost != null) charges.shippingCost = shippingInfo.sellerCost;
    charges.totalPaid = this.computeSellerNetAmount(order, charges);
    // Sin envío (o con el nombre del receptor enmascarado) los datos del cliente salen del
    // comprador y su facturación.
    const toAgree = this.isMlToAgree(order);
    const buyerContact = toAgree || this.isMaskedMlValue(shippingInfo.address?.receiverName)
      ? await this.getMlBuyerContact(order, token) : null;

    // Carrito de compras de ML: si otro ítem de este mismo pack (o del mismo envío — ML no
    // siempre informa pack_id aunque comparta shipping.id con otra orden) ya generó la
    // venta y la orden de despacho, los productos de ESTA orden se agregan ahí en vez de
    // crear una venta/orden aparte.
    const existingPackSale = packId || mlShippingId
      ? await this.prisma.sale.findFirst({
          where: {
            channel: SaleChannel.MERCADO_LIBRE,
            OR: [
              ...(packId ? [{ mlPackId: packId }] : []),
              ...(mlShippingId ? [{ mlShippingId }] : []),
            ],
          },
          include: { order: true },
        })
      : null;

    // Esta misma orden ya está en la venta (es la que la creó o ya se fusionó antes): no se
    // vuelve a sumar. Sin esto, cada webhook/cron repetía sus productos y descontaba stock.
    if (existingPackSale && (existingPackSale.externalId === orderId || existingPackSale.mlMergedOrderIds.includes(orderId))) {
      return 'skipped';
    }

    // Un carrito comparte UN envío: su costo ya se descontó del neto con la primera orden del
    // pack, así que esta orden suma su neto sin volver a restar el envío.
    const sameShipment = !!existingPackSale && !!mlShippingId && existingPackSale.mlShippingId === mlShippingId;
    const mergedNet = sameShipment ? this.computeSellerNetAmount(order, { ...charges, shippingCost: 0 }) : charges.totalPaid;

    try {
      if (existingPackSale) {
        await this.prisma.$transaction(async (tx) => {
          const newSaleItems = [];
          for (const { listing, quantity, unitPrice, fee } of resolvedItems) {
            newSaleItems.push(await tx.saleItem.create({
              data: { saleId: existingPackSale.id, productId: listing.productId, quantity, unitPrice, marketplaceFee: fee },
            }));
          }
          await tx.sale.update({
            where: { id: existingPackSale.id },
            data: {
              total: Number(existingPackSale.total) + orderTotal,
              netAmount: existingPackSale.netAmount != null
                ? Number(existingPackSale.netAmount) + mergedNet : mergedNet,
              marketplaceFee: existingPackSale.marketplaceFee != null && charges.marketplaceFee != null
                ? Number(existingPackSale.marketplaceFee) + charges.marketplaceFee : existingPackSale.marketplaceFee,
              mlPackId: existingPackSale.mlPackId ?? packId,
              mlShippingId: existingPackSale.mlShippingId ?? mlShippingId,
              mlMergedOrderIds: { push: orderId },
            },
          });
          if (existingPackSale.order) {
            await tx.order.update({
              where: { id: existingPackSale.order.id },
              data: {
                itemChecks: {
                  create: resolvedItems.map(({ listing, quantity }) => ({
                    productId: listing.productId,
                    productName: listing.product.name,
                    productSku: listing.product.sku,
                    expectedQty: quantity,
                  })),
                },
              },
            });
          }
          if (!opts?.skipStockEffects) {
            for (let i = 0; i < resolvedItems.length; i++) {
              const { listing, quantity } = resolvedItems[i];
              await this.applyItemStockEffects(tx, companyId as string, orderId, listing, quantity, newSaleItems[i].id);
            }
          }
        });
      } else {
        await this.prisma.$transaction(async (tx) => {
          const sale = await tx.sale.create({
            data: {
              channel: SaleChannel.MERCADO_LIBRE,
              externalId: orderId,
              mlPackId: packId,
              mlShippingId,
              total: orderTotal,
              shippingCost: charges.shippingCost,
              marketplaceFee: charges.marketplaceFee,
              taxes: charges.taxes,
              discount: charges.coupon,
              netAmount: charges.totalPaid,
              shippingMethod: shippingInfo.method,
              paymentMethodName: this.mlPaymentLabel(order),
              companyId: companyId as string,
              connectionId: resolvedItems[0].listing.connectionId,
              customerName: buyerContact?.name || order.buyer?.nickname || null,
              buyerNickname: order.buyer?.nickname || null,
              customerEmail: buyerContact?.email || null,
              customerPhone: buyerContact?.phone || null,
              // Sin esto, Prisma usa @default(now()) — la venta queda con la fecha en que se
              // corrió el webhook/importación en vez de la fecha real de la compra en ML.
              createdAt: new Date(order.date_created),
              items: {
                create: resolvedItems.map(({ listing, quantity, unitPrice, fee }) => ({
                  productId: listing.productId,
                  quantity,
                  unitPrice,
                  marketplaceFee: fee,
                })),
              },
            },
            include: { items: true },
          });

          // Solicitud de despacho automática: reutiliza el mismo Order que ya usa el POS,
          // así la venta entra directo al tablero de despacho y puede imprimir su etiqueta
          // sin que nadie tenga que cargarla a mano.
          const warehouseCounts: Record<string, number> = {};
          for (const { listing, quantity } of resolvedItems) {
            const whId = listing.product.warehouseId;
            if (whId) warehouseCounts[whId] = (warehouseCounts[whId] || 0) + quantity;
          }
          const autoWarehouseId = Object.entries(warehouseCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

          await tx.order.create({
            data: {
              // A diferencia de POS (nace directo en Preparando), una venta de ML sí tiene
              // una espera real antes de empezar a prepararla: falta imprimir la etiqueta de
              // Mercado Envíos, que es lo que finalmente la deja Lista para el transportista.
              // Sin Mercado Envíos ("acordar con el vendedor") no hay etiqueta: los datos salen
              // del comprador/facturación y el avance lo gestiona el panel.
              status: OrderStatus.PENDING,
              fulfillmentType: FulfillmentType.DELIVERY,
              customerName: (!this.isMaskedMlValue(shippingInfo.address?.receiverName) ? shippingInfo.address!.receiverName : null)
                || buyerContact?.name || order.buyer?.nickname || null,
              customerPhone: (!this.isMaskedMlValue(shippingInfo.address?.receiverPhone) ? shippingInfo.address!.receiverPhone : null)
                || buyerContact?.phone || null,
              customerEmail: buyerContact?.email || null,
              address: shippingInfo.address?.addressLine || buyerContact?.address || null,
              commune: shippingInfo.address?.commune || buyerContact?.commune || null,
              region: shippingInfo.address?.region || buyerContact?.region || null,
              courier: toAgree ? ML_TO_AGREE_COURIER : shippingInfo.method,
              trackingCode: shippingInfo.trackingCode,
              notes: toAgree && buyerContact ? this.mlToAgreeNote(order, buyerContact) : undefined,
              companyId: companyId as string,
              saleId: sale.id,
              warehouseId: autoWarehouseId || undefined,
              itemChecks: {
                create: resolvedItems.map(({ listing, quantity }) => ({
                  productId: listing.productId,
                  productName: listing.product.name,
                  productSku: listing.product.sku,
                  expectedQty: quantity,
                })),
              },
            },
          });

          if (!opts?.skipStockEffects) {
            for (let i = 0; i < resolvedItems.length; i++) {
              const { listing, quantity } = resolvedItems[i];
              await this.applyItemStockEffects(tx, companyId as string, orderId, listing, quantity, sale.items[i].id);
            }
          }
        });
      }
    } catch (err: any) {
      // Otra corrida (webhook vs cron, o dos ticks del cron solapados) ya insertó esta orden
      // entre nuestro chequeo previo y este create: el constraint único la frena acá.
      if (err?.code === 'P2002') {
        this.logger.log(`ML orden ${orderId} ya fue importada por otro proceso`);
        return 'skipped';
      }
      throw err;
    }

    // Sincronizar otras plataformas tras la venta de ML (no aplica si no se tocó stock).
    if (!opts?.skipStockEffects) {
      for (const { listing, quantity } of resolvedItems) {
        const newStock = Math.max(0, listing.product.stock - quantity);
        this.sync.syncProduct(listing.productId, newStock).catch((e) =>
          this.logger.error(`Sync otras plataformas tras venta ML: ${e.message}`),
        );
      }
    }

    this.activity.logImport({
      companyId: companyId as string, module: 'Ventas', action: 'IMPORTAR', entity: 'sale', entityLabel: orderId,
      summary: existingPackSale ? `Se agregó la orden ${orderId} de Mercado Libre a una venta de carrito` : `Venta importada de Mercado Libre n° ${orderId}`,
      href: '/dashboard/sales',
    });
    return existingPackSale ? 'merged' : 'imported';
  }

  // Recuperación manual para carritos que ML dividió en varias "orders" con pack_id vacío
  // y que por eso no se consolidaron solas (ver processOrder) — se detectaron a mano
  // comparando shipping.id. Traslada los ítems/checklist de la venta duplicada a la
  // principal, repone el stock que se descontó de más (mismo criterio que una devolución:
  // no reconstruye los lotes FIFO consumidos, solo devuelve la cantidad al total del
  // producto) y elimina la venta/orden duplicada.
  async mergeDuplicateSales(primarySaleId: string, duplicateSaleId: string, user: any): Promise<{ mergedItems: number; restockedProducts: number }> {
    if (primarySaleId === duplicateSaleId) throw new BadRequestException('No se puede fusionar una venta consigo misma.');

    const [primary, duplicate] = await Promise.all([
      this.prisma.sale.findUnique({ where: { id: primarySaleId }, include: { order: { include: { itemChecks: true } } } }),
      this.prisma.sale.findUnique({ where: { id: duplicateSaleId }, include: { order: { include: { itemChecks: true } }, items: true } }),
    ]);
    if (!primary || !duplicate) throw new NotFoundException('Venta no encontrada');
    if (primary.channel !== SaleChannel.MERCADO_LIBRE || duplicate.channel !== SaleChannel.MERCADO_LIBRE) {
      throw new BadRequestException('Esta fusión solo aplica a ventas de Mercado Libre.');
    }
    if (primary.companyId !== duplicate.companyId) throw new BadRequestException('Las ventas pertenecen a empresas distintas.');
    if (user.role !== Role.SUPER_ADMIN && user.companyId !== primary.companyId) throw new ForbiddenException();

    const products = await this.prisma.product.findMany({
      where: { id: { in: duplicate.items.map((i) => i.productId) } },
      select: { id: true, dropship: true },
    });
    const dropshipIds = new Set(products.filter((p) => p.dropship).map((p) => p.id));

    let restockedProducts = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.saleItem.updateMany({ where: { saleId: duplicateSaleId }, data: { saleId: primarySaleId } });

      await tx.sale.update({
        where: { id: primarySaleId },
        data: {
          total: Number(primary.total) + Number(duplicate.total),
          netAmount: primary.netAmount != null || duplicate.netAmount != null
            ? Number(primary.netAmount ?? 0) + Number(duplicate.netAmount ?? 0) : undefined,
          marketplaceFee: primary.marketplaceFee != null || duplicate.marketplaceFee != null
            ? Number(primary.marketplaceFee ?? 0) + Number(duplicate.marketplaceFee ?? 0) : undefined,
          mlPackId: primary.mlPackId ?? duplicate.mlPackId,
          mlShippingId: primary.mlShippingId ?? duplicate.mlShippingId,
        },
      });

      for (const item of duplicate.items) {
        if (dropshipIds.has(item.productId)) continue;
        await this.ledger.move(tx, {
          productId: item.productId, delta: item.quantity, type: MovementType.ADJUSTMENT,
          reason: `Repone stock por fusión de venta duplicada de ML (orden ${duplicate.externalId} unida a ${primary.externalId})`,
          userId: user.id, reference: { type: 'ADJUSTMENT', id: duplicateSaleId },
        });
        restockedProducts++;
      }

      if (duplicate.order) {
        if (primary.order) {
          await tx.orderItemCheck.updateMany({ where: { orderId: duplicate.order.id }, data: { orderId: primary.order.id } });
          await tx.order.delete({ where: { id: duplicate.order.id } });
        } else {
          await tx.order.update({ where: { id: duplicate.order.id }, data: { saleId: primarySaleId } });
        }
      }

      await tx.sale.delete({ where: { id: duplicateSaleId } });
    });

    return { mergedItems: duplicate.items.length, restockedProducts };
  }

  // ─── Etiqueta de envío (Mercado Envíos 2) ──────────────────────────────────────

  // Trae el PDF de la etiqueta de despacho desde Mercado Libre para una Orden interna.
  // Solo funciona para envíos Mercado Envíos (me2) que ya están "listos para imprimir" —
  // ver https://developers.mercadolibre.com.ar/es_ar/mercadoenvios-modo-2#Imprimir-etiquetas-de-envío.
  // Reimprimible las veces que haga falta (ML lo permite mientras el envío siga
  // "ready_to_print" o ya "printed"): no vuelve a tocar el estado si la orden ya avanzó
  // más allá de Pendiente.
  private async resolvePrintableShipment(orderId: string, user: any): Promise<{ order: any; shippingId: string; token: string; shipment: any }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { sale: true },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) throw new ForbiddenException();
    if (order.sale?.channel !== SaleChannel.MERCADO_LIBRE || !order.sale.externalId) {
      throw new BadRequestException('Esta orden no corresponde a una venta de Mercado Libre.');
    }
    if (!order.sale.connectionId) {
      throw new BadRequestException('La venta no tiene una conexión de Mercado Libre asociada.');
    }

    const token = await this.getValidToken(order.sale.connectionId);

    const orderRes = await fetch(`${ML_API}/orders/${order.sale.externalId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!orderRes.ok) throw new BadRequestException('No se pudo consultar la orden en Mercado Libre.');
    const mlOrder = await orderRes.json();
    const shippingId = mlOrder.shipping?.id;
    if (!shippingId) throw new BadRequestException('Esta orden no tiene un envío de Mercado Libre asociado.');

    const shipRes = await fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!shipRes.ok) throw new BadRequestException('No se pudo consultar el envío en Mercado Libre.');
    const shipment = await shipRes.json();

    if (shipment.mode !== 'me2') {
      throw new BadRequestException('Este envío no es Mercado Envíos — no tiene etiqueta para imprimir desde acá.');
    }
    if (shipment.logistic_type === 'fulfillment') {
      throw new BadRequestException('Los envíos Full los despacha Mercado Libre desde su propia bodega: no hay etiqueta de venta que imprimir.');
    }
    const printable = shipment.status === 'ready_to_ship' && ['ready_to_print', 'printed'].includes(shipment.substatus);
    if (!printable) {
      throw new BadRequestException(
        `El envío todavía no está listo para imprimir en Mercado Libre (estado: ${shipment.status}/${shipment.substatus || 'sin subestado'}).`,
      );
    }

    return { order, shippingId: String(shippingId), token, shipment };
  }

  // Al imprimir por primera vez (orden en Pendiente) pasa a Preparando — es la señal de
  // que el vendedor ya puede empezar a alistar el pedido. Reimprimir después no repite
  // este avance, solo entrega el PDF de nuevo.
  private async advanceAfterLabelPrint(order: any, shipment: any): Promise<void> {
    if (order.status !== OrderStatus.PENDING) return;
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PREPARING,
        trackingCode: shipment.tracking_number ? String(shipment.tracking_number) : order.trackingCode,
      },
    });    await this.recordMlStatusChange(order.id, OrderStatus.PREPARING, 'Etiqueta impresa — en preparación', null, new Date());
  }

  // Vuelve a traer los datos reales desde Mercado Libre para una Orden ya existente:
  // order_id/pack_id/shipment_id de la venta, y courier (Turbo incluido)/región/tracking
  // del despacho. Pensado para corregir órdenes creadas antes de estos fixes, o cuando ML
  // simplemente no entregó bien el dato la primera vez. No descuenta stock ni cambia el
  // estado de la orden.
  async refreshOrderFromMl(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { sale: true } });
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) throw new ForbiddenException();
    if (order.sale?.channel !== SaleChannel.MERCADO_LIBRE || !order.sale.externalId) {
      throw new BadRequestException('Esta orden no corresponde a una venta de Mercado Libre.');
    }
    if (!order.sale.connectionId) {
      throw new BadRequestException('La venta no tiene una conexión de Mercado Libre asociada.');
    }

    const token = await this.getValidToken(order.sale.connectionId);
    const orderRes = await fetch(`${ML_API}/orders/${order.sale.externalId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!orderRes.ok) throw new BadRequestException('No se pudo consultar la orden en Mercado Libre.');
    const mlOrder = await orderRes.json();

    const packId = mlOrder.pack_id != null ? String(mlOrder.pack_id) : null;
    const mlShippingId = mlOrder.shipping?.id != null ? String(mlOrder.shipping.id) : null;
    const shippingInfo = await this.getMlShippingInfo(mlOrder, token);

    await this.prisma.sale.update({
      where: { id: order.sale.id },
      data: {
        ...(packId ? { mlPackId: packId } : {}),
        ...(mlShippingId ? { mlShippingId } : {}),
      },
    });

    // No pisa un dato bueno con la máscara "XXXXXXX" de ML: solo aplica nombre/teléfono si
    // lo que llega ahora ya está revelado.
    const receiverName = shippingInfo.address?.receiverName;
    const receiverPhone = shippingInfo.address?.receiverPhone;

    // Venta a acordar (sin envío): nombre real, RUT y dirección de facturación del comprador.
    // Solo completa lo vacío o el apodo de ML que quedó como nombre; no pisa lo editado a mano.
    const toAgree = this.isMlToAgree(mlOrder);
    const contact = toAgree || this.isMaskedMlValue(receiverName) ? await this.getMlBuyerContact(mlOrder, token) : null;
    const current = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { customerName: true, customerPhone: true, customerEmail: true, address: true, commune: true, region: true, courier: true, notes: true },
    });
    const nameIsNickname = !current?.customerName || current.customerName === mlOrder.buyer?.nickname;
    const contactData: any = {};
    if (contact) {
      if (contact.name && nameIsNickname) contactData.customerName = contact.name;
      if (contact.phone && !current?.customerPhone) contactData.customerPhone = contact.phone;
      if (contact.email && !current?.customerEmail) contactData.customerEmail = contact.email;
      if (contact.address && !current?.address) contactData.address = contact.address;
      if (contact.commune && !current?.commune) contactData.commune = contact.commune;
      if (contact.region && !current?.region) contactData.region = contact.region;
    }
    if (toAgree) {
      if (!current?.courier) contactData.courier = ML_TO_AGREE_COURIER;
      const note = this.mlToAgreeNote(mlOrder, contact || { name: null, phone: null, email: null, docType: null, docNumber: null, address: null, commune: null, region: null });
      if (!current?.notes?.includes('Entrega a acordar')) contactData.notes = [current?.notes, note].filter(Boolean).join('\n');
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...contactData,
        ...(shippingInfo.method ? { courier: shippingInfo.method } : {}),
        ...(shippingInfo.trackingCode ? { trackingCode: shippingInfo.trackingCode } : {}),
        ...(shippingInfo.address?.region ? { region: shippingInfo.address.region } : {}),
        ...(shippingInfo.address?.commune ? { commune: shippingInfo.address.commune } : {}),
        ...(shippingInfo.address?.addressLine ? { address: shippingInfo.address.addressLine } : {}),
        ...(!this.isMaskedMlValue(receiverName) ? { customerName: receiverName } : {}),
        ...(!this.isMaskedMlValue(receiverPhone) ? { customerPhone: receiverPhone } : {}),
      },
      include: { sale: { select: { id: true, externalId: true, mlPackId: true, mlShippingId: true } } },
    });

    // Además del despacho, trae el estado y el historial de seguimiento del envío.
    await this.syncInternalOrderFromMl(mlOrder, token);

    return updated;
  }

  // PDF de la etiqueta de Mercado Envíos de uno o varios envíos (una sola cuenta/token).
  private async fetchLabelPdf(shippingIds: string, token: string): Promise<Buffer> {
    const labelRes = await fetch(`${ML_API}/shipment_labels?shipment_ids=${shippingIds}&response_type=pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!labelRes.ok) {
      const text = await labelRes.text().catch(() => '');
      throw new BadRequestException(`Mercado Libre no entregó la etiqueta (HTTP ${labelRes.status}). ${text.slice(0, 200)}`);
    }
    return Buffer.from(await labelRes.arrayBuffer());
  }

  // Datos de la página "detalle del pedido" que acompaña a la etiqueta (ver label-detail.ts).
  // Público: también lo usa la etiqueta con detalle de JumpSeller.
  async loadLabelDetail(orderId: string): Promise<LabelDetailOrder | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        itemChecks: {
          orderBy: { productName: 'asc' },
          include: { product: { select: { images: { select: { url: true }, orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }], take: 1 } } } },
        },
        sale: { select: { externalId: true, mlPackId: true, mlMergedOrderIds: true, connection: { select: { name: true } } } },
      },
    });
    if (!order) return null;
    return {
      // En un carrito, el número que muestra Mercado Libre en la venta es el del pack.
      orderNumber: order.sale?.mlPackId || order.sale?.externalId || order.id.slice(-6).toUpperCase(),
      numberLabel: order.sale?.mlPackId ? 'Pack' : 'Orden',
      packId: order.sale?.mlPackId
        ? `Orden(es) ML: ${[order.sale.externalId, ...(order.sale.mlMergedOrderIds || [])].filter(Boolean).join(', ')}`
        : null,
      storeName: order.sale?.connection?.name,
      customerName: order.customerName,
      commune: order.commune,
      courier: order.courier,
      trackingCode: order.trackingCode,
      notes: order.notes,
      items: order.itemChecks.map((i) => ({
        name: i.productName, sku: i.productSku, quantity: i.expectedQty, imageUrl: i.product?.images?.[0]?.url || null,
      })),
    };
  }

  // withDetail: después de la etiqueta agrega una página con los productos del pedido.
  async printShippingLabel(orderId: string, user: any, withDetail = false): Promise<Buffer> {
    const { order, shippingId, token, shipment } = await this.resolvePrintableShipment(orderId, user);

    const label = await this.fetchLabelPdf(String(shippingId), token);
    const buffer = withDetail
      ? await buildLabelsPdf([{ label, detail: await this.loadLabelDetail(order.id) }])
      : label;

    await this.advanceAfterLabelPrint(order, shipment);

    return buffer;
  }

  // Impresión masiva desde la lista de Órdenes: agrupa por conexión (Mercado Libre exige
  // un token por cuenta) y pide un solo PDF combinado por grupo — así seleccionar 20
  // pedidos de una misma tienda imprime UN PDF con las 20 etiquetas, no 20 aparte.
  async printShippingLabelsBulk(
    orderIds: string[],
    user: any,
    withDetail = false,
  ): Promise<{ pdfs: { connectionName: string; buffer: Buffer }[]; printed: string[]; errors: { orderId: string; message: string }[] }> {
    if (orderIds.length > 50) throw new BadRequestException('Máximo 50 órdenes por impresión masiva.');

    const errors: { orderId: string; message: string }[] = [];
    const resolved: { orderId: string; order: any; shippingId: string; token: string; shipment: any }[] = [];

    for (const orderId of orderIds) {
      try {
        const r = await this.resolvePrintableShipment(orderId, user);
        resolved.push({ orderId, ...r });
      } catch (err: any) {
        errors.push({ orderId, message: err?.message || 'Error inesperado' });
      }
    }

    if (!resolved.length) {
      throw new BadRequestException(
        `Ninguna de las órdenes seleccionadas tiene una etiqueta lista para imprimir: ${errors.map((e) => e.message).join('; ')}`,
      );
    }

    const byConnection = new Map<string, typeof resolved>();
    for (const r of resolved) {
      const key = r.order.sale.connectionId as string;
      const list = byConnection.get(key) || [];
      list.push(r);
      byConnection.set(key, list);
    }

    const printed: string[] = [];
    const pdfs: { connectionName: string; buffer: Buffer }[] = [];

    for (const [connectionId, items] of byConnection) {
      const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { name: true } });
      let buffer: Buffer;
      let ok = items;
      if (!withDetail) {
        try {
          buffer = await this.fetchLabelPdf(items.map((i) => i.shippingId).join(','), items[0].token);
        } catch (err: any) {
          for (const i of items) errors.push({ orderId: i.orderId, message: err?.message || 'Mercado Libre no entregó la etiqueta' });
          continue;
        }
      } else {
        // Con detalle: una etiqueta por envío para intercalar su página de productos a continuación
        // (del PDF combinado de ML no se puede saber qué página es de qué orden).
        const entries: { label: Buffer; detail: LabelDetailOrder | null }[] = [];
        ok = [];
        for (const i of items) {
          try {
            entries.push({ label: await this.fetchLabelPdf(String(i.shippingId), i.token), detail: await this.loadLabelDetail(i.order.id) });
            ok.push(i);
          } catch (err: any) {
            errors.push({ orderId: i.orderId, message: err?.message || 'Mercado Libre no entregó la etiqueta' });
          }
        }
        if (!entries.length) continue;
        buffer = await buildLabelsPdf(entries);
      }
      pdfs.push({ connectionName: conn?.name || 'Mercado Libre', buffer });
      for (const i of ok) {
        await this.advanceAfterLabelPrint(i.order, i.shipment);
        printed.push(i.orderId);
      }
    }

    if (!pdfs.length) {
      throw new BadRequestException(`No se pudo generar ninguna etiqueta: ${errors.map((e) => `${e.orderId}: ${e.message}`).join('; ')}`);
    }

    return { pdfs, printed, errors };
  }

  // ─── Estado de la Orden interna reflejando Mercado Libre ──────────────────────

  // Trae el estado real del envío en Mercado Libre y lo refleja en la Orden interna
  // vinculada a esa venta. Solo avanza hacia adelante en el ciclo de vida (nunca
  // retrocede un estado ya alcanzado) y una orden CANCELLED o DELIVERED ya no se toca
  // más — son estados finales. Devuelve true si efectivamente cambió algo.
  private async syncInternalOrderFromMl(mlOrder: any, token: string): Promise<boolean> {
    // Si esta orden es parte de un pack (carrito) ya consolidado bajo OTRO order id, el
    // externalId de la venta no va a calzar — se busca también por pack_id o por
    // shipping.id (ML no siempre informa pack_id aunque comparta envío) para no perder los
    // avisos de estado de los demás ítems del mismo carrito/envío.
    let sale = await this.prisma.sale.findFirst({
      where: { channel: SaleChannel.MERCADO_LIBRE, externalId: String(mlOrder.id) },
      include: { order: true },
    });
    if (!sale && (mlOrder.pack_id != null || mlOrder.shipping?.id != null)) {
      sale = await this.prisma.sale.findFirst({
        where: {
          channel: SaleChannel.MERCADO_LIBRE,
          OR: [
            ...(mlOrder.pack_id != null ? [{ mlPackId: String(mlOrder.pack_id) }] : []),
            ...(mlOrder.shipping?.id != null ? [{ mlShippingId: String(mlOrder.shipping.id) }] : []),
          ],
        },
        include: { order: true },
      });
    }
    if (sale && !sale.buyerNickname && mlOrder.buyer?.nickname) {
      await this.prisma.sale.update({ where: { id: sale.id }, data: { buyerNickname: String(mlOrder.buyer.nickname) } }).catch(() => {});
    }
    const order = sale?.order;
    if (!order) return false;

    // El estado del envío solo existe si la venta usa Mercado Envíos (cualquier modalidad:
    // colecta, drop-off, Flex, Full). Se trae siempre, también para órdenes ya cerradas,
    // para completar el historial de seguimiento con lo que informe ML.
    const shippingId = mlOrder.shipping?.id;
    let shipment: any = null;
    if (shippingId) {
      try {
        const res = await fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) shipment = await res.json();
      } catch {
        /* sin envío: solo se evalúa la cancelación */
      }
      if (shipment) await this.syncMlShipmentHistory(order.id, String(shippingId), token, shipment);
    }

    if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) return false;

    // Una orden cancelada en ML gana siempre, sin importar en qué etapa interna estaba
    // (picking/packing/despacho) — puede requerir revertir algo físico, por eso queda
    // una nota visible en la orden en vez de cancelarla en silencio. Nota: si el pack tiene
    // varios ítems y ML cancela solo uno, esto igual cancela la orden consolidada completa
    // (no hay soporte todavía para anular una sola línea de un pack).
    if (mlOrder.status === 'cancelled') {
      const note = `⚠️ Cancelada en Mercado Libre (${new Date().toLocaleString('es-CL')}). Revisa si ya se preparó o despachó.`;
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED, notes: [order.notes, note].filter(Boolean).join('\n') },
      });
      await this.recordMlStatusChange(order.id, OrderStatus.CANCELLED, 'Orden cancelada en Mercado Libre', null, new Date());
      return true;
    }

    if (!shipment) return false;

    const tracking = {
      trackingCode: shipment.tracking_number ? String(shipment.tracking_number) : order.trackingCode,
      courier: shipment.shipping_option?.name || order.courier,
    };

    if (shipment.status === 'delivered') {
      const deliveredAt = this.mlDate(shipment.status_history?.date_delivered) ?? new Date();
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.DELIVERED, deliveredAt, ...tracking },
      });
      await this.recordMlStatusChange(order.id, OrderStatus.DELIVERED, 'Entregado según Mercado Libre', this.mlReceiverDetail(shipment), deliveredAt);
      return true;
    }

    // Despachado: en camino, o ya entregado al transportista (retiro en bodega o dejado en
    // punto/agencia) aunque ML todavía no lo pase a "shipped".
    const handedOver = shipment.status === 'shipped'
      || (shipment.status === 'ready_to_ship' && ['picked_up', 'dropped_off'].includes(shipment.substatus));
    if (handedOver && order.status !== OrderStatus.IN_TRANSIT) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.IN_TRANSIT, ...tracking },
      });
      const when = this.mlDate(shipment.status_history?.date_shipped) ?? new Date();
      const detail = [tracking.courier, tracking.trackingCode && `Seguimiento ${tracking.trackingCode}`].filter(Boolean).join(' · ');
      await this.recordMlStatusChange(order.id, OrderStatus.IN_TRANSIT, 'Despachado según Mercado Libre', detail || null, when);
      return true;
    }

    // Etiqueta impresa directamente en Mercado Libre (no desde acá): mismo avance que
    // al imprimirla desde el sistema — Pendiente pasa a Preparando.
    if (shipment.status === 'ready_to_ship' && shipment.substatus === 'printed' && order.status === OrderStatus.PENDING) {
      await this.advanceAfterLabelPrint(order, shipment);
      return true;
    }

    return false;
  }

  private mlDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // ML no expone públicamente quién firmó la recepción; lo más cercano que entrega es el
  // destinatario registrado en el envío (y un comentario, si viene en el hito).
  private mlReceiverDetail(shipment: any, entry?: any): string | null {
    const parts: string[] = [];
    const receiver = entry?.receiver_name || shipment?.receiver_address?.receiver_name;
    if (receiver && !this.isMaskedMlValue(receiver)) parts.push(`Destinatario: ${receiver}`);
    const comment = entry?.comment || entry?.description;
    if (comment && typeof comment === 'string') parts.push(comment);
    return parts.length ? parts.join(' · ') : null;
  }

  private async recordMlStatusChange(orderId: string, status: OrderStatus, title: string, detail: string | null, occurredAt: Date) {
    await this.prisma.orderStatusEvent.create({
      data: { orderId, status, source: OrderEventSource.MERCADO_LIBRE, title, detail, occurredAt },
    });
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, select: { companyId: true, sale: { select: { externalId: true } } } }).catch(() => null);
    if (o) {
      const ref = o.sale?.externalId || orderId.slice(-8);
      this.activity.logSystem({
        companyId: o.companyId, module: 'Órdenes', action: 'ESTADO', entity: 'order', entityId: orderId, entityLabel: `#${ref}`,
        summary: `Orden #${ref}: ${title} (informado por Mercado Libre)`, href: `/dashboard/orders/${orderId}`,
      });
    }
  }

  // Importa al historial de la orden los hitos del envío que informa ML: las fechas de
  // status_history del propio envío y, si responde, el detalle de /shipments/{id}/history
  // (con subestados como etiqueta impresa, retirado, en reparto, destinatario ausente...).
  // Idempotente: cada hito se identifica por estado|subestado|minuto y no se duplica.
  private async syncMlShipmentHistory(orderId: string, shippingId: string, token: string, shipment: any): Promise<void> {
    const entries: { status: string; substatus: string | null; date: Date; raw?: any }[] = [];

    const sh = shipment.status_history || {};
    const fromStatusHistory: [string, string][] = [
      ['date_handling', 'handling'],
      ['date_ready_to_ship', 'ready_to_ship'],
      ['date_shipped', 'shipped'],
      ['date_first_visit', 'first_visit'],
      ['date_not_delivered', 'not_delivered'],
      ['date_delivered', 'delivered'],
      ['date_returned', 'returned'],
      ['date_cancelled', 'cancelled'],
    ];
    for (const [field, status] of fromStatusHistory) {
      const date = this.mlDate(sh[field]);
      if (date) entries.push({ status, substatus: null, date });
    }

    try {
      const res = await fetch(`${ML_API}/shipments/${shippingId}/history`, {
        headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
      });
      if (res.ok) {
        const data: any = await res.json();
        const list: any[] = Array.isArray(data) ? data : (data?.results || data?.history || data?.data || []);
        for (const e of list) {
          const date = this.mlDate(e?.date || e?.date_created || e?.last_updated);
          if (!e?.status || !date) continue;
          entries.push({ status: String(e.status), substatus: e.substatus ? String(e.substatus) : null, date, raw: e });
        }
      }
    } catch {
      /* el detalle es opcional: con status_history alcanza para los hitos principales */
    }

    for (const e of entries) {
      const minute = new Date(Math.floor(e.date.getTime() / 60000) * 60000).toISOString();
      const externalKey = `ml:${e.status}|${e.substatus ?? ''}|${minute}`;
      try {
        await this.prisma.orderStatusEvent.upsert({
          where: { orderId_externalKey: { orderId, externalKey } },
          update: {},
          create: {
            orderId,
            source: OrderEventSource.MERCADO_LIBRE,
            title: this.mlShipmentLabel(e.status, e.substatus),
            detail: e.status === 'delivered' ? this.mlReceiverDetail(shipment, e.raw) : null,
            externalStatus: e.status,
            externalSubstatus: e.substatus,
            externalKey,
            occurredAt: e.date,
          },
        });
      } catch {
        /* carrera con otra sincronización del mismo hito: ya quedó registrado */
      }
    }
  }

  private mlShipmentLabel(status: string, substatus: string | null): string {
    return mlShipmentLabel(status, substatus);
  }

  // Webhook del tópico "shipments": ML avisa por acá los cambios del envío (etiqueta
  // impresa, despachado, entregado), que no siempre llegan también como orders_v2.
  private async handleShipmentWebhook(body: any) {
    const shippingId = body.resource?.split('/').pop();
    if (!shippingId) return { received: true };

    try {
      const sale = await this.prisma.sale.findFirst({
        where: { channel: SaleChannel.MERCADO_LIBRE, mlShippingId: String(shippingId), connectionId: { not: null } },
      });

      let mlOrder: any = null;
      let token = '';
      if (sale?.connectionId && sale.externalId) {
        token = await this.getValidToken(sale.connectionId);
        const res = await fetch(`${ML_API}/orders/${sale.externalId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) mlOrder = await res.json();
      } else {
        // Ventas importadas antes de guardar mlShippingId: se resuelve la orden desde el
        // propio envío, probando cada conexión hasta dar con la dueña.
        const mlConnections = await this.prisma.marketplaceConnection.findMany({
          where: { marketplace: MarketplaceType.MERCADO_LIBRE, active: true, accessToken: { not: '' } },
        });
        for (const conn of mlConnections) {
          try {
            const t = await this.getValidToken(conn.id);
            const shipRes = await fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${t}` } });
            if (!shipRes.ok) continue;
            const shipment = await shipRes.json();
            if (!shipment.order_id) break;
            const res = await fetch(`${ML_API}/orders/${shipment.order_id}`, { headers: { Authorization: `Bearer ${t}` } });
            if (!res.ok) break;
            mlOrder = await res.json();
            token = t;
            break;
          } catch {
            /* probamos la siguiente conexión */
          }
        }
      }

      if (mlOrder) await this.syncInternalOrderFromMl(mlOrder, token);
    } catch (error) {
      this.logger.error('Error procesando webhook ML de envío', error);
    }
    return { received: true };
  }

  // Barrido periódico (Auto-sync ML): revisa las órdenes de esta conexión que todavía
  // no llegaron a un estado final por si algún webhook de ML se perdió. Se acota a los
  // últimos 30 días para no reconsultar historial completo en cada corrida.
  async syncActiveOrderStatuses(connectionId: string, user: any): Promise<{ checked: number; updated: number }> {
    const connection = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const sales = await this.prisma.sale.findMany({
      where: {
        channel: SaleChannel.MERCADO_LIBRE,
        companyId: connection.companyId,
        createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        order: { status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] } },
      },
      select: { externalId: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    let updated = 0;
    for (const s of sales) {
      try {
        const res = await fetch(`${ML_API}/orders/${s.externalId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const mlOrder = await res.json();
        if (await this.syncInternalOrderFromMl(mlOrder, token)) updated++;
      } catch {
        // seguir con la siguiente orden
      }
    }
    return { checked: sales.length, updated };
  }

  // ─── Webhook ─────────────────────────────────────────────────────────────────

  async handleWebhook(body: any) {
    this.logger.log(`ML Webhook: topic=${body.topic} resource=${body.resource}`);
    if (body.topic === 'questions') return this.handleQuestionWebhook(body);
    if (body.topic === 'claims') return this.handleClaimWebhook(body);
    if (body.topic === 'orders_feedback') return this.handleFeedbackWebhook(body);
    if (body.topic === 'shipments') return this.handleShipmentWebhook(body);
    if (body.topic !== 'orders_v2') return { received: true };

    try {
      const orderId = body.resource?.split('/').pop();
      if (!orderId) return { received: true };

      // Si ya existe la venta, este webhook no la crea de nuevo — pero sí puede traer un
      // cambio de estado (cancelada, despachada, entregada) que hay que reflejar en la
      // Orden interna, así que igual seguimos y consultamos la orden fresca en ML.
      const existing = await this.prisma.sale.findFirst({
        where: { channel: SaleChannel.MERCADO_LIBRE, ...this.mlOrderMatch(orderId) },
      });

      // La orden pertenece a una cuenta de ML concreta: probamos cada conexión de ML
      // activa y nos quedamos con la que puede leer la orden (las demás dan 401/403/404).
      // Así el webhook nunca resuelve la venta contra la cuenta/empresa equivocada.
      const mlConnections = await this.prisma.marketplaceConnection.findMany({
        where: { marketplace: MarketplaceType.MERCADO_LIBRE, active: true, accessToken: { not: '' }, syncEnabled: true, company: { autoSyncSales: true } },
      });

      let order: any = null;
      let token = '';
      let connectionId = '';
      let companyId = '';
      for (const conn of mlConnections) {
        try {
          const t = await this.getValidToken(conn.id);
          const res = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${t}` } });
          if (!res.ok) continue;
          order = await res.json();
          token = t;
          connectionId = conn.id;
          companyId = conn.companyId;
          break;
        } catch {
          /* probamos la siguiente conexión */
        }
      }

      if (!order) {
        this.logger.warn(`ML Webhook: ninguna conexión de ML pudo leer la orden ${orderId}`);
        return { received: true };
      }

      if (existing) {
        await this.syncInternalOrderFromMl(order, token);
      } else {
        await this.processOrder(orderId, order, token, companyId, connectionId);
      }
    } catch (error) {
      this.logger.error('Error procesando webhook ML', error);
    }

    return { received: true };
  }

  // ─── Auto-sync (cron) ────────────────────────────────────────────────────────

  // Busca y procesa las órdenes nuevas de una conexión ML desde la última corrida
  // (con 2 min de solape), con el mismo efecto que el webhook: descuenta stock,
  // crea StockMovement y pausa el listing en ML si el stock llega a 0.
  async importRecentSalesForConnection(connectionId: string): Promise<{ imported: number; skipped: number; errors: number }> {
    const connection = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!connection) return { imported: 0, skipped: 0, errors: 0 };

    const token = await this.getValidToken(connectionId);

    const to = new Date();
    // Traslape amplio: ML a veces tarda varios minutos en mostrar una orden nueva en
    // /orders/search; con solo 2 min de traslape esa orden quedaba fuera de toda ventana y no
    // se importaba nunca. Las ya registradas se saltan en la base, sin pedirlas a ML.
    const from = connection.lastSalesImportAt
      ? new Date(connection.lastSalesImportAt.getTime() - 60 * 60 * 1000)
      : new Date(to.getTime() - 60 * 60 * 1000);

    const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) throw new InternalServerErrorException('No se pudo obtener el usuario de Mercado Libre');
    const me = await meRes.json() as any;

    const MAX_ORDERS = 100;
    const baseParams = new URLSearchParams({
      seller: String(me.id),
      limit: '50',
      'order.date_created.from': from.toISOString(),
      'order.date_created.to': to.toISOString(),
    });

    const orderIds: string[] = [];
    let offset = 0;
    let total = 0;
    do {
      const params = new URLSearchParams(baseParams);
      params.set('offset', String(offset));
      const res = await fetch(`${ML_API}/orders/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`Auto-sync ML orders/search falló [${res.status}] conexión ${connectionId}: ${errBody}`);
        throw new InternalServerErrorException(`Mercado Libre rechazó la búsqueda de ventas (HTTP ${res.status})`);
      }
      const data = await res.json() as any;
      total = data.paging?.total || 0;
      orderIds.push(...(data.results || []).map((o: any) => String(o.id)));
      offset += 50;
    } while (offset < total && orderIds.length < MAX_ORDERS);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const orderId of orderIds) {
      try {
        const existing = await this.prisma.sale.findFirst({
          where: { channel: SaleChannel.MERCADO_LIBRE, ...this.mlOrderMatch(orderId) },
        });
        if (existing) { skipped++; continue; }

        const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!orderRes.ok) { errors++; continue; }
        const order = await orderRes.json() as any;

        const result = await this.processOrder(orderId, order, token, connection.companyId, connection.id);
        if (result === 'imported' || result === 'merged') imported++; else skipped++;
      } catch (err: any) {
        errors++;
        this.logger.error(`Auto-sync ML: error procesando orden ${orderId} (conexión ${connectionId}): ${err?.message || err}`);
      }
    }

    // Solo avanzamos el cursor si la búsqueda en sí funcionó (llegamos hasta acá);
    // errores de órdenes individuales no impiden avanzar, para no reintentarlas indefinidamente
    // si el problema es de datos (ej. producto no vinculado) y no transitorio.
    await this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: { lastSalesImportAt: to },
    });

    return { imported, skipped, errors };
  }

  // ─── Módulo Mercado Libre: helpers comunes ───────────────────────────────────

  private async findActiveMlConnections() {
    return this.prisma.marketplaceConnection.findMany({
      where: { marketplace: MarketplaceType.MERCADO_LIBRE, active: true, accessToken: { not: '' } },
    });
  }

  private companyFilter(user: any, companyId?: string): Record<string, any> {
    if (user.role !== Role.SUPER_ADMIN) return { companyId: user.companyId };
    return companyId ? { companyId } : {};
  }

  // Igual estrategia que el webhook de órdenes: una notificación de ML no dice a qué
  // cuenta/empresa pertenece, así que se prueba cada conexión activa hasta que una
  // pueda leer el recurso.
  private async fetchWithAnyMlConnection(path: string): Promise<{ data: any; connection: any } | null> {
    for (const conn of await this.findActiveMlConnections()) {
      try {
        const token = await this.getValidToken(conn.id);
        const res = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        return { data: await res.json(), connection: conn };
      } catch {
        /* probamos la siguiente conexión */
      }
    }
    return null;
  }

  // ─── Preguntas ────────────────────────────────────────────────────────────────

  async listQuestions(user: any, status?: string, companyId?: string) {
    const where: any = this.companyFilter(user, companyId);
    if (status && status !== 'ALL') where.status = status;
    const [rows, unanswered] = await Promise.all([
      this.prisma.mlQuestion.findMany({
        where,
        include: {
          product: {
            select: {
              id: true, name: true, sku: true,
              images: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }], take: 1, select: { url: true } },
            },
          },
        },
        orderBy: [{ dateCreated: 'desc' }],
        take: 300,
      }),
      this.prisma.mlQuestion.count({ where: { ...this.companyFilter(user, companyId), status: MlQuestionStatus.UNANSWERED } }),
    ]);
    return { questions: rows, unanswered };
  }

  private async upsertQuestion(q: any, connectionId: string, companyId: string) {
    const listing = q.item_id
      ? await this.prisma.listing.findFirst({
          where: { connectionId, externalId: q.item_id },
          select: { productId: true, product: { select: { name: true } } },
        })
      : null;
    await this.prisma.mlQuestion.upsert({
      where: { externalId: String(q.id) },
      update: {
        text: q.text,
        status: (q.status || 'UNANSWERED') as MlQuestionStatus,
        answerText: q.answer?.text ?? null,
        answeredAt: q.answer?.date_created ? new Date(q.answer.date_created) : null,
        productId: listing?.productId ?? undefined,
        itemTitle: listing?.product?.name ?? undefined,
      },
      create: {
        externalId: String(q.id),
        itemId: q.item_id,
        itemTitle: listing?.product?.name ?? null,
        text: q.text,
        status: (q.status || 'UNANSWERED') as MlQuestionStatus,
        answerText: q.answer?.text ?? null,
        answeredAt: q.answer?.date_created ? new Date(q.answer.date_created) : null,
        fromNickname: q.from?.id ? String(q.from.id) : null,
        dateCreated: new Date(q.date_created),
        companyId,
        connectionId,
        productId: listing?.productId ?? null,
      },
    });
  }

  // Trae TODO el historial de preguntas de la cuenta, de más reciente a más antigua
  // (para poblar el histórico la primera vez o si se perdió alguna notificación); de ahí
  // en más el webhook las mantiene al día en tiempo real. Como es un upsert por
  // externalId, correrlo de nuevo nunca borra ni duplica lo que ya se había guardado.
  async syncQuestions(connectionId: string, user: any) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);
    const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) throw new BadRequestException('No se pudo obtener el usuario de Mercado Libre');
    const me = await meRes.json() as any;

    let synced = 0;

    const fetchAndUpsertPages = async (extraParams: Record<string, string>) => {
      let offset = 0;
      let pageTotal = 0;
      do {
        // Sin ordenar, ML devuelve las preguntas en un orden que no prioriza las recientes —
        // con una cuenta que tiene mucho historial, el tope de 200 se llenaba con preguntas
        // viejas y las de ahora (las que realmente importan) nunca se alcanzaban a traer.
        const params = new URLSearchParams({
          seller_id: String(me.id), api_version: '4', limit: '50', offset: String(offset),
          sort_fields: 'date_created', sort_types: 'DESC', ...extraParams,
        });
        const res = await fetch(`${ML_API}/questions/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const errBody = await res.text();
          this.logger.error(`ML questions/search falló [${res.status}] conexión ${connectionId}: ${errBody}`);
          throw new BadRequestException(
            `Mercado Libre rechazó la búsqueda de preguntas (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
          );
        }
        const data = await res.json() as any;
        pageTotal = data.total || 0;
        for (const q of data.questions || []) {
          try {
            await this.upsertQuestion(q, connectionId, conn.companyId);
            synced++;
          } catch (err: any) {
            // Una pregunta con un dato inesperado (p.ej. un status nuevo que ML agregó) no
            // debe tirar abajo la sincronización completa de la cuenta.
            this.logger.error(`upsertQuestion falló para pregunta ${q?.id}: ${err?.message || err}`);
          }
        }
        offset += 50;
        // Tope de seguridad para no quedar en un loop infinito si "total" viniera mal —
        // muy por encima de lo que tiene cualquier cuenta real.
      } while (offset < pageTotal && offset < 20000);
      return pageTotal;
    };

    // La búsqueda general (sin filtro de status) puede no devolver las preguntas
    // todavía sin responder de algunas cuentas — se piden aparte primero para no
    // perderlas nunca; el upsert es idempotente así que no duplica nada.
    await fetchAndUpsertPages({ status: 'UNANSWERED' });
    const total = await fetchAndUpsertPages({});

    return { synced, total };
  }

  private async handleQuestionWebhook(body: any) {
    const questionId = String(body.resource || '').split('/').pop();
    if (!questionId) return { received: true };
    const found = await this.fetchWithAnyMlConnection(`/questions/${questionId}`);
    if (!found) {
      this.logger.warn(`ML Webhook questions: ninguna conexión pudo leer la pregunta ${questionId}`);
      return { received: true };
    }
    await this.upsertQuestion(found.data, found.connection.id, found.connection.companyId);
    return { received: true };
  }

  async answerQuestion(externalId: string, text: string, user: any) {
    const question = await this.prisma.mlQuestion.findUnique({ where: { externalId } });
    if (!question) throw new NotFoundException('Pregunta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && question.companyId !== user.companyId) throw new ForbiddenException();

    const token = await this.getValidToken(question.connectionId);
    const res = await fetch(`${ML_API}/answers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: Number(externalId), text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new BadRequestException(err.message || 'Mercado Libre rechazó la respuesta');
    }
    return this.prisma.mlQuestion.update({
      where: { externalId },
      data: { status: MlQuestionStatus.ANSWERED, answerText: text, answeredAt: new Date() },
    });
  }

  // ─── Reclamos y devoluciones ──────────────────────────────────────────────────

  // Tipos de reclamo que ML resuelve devolviendo el producto al vendedor. El resto
  // (fraude, mediación por otros motivos, etc.) no genera devolución de stock.
  private static readonly RETURN_CLAIM_TYPES = new Set(['return', 'dispute']);

  async listClaims(user: any, status?: string, companyId?: string) {
    const where: any = this.companyFilter(user, companyId);
    if (status && status !== 'ALL') where.status = status;
    const [rows, opened] = await Promise.all([
      this.prisma.mlClaim.findMany({
        where,
        include: {
          sale: {
            select: {
              id: true, externalId: true, total: true, createdAt: true, customerName: true,
              items: {
                take: 1,
                select: {
                  product: {
                    select: {
                      id: true, name: true,
                      images: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }], take: 1, select: { url: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ lastSyncedAt: 'desc' }],
        take: 300,
      }),
      this.prisma.mlClaim.count({ where: { ...this.companyFilter(user, companyId), status: MlClaimStatus.OPENED } }),
    ]);
    return { claims: rows, opened };
  }

  private async upsertClaim(c: any, connectionId: string, companyId: string) {
    const orderExternalId = c.resource_id ? String(c.resource_id) : null;
    const sale = orderExternalId
      ? await this.prisma.sale.findFirst({
          where: { channel: SaleChannel.MERCADO_LIBRE, ...this.mlOrderMatch(orderExternalId) },
          include: { items: { include: { product: true } } },
        })
      : null;

    const claim = await this.prisma.mlClaim.upsert({
      where: { externalId: String(c.id) },
      update: {
        type: c.type,
        status: String(c.status || 'opened').toUpperCase() as MlClaimStatus,
        stage: c.stage ?? null,
        reason: c.reason?.id ?? c.reason ?? null,
        orderExternalId,
        saleId: sale?.id ?? undefined,
        lastSyncedAt: new Date(),
      },
      create: {
        externalId: String(c.id),
        type: c.type,
        status: String(c.status || 'opened').toUpperCase() as MlClaimStatus,
        stage: c.stage ?? null,
        reason: c.reason?.id ?? c.reason ?? null,
        orderExternalId,
        companyId,
        connectionId,
        saleId: sale?.id ?? null,
      },
    });

    if (sale && MercadolibreService.RETURN_CLAIM_TYPES.has(c.type)) {
      await this.syncReturnFromClaim(claim, sale);
    }
    return claim;
  }

  // Crea/actualiza la fila compartida de Return (la misma que usa el módulo de
  // Devoluciones) a partir de un reclamo de ML tipo devolución/disputa. Los ítems se
  // toman de la venta original (ya vinculada a productos reales) en vez de tratar de
  // interpretar el payload de retorno de ML, que no siempre trae el detalle por SKU.
  private async syncReturnFromClaim(claim: { externalId: string; companyId: string; reason: string | null }, sale: any) {
    const existing = await this.prisma.return.findFirst({ where: { externalId: claim.externalId } });
    if (existing) return existing;
    return this.prisma.return.create({
      data: {
        companyId: claim.companyId,
        channel: SaleChannel.MERCADO_LIBRE,
        externalId: claim.externalId,
        reason: claim.reason || 'Reclamo de Mercado Libre',
        saleId: sale.id,
        status: ReturnStatus.PENDING,
        items: {
          create: sale.items.map((it: any) => ({
            productId: it.product?.id ?? null,
            productName: it.product?.name ?? 'Producto',
            productSku: it.product?.sku ?? '',
            quantity: it.quantity,
          })),
        },
      },
    });
  }

  async syncClaims(connectionId: string, user: any) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);
    const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) throw new BadRequestException('No se pudo obtener el usuario de Mercado Libre');
    const me = await meRes.json() as any;

    let offset = 0;
    let total = 0;
    let synced = 0;
    do {
      // Mismo motivo que en preguntas: sin ordenar, el tope de 200 puede llenarse con
      // reclamos viejos y nunca llegar a los recientes. ML exige player_role junto con
      // player_user_id (no alcanza con player_role solo).
      const params = new URLSearchParams({
        player_role: 'respondent', player_user_id: String(me.id),
        limit: '50', offset: String(offset), sort: 'date_created:desc',
      });
      const res = await fetch(`${ML_API}/post-purchase/v1/claims/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`ML claims/search falló [${res.status}] conexión ${connectionId}: ${errBody}`);
        throw new BadRequestException(
          `Mercado Libre rechazó la búsqueda de reclamos (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
        );
      }
      const data = await res.json() as any;
      total = data.paging?.total || 0;
      for (const c of data.data || []) {
        try {
          await this.upsertClaim(c, connectionId, conn.companyId);
          synced++;
        } catch (err: any) {
          this.logger.error(`upsertClaim falló para reclamo ${c?.id}: ${err?.message || err}`);
        }
      }
      offset += 50;
    } while (offset < total && offset < 20000);

    return { synced };
  }

  private async handleClaimWebhook(body: any) {
    const claimId = String(body.resource || '').split('/').pop();
    if (!claimId) return { received: true };
    const found = await this.fetchWithAnyMlConnection(`/post-purchase/v1/claims/${claimId}`);
    if (!found) {
      this.logger.warn(`ML Webhook claims: ninguna conexión pudo leer el reclamo ${claimId}`);
      return { received: true };
    }
    await this.upsertClaim(found.data, found.connection.id, found.connection.companyId);
    return { received: true };
  }

  // Detalle en vivo (mensajes + acciones disponibles): a diferencia de preguntas, acá
  // no se guarda una copia local del hilo — Mercado Libre sigue siendo la fuente de
  // verdad y evita que el hilo se desincronice si alguien responde desde la app de ML.
  async getClaimDetail(externalId: string, user: any) {
    const claim = await this.prisma.mlClaim.findUnique({ where: { externalId } });
    if (!claim) throw new NotFoundException('Reclamo no encontrado');
    if (user.role !== Role.SUPER_ADMIN && claim.companyId !== user.companyId) throw new ForbiddenException();

    const token = await this.getValidToken(claim.connectionId);
    const [detailRes, messagesRes] = await Promise.all([
      fetch(`${ML_API}/post-purchase/v1/claims/${externalId}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${ML_API}/post-purchase/v1/claims/${externalId}/messages`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (!detailRes.ok) throw new BadRequestException('No se pudo obtener el detalle del reclamo en Mercado Libre');
    const detail = await detailRes.json() as any;
    const messages = messagesRes.ok ? await messagesRes.json() : [];
    return { claim, detail, messages, availableActions: detail.available_actions || [] };
  }

  async sendClaimMessage(externalId: string, text: string, user: any) {
    const claim = await this.prisma.mlClaim.findUnique({ where: { externalId } });
    if (!claim) throw new NotFoundException('Reclamo no encontrado');
    if (user.role !== Role.SUPER_ADMIN && claim.companyId !== user.companyId) throw new ForbiddenException();

    const token = await this.getValidToken(claim.connectionId);
    const res = await fetch(`${ML_API}/post-purchase/v1/claims/${externalId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, receiver_role: 'complainant' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new BadRequestException(err.message || 'Mercado Libre rechazó el mensaje');
    }
    return res.json();
  }

  async takeClaimAction(externalId: string, action: string, user: any, extra?: Record<string, any>) {
    const claim = await this.prisma.mlClaim.findUnique({ where: { externalId } });
    if (!claim) throw new NotFoundException('Reclamo no encontrado');
    if (user.role !== Role.SUPER_ADMIN && claim.companyId !== user.companyId) throw new ForbiddenException();

    const token = await this.getValidToken(claim.connectionId);
    const res = await fetch(`${ML_API}/post-purchase/v1/claims/${externalId}/actions/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(extra || {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new BadRequestException(err.message || 'Mercado Libre rechazó la acción');
    }
    await this.prisma.mlClaim.update({ where: { externalId }, data: { lastSyncedAt: new Date() } });
    return res.json().catch(() => ({ ok: true }));
  }

  // ─── Calificaciones ───────────────────────────────────────────────────────────

  async getSellerReputation(connectionId: string, user: any) {
    await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);
    const res = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new BadRequestException('No se pudo obtener la reputación en Mercado Libre');
    const me = await res.json() as any;
    return me.seller_reputation || null;
  }

  async listFeedback(user: any, companyId?: string) {
    const where: any = { ...this.companyFilter(user, companyId), channel: SaleChannel.MERCADO_LIBRE, mlFeedbackRating: { not: null } };
    return this.prisma.sale.findMany({
      where,
      select: {
        id: true, externalId: true, total: true, createdAt: true,
        mlFeedbackRating: true, mlFeedbackComment: true, mlFeedbackAt: true,
        items: {
          take: 1,
          select: {
            product: {
              select: {
                id: true, name: true,
                images: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }], take: 1, select: { url: true } },
              },
            },
          },
        },
      },
      orderBy: { mlFeedbackAt: 'desc' },
      take: 200,
    });
  }

  private async handleFeedbackWebhook(body: any) {
    // El resource llega como /orders/{id}/feedback.
    const match = String(body.resource || '').match(/orders\/(\d+)/);
    const orderId = match?.[1];
    if (!orderId) return { received: true };
    const found = await this.fetchWithAnyMlConnection(`/orders/${orderId}/feedback`);
    if (!found) return { received: true };
    const buyerFeedback = found.data?.buyer;
    if (!buyerFeedback?.rating) return { received: true };
    const ratingMap: Record<string, SaleFeedbackRating> = {
      positive: SaleFeedbackRating.POSITIVE,
      neutral: SaleFeedbackRating.NEUTRAL,
      negative: SaleFeedbackRating.NEGATIVE,
    };
    const rating = ratingMap[String(buyerFeedback.rating).toLowerCase()];
    if (!rating) return { received: true };
    await this.prisma.sale.updateMany({
      where: { channel: SaleChannel.MERCADO_LIBRE, externalId: orderId },
      data: { mlFeedbackRating: rating, mlFeedbackComment: buyerFeedback.message || null, mlFeedbackAt: new Date() },
    });
    return { received: true };
  }

  // ─── Notificaciones (para el aviso emergente del panel) ──────────────────────

  // Devuelve ventas/preguntas/reclamos de ML creados después de "since" (según cuándo
  // esta app se enteró, no la fecha del evento en ML — así una sincronización de
  // historial no dispara un aluvión de avisos de cosas viejas).
  async getRecentActivity(user: any, sinceIso: string, companyId?: string) {
    const since = new Date(sinceIso);
    const where = this.companyFilter(user, companyId);
    if (isNaN(since.getTime())) throw new BadRequestException('Parámetro "since" inválido');

    const [sales, questions, claims] = await Promise.all([
      this.prisma.sale.findMany({
        // Cualquier canal (POS, Mercado Libre, Shopify, etc.) — no solo Mercado Libre.
        where: { ...where, createdAt: { gt: since } },
        select: {
          id: true, externalId: true, total: true, channel: true, createdAt: true,
          connection: { select: { name: true } },
          items: { take: 1, select: { product: { select: { name: true } } }, orderBy: { id: 'asc' } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.mlQuestion.findMany({
        // Solo preguntas que de verdad necesitan respuesta: un sync de historial puede
        // insertar por primera vez preguntas que ya venían respondidas desde Mercado
        // Libre (o desde otra sesión), y esas no deben avisar "nueva pregunta".
        where: { ...where, createdAt: { gt: since }, status: MlQuestionStatus.UNANSWERED },
        select: {
          id: true, externalId: true, text: true, createdAt: true,
          product: { select: { name: true } },
          connection: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.mlClaim.findMany({
        // Mismo criterio que las preguntas: un reclamo que ya llegó CERRADO en el
        // primer sync (backlog) no necesita aviso — solo los que siguen abiertos.
        where: { ...where, createdAt: { gt: since }, status: MlClaimStatus.OPENED },
        select: {
          id: true, externalId: true, type: true, createdAt: true,
          connection: { select: { name: true } },
          sale: {
            select: {
              externalId: true,
              items: { take: 1, select: { product: { select: { name: true } } }, orderBy: { id: 'asc' } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const channelLabel: Record<string, string> = {
      POS: 'Punto de venta', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
      WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
      PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Solicitud de pedido',
    };
    const events = [
      ...sales.map((s) => {
        const extra = s._count.items - 1;
        const productName = s.items[0]?.product?.name
          ? `${s.items[0].product.name}${extra > 0 ? ` +${extra} más` : ''}`
          : null;
        return {
          type: 'sale' as const,
          id: s.id,
          title: 'Nueva venta',
          channel: channelLabel[s.channel] || s.channel,
          connectionName: s.connection?.name || null,
          productName,
          orderRef: s.externalId || s.id.slice(-6).toUpperCase(),
          createdAt: s.createdAt,
          href: '/dashboard/sales',
        };
      }),
      ...questions.map((q) => ({
        type: 'question' as const,
        id: q.id,
        title: 'Nueva pregunta',
        channel: 'Mercado Libre',
        connectionName: q.connection?.name || null,
        productName: q.product?.name || q.text?.slice(0, 60) || null,
        orderRef: null as string | null,
        createdAt: q.createdAt,
        href: '/dashboard/mercadolibre/preguntas',
      })),
      ...claims.map((c) => ({
        type: 'claim' as const,
        id: c.id,
        title: 'Nuevo reclamo',
        channel: 'Mercado Libre',
        connectionName: c.connection?.name || null,
        productName: c.sale?.items[0]?.product?.name || null,
        orderRef: c.sale?.externalId || null,
        createdAt: c.createdAt,
        href: '/dashboard/mercadolibre/reclamos',
      })),
      // Alertas del historial de actividad (muchas eliminaciones, intentos fallidos de sesión):
      // solo para administradores.
      ...(user.role === Role.SUPER_ADMIN || user.role === Role.COMPANY_ADMIN
        ? (await this.activity.recentAlerts((where as any).companyId ?? null, since)).map((a) => ({
            type: 'alert' as const,
            id: a.id,
            title: 'Alerta de seguridad',
            channel: 'Historial de actividad',
            connectionName: null as string | null,
            productName: a.summary,
            orderRef: null as string | null,
            createdAt: a.createdAt,
            href: '/dashboard/actividad',
          }))
        : []),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return { events, serverTime: new Date().toISOString() };
  }
}
