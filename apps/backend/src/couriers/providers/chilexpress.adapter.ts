import {
  CourierAdapter, CourierCredentials, CourierSettings, Destination, PackageInfo, QuoteOption, CreatedShipment,
  TrackingResult, classifyStatus, httpJson, normalize, findField, pdfFromBase64, safeIso,
} from '../courier.types';

/**
 * Chilexpress (developers.wschilexpress.com). Cada producto del portal entrega su propia
 * clave (header Ocp-Apim-Subscription-Key): Coberturas, Cotizador y Envíos.
 *
 * POR VALIDAR con el primer cliente: rutas y campos tomados del portal de desarrolladores y de
 * integraciones públicas; se confirman con credenciales reales (ambiente de pruebas primero).
 *
 * Credenciales: customerCardNumber (TCC), coverageKey, ratingKey, ordersKey, environment (test|prod).
 */
const BASE = (c: CourierCredentials) =>
  c.environment === 'prod' ? 'https://services.wschilexpress.com' : 'https://testservices.wschilexpress.com';

const headers = (key?: string) => ({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  ...(key ? { 'Ocp-Apim-Subscription-Key': key } : {}),
});

// Códigos de cobertura por comuna, en memoria (cambian muy poco).
let coverageCache: { at: number; base: string; map: Map<string, string> } | null = null;

async function coverageMap(c: CourierCredentials): Promise<Map<string, string>> {
  const base = BASE(c);
  if (coverageCache && coverageCache.base === base && Date.now() - coverageCache.at < 24 * 3600_000) return coverageCache.map;
  const regions = await httpJson(`${base}/georeference/api/v1.0/regions`, { headers: headers(c.coverageKey) });
  const list: any[] = regions?.regions || regions?.data?.regions || [];
  const map = new Map<string, string>();
  for (const r of list) {
    const code = r.regionId || r.idRegion || r.regionCode;
    if (!code) continue;
    const areas = await httpJson(`${base}/georeference/api/v1.0/coverage-areas?RegionCode=${encodeURIComponent(code)}&type=0`, { headers: headers(c.coverageKey) });
    for (const a of areas?.coverageAreas || areas?.data?.coverageAreas || []) {
      const name = a.countyName || a.coverageName;
      const cov = a.countyCode || a.coverageAreaCode;
      if (name && cov) map.set(normalize(name), String(cov));
    }
  }
  if (!map.size) throw new Error('Chilexpress no devolvió comunas de cobertura. Revisa la clave de Coberturas.');
  coverageCache = { at: Date.now(), base, map };
  return map;
}

async function countyCode(c: CourierCredentials, commune?: string): Promise<string> {
  if (!commune) throw new Error('Falta la comuna');
  const map = await coverageMap(c);
  const code = map.get(normalize(commune));
  if (!code) throw new Error(`Chilexpress no tiene cobertura registrada para la comuna "${commune}"`);
  return code;
}

export const chilexpressAdapter: CourierAdapter = {
  key: 'CHILEXPRESS',

  async test(c) {
    if (!c.coverageKey) throw new Error('Falta la clave de Coberturas');
    const map = await coverageMap(c);
    return `Conexión correcta: ${map.size} comunas con cobertura (${c.environment === 'prod' ? 'producción' : 'pruebas'}).`;
  },

  async quote(c, s: CourierSettings, dest: Destination, pkg: PackageInfo): Promise<QuoteOption[]> {
    if (!c.ratingKey) throw new Error('Falta la clave del Cotizador');
    const body = {
      originCountyCode: await countyCode(c, s.originCommune),
      destinationCountyCode: await countyCode(c, dest.commune),
      package: { weight: String(pkg.weight), height: String(pkg.height), width: String(pkg.width), length: String(pkg.length) },
      productType: 3, // 3 = encomienda
      contentType: 1,
      declaredWorth: String(Math.round(pkg.declaredValue)),
      deliveryTime: 0,
    };
    const res = await httpJson(`${BASE(c)}/rating/api/v1.0/rates/courier`, { method: 'POST', headers: headers(c.ratingKey), body: JSON.stringify(body) });
    const opts: any[] = res?.data?.courierServiceOptions || [];
    return opts.map((o) => ({
      serviceCode: String(o.serviceTypeCode),
      serviceName: o.serviceDescription || `Servicio ${o.serviceTypeCode}`,
      price: o.serviceValue != null ? Number(o.serviceValue) : null,
      days: o.deliveryType != null ? String(o.deliveryType) : null,
    }));
  },

  async create(c, s, { dest, pkg, serviceCode, reference }): Promise<CreatedShipment> {
    if (!c.ordersKey) throw new Error('Falta la clave de Envíos');
    if (!c.customerCardNumber) throw new Error('Falta el número de Tarjeta Cliente Chilexpress (TCC)');
    const origin = await countyCode(c, s.originCommune);
    const destination = await countyCode(c, dest.commune);
    const body = {
      header: {
        certificateNumber: 0,
        customerCardNumber: c.customerCardNumber,
        countyOfOriginCoverageCode: origin,
        labelType: 2, // 2 = PDF
        sourceChannel: 0,
      },
      details: [{
        addresses: [
          {
            addressId: 0, countyCoverageCode: destination, streetName: dest.address, streetNumber: dest.number || '0',
            supplement: dest.supplement || '', addressType: 'DEST', deliveryOnCommercialOffice: false, observation: 'DEFAULT',
          },
          {
            addressId: 0, countyCoverageCode: origin, streetName: s.originAddress || '', streetNumber: s.originNumber || '0',
            supplement: '', addressType: 'DEV', deliveryOnCommercialOffice: false, observation: 'DEFAULT',
          },
        ],
        contacts: [
          { name: s.senderName || '', phoneNumber: s.senderPhone || '', mail: s.senderEmail || '', contactType: 'R' },
          { name: dest.name, phoneNumber: dest.phone || '', mail: dest.email || '', contactType: 'D' },
        ],
        packages: [{
          weight: String(pkg.weight), height: String(pkg.height), width: String(pkg.width), length: String(pkg.length),
          serviceDeliveryCode: serviceCode || '3', productCode: '3', deliveryReference: reference.slice(0, 50),
          groupReference: reference.slice(0, 50), declaredValue: String(Math.round(pkg.declaredValue)),
          declaredContent: '5', extendedCoverageAreaIndicator: false, receivableAmountInDelivery: 0,
        }],
      }],
    };
    const res = await httpJson(`${BASE(c)}/transport-orders/api/v1.0/transport-orders`, { method: 'POST', headers: headers(c.ordersKey), body: JSON.stringify(body) });
    const det = res?.data?.detail?.[0] || {};
    const tracking = det.transportOrderNumber || findField(res, ['transportOrderNumber']);
    if (!tracking) throw new Error(`Chilexpress no devolvió número de OT: ${res?.statusDescription || JSON.stringify(res).slice(0, 200)}`);
    const labelB64 = det?.label?.labelData || findField(det, ['labelData', 'printableLabel']);
    return { trackingNumber: String(tracking), serviceName: det.serviceDescription, label: pdfFromBase64(labelB64), raw: res };
  },

  async track(c, _s, trackingNumber): Promise<TrackingResult> {
    if (!c.ordersKey) throw new Error('Falta la clave de Envíos');
    const res = await httpJson(`${BASE(c)}/transport-orders/api/v1.0/tracking`, {
      method: 'POST', headers: headers(c.ordersKey),
      body: JSON.stringify({ reference: '', transportOrderNumber: Number(trackingNumber), rut: 0, showTrackingEvents: 1 }),
    });
    const data = res?.data || {};
    const events = (data.trackingEvents || []).map((e: any) => ({
      date: safeIso(e.eventDate, e.eventHour),
      description: e.description || '',
      location: e.officeName || null,
    }));
    const statusText = data.transportOrderData?.status || events[events.length - 1]?.description || 'Sin información';
    return { state: classifyStatus(statusText), statusText, events };
  },
};
