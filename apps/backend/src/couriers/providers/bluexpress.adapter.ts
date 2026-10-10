import {
  CourierAdapter, CourierCredentials, CourierSettings, Destination, PackageInfo, QuoteOption, CreatedShipment,
  TrackingResult, classifyStatus, httpJson, normalize, findField, pdfFromBase64, safeIso,
} from '../courier.types';

/**
 * Blue Express (Bluex). Las credenciales las entrega su equipo de integraciones y van en tres
 * headers: BX-TOKEN, BX-USERCODE y BX-CLIENT_ACCOUNT. Su API cubre geolocalización (regiones y
 * comunas), cotización (BX-Pricing), emisión de orden de servicio con etiqueta y tracking.
 *
 * POR VALIDAR con el primer cliente: Blue no publica la documentación; las rutas por defecto son
 * configurables en la conexión (geoPath, pricingPath, emissionPath, labelPath, trackingPath).
 */
const DEFAULT_BASE = 'https://apigw.bluex.cl';
const base = (s: CourierSettings) => (typeof s.baseUrl === 'string' && s.baseUrl) || DEFAULT_BASE;
const path = (s: CourierSettings, key: string, def: string) => (typeof s[key] === 'string' && (s[key] as string)) || def;

const headers = (c: CourierCredentials) => ({
  'Content-Type': 'application/json',
  'BX-TOKEN': c.token || '',
  'BX-USERCODE': c.userCode || '',
  'BX-CLIENT_ACCOUNT': c.clientAccount || '',
});

// Comunas de Blue (código de comuna y región), en memoria.
let geoCache: { at: number; key: string; map: Map<string, { comuna: string; region: string }> } | null = null;
async function geo(c: CourierCredentials, s: CourierSettings, commune?: string) {
  if (!commune) throw new Error('Falta la comuna');
  const key = `${base(s)}|${c.clientAccount}`;
  if (!geoCache || geoCache.key !== key || Date.now() - geoCache.at > 24 * 3600_000) {
    const res = await httpJson(`${base(s)}${path(s, 'geoPath', '/api/legacy/geolocation/v1/regions')}`, { headers: headers(c) });
    const map = new Map<string, { comuna: string; region: string }>();
    const regions: any[] = res?.data || res?.regiones || res?.regions || [];
    for (const r of regions) {
      const region = String(r.regionCode ?? r.codigo ?? r.code ?? '');
      for (const co of r.comunas || r.communes || []) {
        const name = co.name || co.nombre;
        const code = co.code || co.codigo || co.communeCode;
        if (name && code) map.set(normalize(name), { comuna: String(code), region });
      }
    }
    if (!map.size) throw new Error('Blue Express no devolvió comunas. Revisa las credenciales o la ruta de geolocalización.');
    geoCache = { at: Date.now(), key, map };
  }
  const hit = geoCache.map.get(normalize(commune));
  if (!hit) throw new Error(`Blue Express no tiene registrada la comuna "${commune}"`);
  return hit;
}

export const bluexpressAdapter: CourierAdapter = {
  key: 'BLUEXPRESS',

  async test(c, s) {
    if (!c.token || !c.userCode || !c.clientAccount) throw new Error('Faltan BX-TOKEN, BX-USERCODE o BX-CLIENT_ACCOUNT');
    await geo(c, s, s.originCommune || 'Santiago');
    return 'Conexión correcta con Blue Express.';
  },

  async quote(c, s, dest: Destination, pkg: PackageInfo): Promise<QuoteOption[]> {
    const from = await geo(c, s, s.originCommune);
    const to = await geo(c, s, dest.commune);
    const body = {
      from: { country: 'CL', district: from.comuna, region: from.region },
      to: { country: 'CL', district: to.comuna, region: to.region },
      serviceType: 'EX',
      datosProducto: { producto: 'P', familiaProducto: 'PAQU', bultos: [{ largo: pkg.length, ancho: pkg.width, alto: pkg.height, pesoFisico: pkg.weight, cantidad: 1 }] },
    };
    const res = await httpJson(`${base(s)}${path(s, 'pricingPath', '/api/legacy/pricing/v1')}`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) });
    const price = Number(findField(res, ['total', 'precio', 'price', 'valor'])) || null;
    return [{ serviceCode: 'EX', serviceName: 'Blue Express', price, days: findField(res, ['promesaEntrega', 'deliveryDays']) ?? null }];
  },

  async create(c, s, { dest, pkg, serviceCode, reference }): Promise<CreatedShipment> {
    if (!c.token || !c.userCode || !c.clientAccount) throw new Error('Faltan BX-TOKEN, BX-USERCODE o BX-CLIENT_ACCOUNT');
    const from = await geo(c, s, s.originCommune);
    const to = await geo(c, s, dest.commune);
    const body = {
      printFormatCode: 2, // PDF
      orderNumber: reference,
      references: [reference],
      serviceCode: serviceCode || 'EX',
      productCategory: 'PAQU',
      currency: 'CLP',
      shipmentCost: 0,
      extendedClaim: false,
      companyId: c.clientAccount,
      userName: c.userCode,
      comments: pkg.content.slice(0, 60),
      pickup: {
        location: { stateId: from.region, districtId: from.comuna, address: `${s.originAddress || ''} ${s.originNumber || ''}`.trim(), name: s.senderName },
        contact: { fullname: s.senderName, phone: s.senderPhone, email: s.senderEmail },
      },
      dropoff: {
        contact: { fullname: dest.name, phone: dest.phone, email: dest.email },
        location: { stateId: to.region, districtId: to.comuna, address: [dest.address, dest.number, dest.supplement].filter(Boolean).join(' ') },
      },
      packages: [{
        weightUnit: 'KG', lengthUnit: 'CM', weight: pkg.weight, length: pkg.length, width: pkg.width, height: pkg.height,
        quantity: 1, extendedClaimValue: Math.round(pkg.declaredValue),
      }],
    };
    const res = await httpJson(`${base(s)}${path(s, 'emissionPath', '/api/integr/emissions/v1')}`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) });
    const tracking = findField(res, ['trackingNumber', 'numeroOS', 'os', 'nroOS', 'osNumber']);
    if (!tracking) throw new Error(`Blue Express no devolvió número de seguimiento: ${JSON.stringify(res).slice(0, 200)}`);
    let label = pdfFromBase64(findField(res, ['label', 'labelBase64', 'etiqueta']));
    if (!label) {
      // Etiqueta aparte por número de OS (si la emisión no la trae).
      try {
        const lab = await httpJson(`${base(s)}${path(s, 'labelPath', '/api/integr/labels/v1/{os}').replace('{os}', encodeURIComponent(String(tracking)))}`, { headers: headers(c) });
        label = pdfFromBase64(findField(lab, ['label', 'labelBase64', 'etiqueta', 'pdf']));
      } catch { /* la etiqueta se puede pedir después */ }
    }
    return { trackingNumber: String(tracking), serviceName: 'Blue Express', label, raw: res };
  },

  async track(c, s, trackingNumber): Promise<TrackingResult> {
    const url = `${base(s)}${path(s, 'trackingPath', '/api/legacy/tracking/v1/shipments/{os}').replace('{os}', encodeURIComponent(trackingNumber))}`;
    const res = await httpJson(url, { headers: headers(c) });
    const list: any[] = res?.data?.pinchazos || res?.pinchazos || res?.events || res?.data?.events || [];
    const events = list.map((e: any) => ({
      date: safeIso(e.fecha || e.date || e.eventDate, e.hora),
      description: e.tipoMovimiento || e.descripcion || e.description || e.status || '',
      location: e.nombreLugar || e.location || null,
    }));
    const statusText = res?.data?.estadoActual || res?.status || events[events.length - 1]?.description || 'Sin información';
    return { state: classifyStatus(String(statusText)), statusText: String(statusText), events };
  },
};
