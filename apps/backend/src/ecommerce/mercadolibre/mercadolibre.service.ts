import {
  Injectable, Logger, BadRequestException, NotFoundException,
  InternalServerErrorException, ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  Role, SaleChannel, MovementType, MarketplaceType,
  MlQuestionStatus, MlClaimStatus, SaleFeedbackRating, ReturnStatus, FulfillmentType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { SettingsService } from '../../settings/settings.service';
import { ListingStatus } from '@prisma/client';
import { SyncService } from '../sync/sync.service';
import { InventoryCostingService } from '../../purchases/inventory-costing.service';

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

  async handleCallback(code: string, state: string, fallbackName: string) {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    const connectionId: string = decoded.connectionId;
    const codeVerifier: string = decoded.codeVerifier;

    const draft = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!draft) throw new BadRequestException('Conexión no encontrada');

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
      const err = await res.text();
      this.logger.error(`ML token exchange failed [${res.status}]: ${err}`);
      throw new BadRequestException('Error al conectar con Mercado Libre');
    }

    const tokens = await res.json() as any;
    return this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        active: true,
      },
    });
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
        expiresAt: true, createdAt: true,
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ accessToken, ...rest }) => ({ ...rest, authorized: !!accessToken }));
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

      return { attributes, supportsHtml };
    } catch (err) {
      this.logger.error('ML category attributes error', err);
      return { attributes: [], supportsHtml: false };
    }
  }

  private async upsertMlDescription(itemId: string, token: string, plainText: string): Promise<string | null> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const payload = JSON.stringify({ plain_text: plainText });
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
          // ML puede responder 200 pero no guardar nada; verificar que plain_text no sea vacío
          if (data.plain_text && data.plain_text.trim()) return null;
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
  ) {
    const product = await this.catalog.findOne(productId, user);
    await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const primaryImage = product.images.find((i: any) => i.isPrimary) || product.images[0];

    const categoryId = (product as any).mlCategoryId || await this.settings.get('ML_DEFAULT_CATEGORY');
    if (!categoryId) {
      throw new BadRequestException(
        'Debes asignar una categoría de Mercado Libre al producto antes de publicar.',
      );
    }
    await this.assertPublishableCategory(categoryId);

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

    const effectivePrice = await this.getEffectivePrice(productId, connectionId, Number(product.mlPrice ?? product.price));

    const mlItem = {
      title: product.name,
      category_id: categoryId,
      price: Math.round(effectivePrice),
      currency_id: 'CLP',
      available_quantity: product.stock,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      description: { plain_text: product.description || product.name },
      pictures: primaryImage ? [{ source: toAbsolute(primaryImage.url) }] : [],
      attributes: [
        { id: 'SELLER_SKU', value_name: product.sku },
        ...packageAttributes,
        ...((product as any).mlAttributes || []),
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

    let attempt = await attemptPublish(mlItem);
    // Cuentas migradas al modelo "Precio por Variación" (User Products) de ML exigen
    // "family_name" (el título de la "familia" del producto en ese modelo, no un nombre de
    // persona) en vez de "title" — mandar ambos juntos lo rechaza ML como campo inválido
    // ("title"), y mandar family_name siempre lo rechazan las cuentas que NO tienen ese
    // modelo activo. Por eso se reintenta reemplazando title por family_name solo si ML pide
    // específicamente family_name en el primer intento.
    if (!attempt.ok && attempt.mlErrors.some((m) => /family_name/i.test(m))) {
      const { title, ...itemWithoutTitle } = mlItem;
      attempt = await attemptPublish({ ...itemWithoutTitle, family_name: (product as any).mlFamilyName || product.name });
    }

    if (!attempt.ok) {
      const summary = attempt.mlErrors[0];
      await this.prisma.listing.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { status: ListingStatus.ERROR, errorMsg: attempt.mlErrors.join(' | ') },
        create: { productId, connectionId, status: ListingStatus.ERROR, errorMsg: attempt.mlErrors.join(' | ') },
      });
      throw new BadRequestException({ message: summary, mlErrors: attempt.mlErrors });
    }

    const mlData = attempt.data;

    // Enviar descripción siempre vía endpoint dedicado
    let descriptionWarning: string | null = null;
    const rawPlainPublish = (product.description || product.name || '').trim();
    const safePlainPublish = rawPlainPublish.length >= 10
      ? rawPlainPublish
      : `${product.name}. ${product.name}. ${product.name}`;

    if (mlData.id) {
      const reason = await this.upsertMlDescription(mlData.id, token, safePlainPublish);
      if (reason) {
        descriptionWarning = `Publicación creada, pero la descripción fue rechazada por ML (${reason}).`;
      }
    }

    const listing = await this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        externalId: mlData.id,
        externalUrl: mlData.permalink,
        status: ListingStatus.ACTIVE,
        syncedAt: new Date(),
        errorMsg: null,
      },
      create: {
        productId, connectionId,
        externalId: mlData.id,
        externalUrl: mlData.permalink,
        status: ListingStatus.ACTIVE,
        syncedAt: new Date(),
      },
    });

    return { ...listing, descriptionWarning };
  }

  // Fase 7 (motor de precios): si esta variante tiene un precio propio para esta cuenta
  // puntual (ChannelPrice), se usa ese en vez de mlPrice/price — así "Altiro Nuevo" y
  // "Merca todo" pueden vender el mismo producto a precios distintos. Sin override,
  // el comportamiento es exactamente el de siempre.
  private async getEffectivePrice(productId: string, connectionId: string, fallback: number): Promise<number> {
    const override = await this.prisma.channelPrice.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
    return override ? Number(override.price) : fallback;
  }

  private async syncListingCore(product: any, listing: any, token: string): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];

    const price = await this.getEffectivePrice(product.id, listing.connectionId, Number(product.mlPrice ?? product.price));

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

    // Sincronizar descripción siempre con plain_text
    const rawPlain = (product.description || product.name || '').trim();
    const safePlain = rawPlain.length >= 10
      ? rawPlain
      : `${product.name}. ${product.name}. ${product.name}`;

    this.logger.log(`ML sync description [${listing.externalId}]: "${safePlain.substring(0, 80)}"`);
    const descErr = await this.upsertMlDescription(listing.externalId, token, safePlain);
    if (descErr) warnings.push(`Descripción no sincronizada: ${descErr}`);

    return { warnings };
  }

  async syncStock(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    await this.getConnectionForUser(connectionId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
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

  async toggleListingStatus(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    await this.getConnectionForUser(connectionId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
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
  private extractAdditionalAttributes(attributes: any[]): Array<{ id: string; value_name?: string; value_id?: string }> {
    if (!Array.isArray(attributes)) return [];
    const excluded = new Set([
      'SELLER_SKU', 'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT',
    ]);
    return attributes
      .filter((a) => a?.id && !excluded.has(a.id) && (a.value_name || a.value_id))
      .map((a) => ({ id: a.id, value_name: a.value_name, ...(a.value_id ? { value_id: a.value_id } : {}) }));
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
    const attrs = 'id,title,price,available_quantity,thumbnail,secure_thumbnail,permalink,status,category_id,attributes,pictures,family_name';
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
        this.prisma.listing.findMany({
          where: { connectionId, externalId: { in: mlItems.map((i) => i.id) } },
          select: { externalId: true, productId: true, product: { select: { name: true } } },
        }),
      ]);
      const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
      const listingByExternalId = new Map(existingListings.map((l) => [l.externalId, l]));

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

      return { connectionName: conn.name, total, hasMore, nextScrollId, alreadyImportedCount, items };
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

    // Un producto solo puede tener una publicación por conexión (Listing es único por
    // productId+connectionId). Si dos ítems de ML del mismo lote resuelven al mismo SKU
    // (p.ej. variaciones o publicaciones duplicadas), sin este control el segundo intento
    // de crear el Listing rompe esa restricción única. Se arma el set con lo que ya existe
    // en la conexión y se va actualizando a medida que se vinculan/crean productos en el lote.
    const preexistingListings = await this.prisma.listing.findMany({
      where: { connectionId },
      select: { productId: true },
    });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));

    for (const item of mlItems) {
      try {
        const alreadyLinked = await this.prisma.listing.findFirst({
          where: { connectionId, externalId: item.id },
        });
        if (alreadyLinked) { skipped++; continue; }

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

        if (product && linkedProductIds.has(product.id)) {
          skipped++;
          errors.push(`${item.id}: el SKU ${sku} ya está vinculado a otra publicación en esta conexión (usa "Importar como nuevo" para crear un producto aparte).`);
          continue;
        }

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
          if (Object.keys(fillData).length) {
            await this.prisma.product.update({ where: { id: product.id }, data: fillData });
          }

          await this.prisma.listing.create({
            data: {
              productId: product.id,
              connectionId,
              externalId: item.id,
              externalUrl: item.permalink,
              status,
              syncedAt: new Date(),
            },
          });
          linkedProductIds.add(product.id);
          linked++;
        } else {
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
    const itemFees = (order.order_items || []).reduce((sum: number, oi: any) => sum + Number(oi.sale_fee || 0), 0);
    return {
      shippingCost: Math.round(Number(payment.shipping_cost || order.shipping?.cost || 0)),
      marketplaceFee: Math.round(Number(payment.marketplace_fee || itemFees || 0)),
      taxes: Math.round(Number(payment.taxes_amount || 0)),
      coupon: Math.round(Number(payment.coupon_amount || 0)),
      totalPaid: Math.round(Number(payment.total_paid_amount ?? order.total_amount ?? 0)),
    };
  }

  // Neto real que recibe el vendedor: precio del producto - comisión - envío a su cargo - impuestos - cupón.
  // Verificado contra el panel de ML: $8.499 - $1.530 - $799 = $6.170.
  private computeSellerNetAmount(order: any, charges: { marketplaceFee: number; shippingCost: number; taxes: number; coupon: number }): number {
    const productTotal = Math.round(Number(order.total_amount || 0));
    return productTotal - charges.marketplaceFee - charges.shippingCost - charges.taxes - charges.coupon;
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

    return {
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
      const method = logisticType ? (MercadolibreService.ML_LOGISTIC_LABELS[logisticType] || logisticType) : null;

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

      // 1) Si /costs trae el cargo real al vendedor, se usa directo (menos la bonificación, si existe).
      const sendersCost = sender?.cost != null ? Number(sender.cost) - bonus : undefined;

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
        where: { channel: SaleChannel.MERCADO_LIBRE, externalId: { in: orderIds } },
        select: { externalId: true },
      }),
      this.prisma.listing.findMany({
        where: { connectionId, externalId: { in: itemIds } },
        select: { externalId: true, productId: true, product: { select: { name: true } } },
      }),
    ]);
    const existingIds = new Set(existingSales.map((s) => s.externalId));
    const listingByItemId = new Map(listings.map((l) => [l.externalId, l]));

    const unfiltered = orders.map((o) => {
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
      const importable = orderItems.length > 0 && orderItems.every((i: any) => i.resolved);
      const charges = this.computeOrderCharges(o);
      return {
        externalId: String(o.id),
        date: o.date_created,
        total: Number(o.total_amount || 0),
        buyerNickname: o.buyer?.nickname || null,
        items: orderItems,
        charges,
        importable,
      };
    });

    const orderResults = unfiltered.filter((o) => !existingIds.has(o.externalId));
    const alreadyImportedCount = unfiltered.length - orderResults.length;

    return { connectionName: conn.name, total, truncated, alreadyImportedCount, orders: orderResults };
  }

  async confirmSalesImport(connectionId: string, externalOrderIds: string[], user: any) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const orderId of externalOrderIds) {
      const existing = await this.prisma.sale.findFirst({
        where: { channel: SaleChannel.MERCADO_LIBRE, externalId: orderId },
      });
      if (existing) { skipped++; continue; }

      const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!orderRes.ok) { errors.push(`Orden ${orderId}: no se pudo obtener de Mercado Libre`); continue; }
      const order = await orderRes.json() as any;

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
      await this.prisma.sale.create({
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
          companyId: conn.companyId,
          connectionId: conn.id,
          customerName: order.buyer?.nickname || null,
          createdAt: new Date(order.date_created),
          items: { create: resolvedItems },
        },
      });
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
  private async processOrder(
    orderId: string,
    order: any,
    token: string,
    companyIdHint?: string,
    connectionId?: string,
  ): Promise<'imported' | 'skipped'> {
    const orderTotal = Number(order.total_amount || 0);

    let companyId: string | null = companyIdHint || null;
    const resolvedItems: Array<{ listing: any; quantity: number; unitPrice: number }> = [];

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
      resolvedItems.push({ listing, quantity, unitPrice });
    }

    if (!resolvedItems.length || !companyId) return 'skipped';

    const charges = this.computeOrderCharges(order);
    const shippingInfo = await this.getMlShippingInfo(order, token);
    if (shippingInfo.sellerCost != null) charges.shippingCost = shippingInfo.sellerCost;
    charges.totalPaid = this.computeSellerNetAmount(order, charges);

    try {
      await this.prisma.$transaction(async (tx) => {
        const sale = await tx.sale.create({
          data: {
            channel: SaleChannel.MERCADO_LIBRE,
            externalId: orderId,
            total: orderTotal,
            shippingCost: charges.shippingCost,
            marketplaceFee: charges.marketplaceFee,
            taxes: charges.taxes,
            discount: charges.coupon,
            netAmount: charges.totalPaid,
            shippingMethod: shippingInfo.method,
            companyId: companyId as string,
            connectionId: resolvedItems[0].listing.connectionId,
            customerName: order.buyer?.nickname || null,
            items: {
              create: resolvedItems.map(({ listing, quantity, unitPrice }) => ({
                productId: listing.productId,
                quantity,
                unitPrice,
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
            fulfillmentType: FulfillmentType.DELIVERY,
            customerName: shippingInfo.address?.receiverName || order.buyer?.nickname || null,
            customerPhone: shippingInfo.address?.receiverPhone || null,
            address: shippingInfo.address?.addressLine || null,
            commune: shippingInfo.address?.commune || null,
            region: shippingInfo.address?.region || null,
            courier: shippingInfo.method,
            trackingCode: shippingInfo.trackingCode,
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

        for (let i = 0; i < resolvedItems.length; i++) {
          const { listing, quantity } = resolvedItems[i];
          const saleItem = sale.items[i];

          const product = listing.product;

          // Productos dropship: no descuentan stock propio ni pausan la publicación.
          // El módulo de dropshipping genera el pedido al proveedor y costea la línea.
          if (product.dropship) {
            await tx.listing.update({
              where: { id: listing.id },
              data: { status: ListingStatus.ACTIVE, syncedAt: new Date() },
            });
            continue;
          }

          const newStock = Math.max(0, product.stock - quantity);

          const totalCost = await this.costing.consumeForSale(tx, {
            companyId,
            productId: listing.productId,
            warehouseId: product.warehouseId,
            quantity,
            saleItemId: saleItem.id,
            reason: `Venta Mercado Libre orden #${orderId}`,
          });
          if (totalCost != null) {
            await tx.saleItem.update({ where: { id: saleItem.id }, data: { totalCost } });
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
      });
    } catch (err: any) {
      // Otra corrida (webhook vs cron, o dos ticks del cron solapados) ya insertó esta orden
      // entre nuestro chequeo previo y este create: el constraint único la frena acá.
      if (err?.code === 'P2002') {
        this.logger.log(`ML orden ${orderId} ya fue importada por otro proceso`);
        return 'skipped';
      }
      throw err;
    }

    // Sincronizar otras plataformas tras la venta de ML
    for (const { listing, quantity } of resolvedItems) {
      const newStock = Math.max(0, listing.product.stock - quantity);
      this.sync.syncProduct(listing.productId, newStock).catch((e) =>
        this.logger.error(`Sync otras plataformas tras venta ML: ${e.message}`),
      );
    }

    return 'imported';
  }

  // ─── Webhook ─────────────────────────────────────────────────────────────────

  async handleWebhook(body: any) {
    this.logger.log(`ML Webhook: topic=${body.topic} resource=${body.resource}`);
    if (body.topic === 'questions') return this.handleQuestionWebhook(body);
    if (body.topic === 'claims') return this.handleClaimWebhook(body);
    if (body.topic === 'orders_feedback') return this.handleFeedbackWebhook(body);
    if (body.topic !== 'orders_v2') return { received: true };

    try {
      const orderId = body.resource?.split('/').pop();
      if (!orderId) return { received: true };

      // Evitar procesar la misma orden dos veces
      const existing = await this.prisma.sale.findFirst({
        where: { channel: SaleChannel.MERCADO_LIBRE, externalId: orderId },
      });
      if (existing) {
        this.logger.log(`ML Webhook: orden ${orderId} ya procesada`);
        return { received: true };
      }

      // La orden pertenece a una cuenta de ML concreta: probamos cada conexión de ML
      // activa y nos quedamos con la que puede leer la orden (las demás dan 401/403/404).
      // Así el webhook nunca resuelve la venta contra la cuenta/empresa equivocada.
      const mlConnections = await this.prisma.marketplaceConnection.findMany({
        where: { marketplace: MarketplaceType.MERCADO_LIBRE, active: true, accessToken: { not: '' } },
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

      await this.processOrder(orderId, order, token, companyId, connectionId);
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
    const from = connection.lastSalesImportAt
      ? new Date(connection.lastSalesImportAt.getTime() - 2 * 60 * 1000)
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
          where: { channel: SaleChannel.MERCADO_LIBRE, externalId: orderId },
        });
        if (existing) { skipped++; continue; }

        const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!orderRes.ok) { errors++; continue; }
        const order = await orderRes.json() as any;

        const result = await this.processOrder(orderId, order, token, connection.companyId, connection.id);
        if (result === 'imported') imported++; else skipped++;
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
          where: { channel: SaleChannel.MERCADO_LIBRE, externalId: orderExternalId },
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
      PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual',
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
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return { events, serverTime: new Date().toISOString() };
  }
}
