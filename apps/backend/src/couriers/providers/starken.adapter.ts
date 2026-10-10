import {
  CourierAdapter, CourierCredentials, CourierSettings, Destination, PackageInfo, QuoteOption, CreatedShipment,
  TrackingResult, classifyStatus, httpJson, normalize, findField, pdfFromBase64, safeIso,
} from '../courier.types';

/**
 * Starken (gateway.starken.cl). Starken no publica documentación abierta: el cotizador y las
 * ciudades salen de su gateway público; la emisión de órdenes de flete y el seguimiento se
 * entregan con el contrato empresa (usuario, clave/token y cuenta corriente).
 *
 * POR VALIDAR con el primer cliente: las rutas de emisión y seguimiento son configurables en la
 * conexión (emissionPath / trackingPath) para ajustarlas a lo que entregue Starken sin tocar código.
 *
 * Credenciales: rut, password (o apiToken), accountCode (cuenta corriente), centerCode (centro de costo).
 */
const DEFAULT_BASE = 'https://gateway.starken.cl';
const base = (s: CourierSettings) => (typeof s.baseUrl === 'string' && s.baseUrl) || DEFAULT_BASE;

const authHeaders = (c: CourierCredentials) => ({
  'Content-Type': 'application/json;charset=UTF-8',
  ...(c.apiToken ? { Authorization: `Bearer ${c.apiToken}` } : {}),
  ...(c.rut ? { rut: c.rut } : {}),
  ...(c.password ? { clave: c.password } : {}),
});

// Ciudades de Starken (id interno por comuna/ciudad), en memoria.
let cityCache: { at: number; map: Map<string, number> } | null = null;
async function cityId(s: CourierSettings, commune?: string): Promise<number> {
  if (!commune) throw new Error('Falta la comuna');
  if (!cityCache || Date.now() - cityCache.at > 24 * 3600_000) {
    const rows = await httpJson(`${base(s)}/agency/city`);
    const map = new Map<string, number>();
    for (const r of Array.isArray(rows) ? rows : rows?.data || []) {
      const id = Number(r.code_dls ?? r.id);
      if (!id) continue;
      if (r.name) map.set(normalize(r.name), id);
      for (const co of r.comunas || r.communes || []) if (co?.name) map.set(normalize(co.name), id);
    }
    cityCache = { at: Date.now(), map };
  }
  const id = cityCache.map.get(normalize(commune));
  if (!id) throw new Error(`Starken no tiene registrada la comuna "${commune}"`);
  return id;
}

export const starkenAdapter: CourierAdapter = {
  key: 'STARKEN',

  async test(c, s) {
    await cityId(s, s.originCommune || 'Santiago');
    if (!c.rut || (!c.password && !c.apiToken)) return 'Se conectó al cotizador de Starken. Faltan usuario y clave para emitir órdenes de flete.';
    return 'Se conectó al cotizador de Starken. La emisión se valida al crear el primer envío.';
  },

  async quote(_c, s, dest: Destination, pkg: PackageInfo): Promise<QuoteOption[]> {
    const body = {
      origen: await cityId(s, s.originCommune),
      destino: await cityId(s, dest.commune),
      alto: pkg.height, ancho: pkg.width, largo: pkg.length, kilos: pkg.weight,
      bulto: 'PAQUETE', entrega: 'DOMICILIO', servicio: 'NORMAL',
    };
    const res = await httpJson(`${base(s)}/quote/cotizador`, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: JSON.stringify(body) });
    const list: any[] = Array.isArray(res) ? res : res?.alternativas || res?.data || [res];
    return list
      .filter(Boolean)
      .map((o: any, i: number) => ({
        serviceCode: String(o.servicio || o.tipoServicio || (i === 0 ? 'NORMAL' : `S${i}`)),
        serviceName: `Starken ${String(o.servicio || o.tipoEntrega || 'Normal').toLowerCase()}`,
        price: Number(o.precio ?? o.valor ?? o.tarifa ?? findField(o, ['precio', 'valor', 'total'])) || null,
        days: o.dias != null ? String(o.dias) : null,
      }));
  },

  async create(c, s, { dest, pkg, serviceCode, reference }): Promise<CreatedShipment> {
    if (!c.rut || (!c.password && !c.apiToken)) throw new Error('Faltan el RUT y la clave (o token) de Starken');
    const path = (s.emissionPath as string) || '/emision/api/v1/orden-flete';
    const body = {
      rutEmpresaEmisora: c.rut, cuentaCorriente: c.accountCode, centroCosto: c.centerCode,
      tipoEntrega: 'DOMICILIO', tipoPago: 'CUENTA_CORRIENTE', tipoServicio: serviceCode || 'NORMAL',
      ciudadOrigen: await cityId(s, s.originCommune), ciudadDestino: await cityId(s, dest.commune),
      remitente: { nombre: s.senderName, rut: s.senderRut, telefono: s.senderPhone, email: s.senderEmail, direccion: `${s.originAddress || ''} ${s.originNumber || ''}`.trim() },
      destinatario: { nombre: dest.name, telefono: dest.phone, email: dest.email, direccion: [dest.address, dest.number, dest.supplement].filter(Boolean).join(' '), comuna: dest.commune },
      bultos: [{ tipo: 'PAQUETE', kilos: pkg.weight, alto: pkg.height, ancho: pkg.width, largo: pkg.length }],
      valorDeclarado: Math.round(pkg.declaredValue), contenido: pkg.content.slice(0, 60), referencia: reference,
    };
    const res = await httpJson(`${base(s)}${path}`, { method: 'POST', headers: authHeaders(c), body: JSON.stringify(body) });
    const tracking = findField(res, ['ordenFlete', 'numeroOrdenFlete', 'of', 'nroOrdenFlete', 'trackingNumber']);
    if (!tracking) throw new Error(`Starken no devolvió número de orden de flete: ${JSON.stringify(res).slice(0, 200)}`);
    const label = pdfFromBase64(findField(res, ['etiqueta', 'etiquetaBase64', 'pdf', 'label']));
    const labelUrl = findField(res, ['urlEtiqueta', 'labelUrl']);
    return { trackingNumber: String(tracking), serviceName: `Starken ${body.tipoServicio.toLowerCase()}`, label, labelUrl: labelUrl ? String(labelUrl) : null, raw: res };
  },

  async track(c, s, trackingNumber): Promise<TrackingResult> {
    const path = ((s.trackingPath as string) || '/tracking/orden-flete/of/{of}').replace('{of}', encodeURIComponent(trackingNumber));
    const res = await httpJson(`${base(s)}${path}`, { headers: authHeaders(c) });
    const list: any[] = res?.history || res?.historial || res?.eventos || res?.data?.eventos || [];
    const events = list.map((e: any) => ({
      date: safeIso(e.fecha || e.created_at || e.date, e.hora),
      description: e.estado || e.status || e.descripcion || '',
      location: e.agencia || e.lugar || null,
    }));
    const statusText = res?.status || res?.estado || events[events.length - 1]?.description || 'Sin información';
    return { state: classifyStatus(String(statusText)), statusText: String(statusText), events };
  },
};
