// Textos en español de los estados/subestados de envío de Mercado Libre (Mercado Envíos) para
// el historial de la orden. Se usa al guardar cada hito y también al LEER el historial, para
// que los hitos guardados antes con el código en inglés ("(first_visit)") se vean traducidos.

const SUB: Record<string, string> = {
  // pending / handling
  shipment_paid: 'Envío pagado',
  waiting_for_payment: 'Esperando el pago',
  cost_exceeded: 'Costo de envío excedido',
  under_review: 'En revisión',
  reviewed: 'Revisado',
  fraudulent: 'Bloqueado por posible fraude',
  creating_route: 'Generando ruta de envío',
  buffered: 'En espera para despacho',
  manufacturing: 'En fabricación',
  regenerating: 'Regenerando la etiqueta',
  waiting_for_label_generation: 'Generando la etiqueta',
  invoice_pending: 'Factura pendiente',
  waiting_for_return_confirmation: 'Esperando confirmación de devolución',
  return_confirmed: 'Devolución confirmada',
  // ready_to_ship
  ready_to_print: 'Etiqueta lista para imprimir',
  printed: 'Etiqueta impresa',
  ready_for_dropoff: 'Listo para dejar en punto de despacho',
  ready_for_pickup: 'Listo para retiro del transportista',
  ready_for_pkl_creation: 'Listo para lista de despacho',
  in_pickup_list: 'En lista de retiro',
  in_packing_list: 'En lista de despacho',
  in_plp: 'En lista de despacho',
  packed: 'Embalado',
  measures_ready: 'Medidas registradas',
  waiting_for_carrier_authorization: 'Esperando autorización del transportista',
  authorized_by_carrier: 'Autorizado por el transportista',
  picked_up: 'Retirado por el transportista',
  dropped_off: 'Dejado en punto de despacho',
  in_hub: 'En centro de distribución',
  on_hold: 'En espera',
  stale: 'Envío detenido',
  // shipped
  out_for_delivery: 'En reparto',
  soon_deliver: 'Pronto a entregarse',
  first_visit: 'Primera visita del transportista',
  second_visit: 'Segunda visita del transportista',
  delayed: 'Envío demorado',
  waiting_for_withdrawal: 'Esperando retiro en sucursal',
  contact_with_carrier_required: 'Requiere contacto con el transportista',
  receiver_absent: 'Destinatario ausente',
  not_visited: 'No visitado',
  bad_address: 'Dirección incorrecta',
  changed_address: 'Dirección modificada',
  not_localized: 'Destinatario no ubicado',
  forwarded_to_third: 'Derivado a otro transportista',
  at_customs: 'En aduana',
  retained: 'Retenido',
  claimed_me: 'Reclamado por el comprador',
  reclaimed: 'Reclamado',
  delivery_failed: 'Entrega fallida',
  returning_to_sender: 'Volviendo al vendedor',
  returning_to_hub: 'Volviendo al centro de distribución',
  return_failed: 'Devolución fallida',
  stolen: 'Robado',
  lost: 'Extraviado',
  damaged: 'Dañado',
  // delivered / not_delivered
  inferred: 'Entrega confirmada',
  fulfilled_feedback: 'Entregado (confirmado por el comprador)',
  no_action_taken: 'Sin acción del comprador',
  double_refund: 'Doble reembolso',
  returned: 'Devuelto al vendedor',
};

const STATUS: Record<string, string> = {
  pending: 'Envío pendiente',
  handling: 'Pago acreditado, envío en preparación',
  ready_to_ship: 'Listo para despachar',
  shipped: 'Despachado — en camino',
  first_visit: 'Primera visita del transportista',
  not_delivered: 'No entregado',
  delivered: 'Entregado',
  returned: 'Devuelto al vendedor',
  cancelled: 'Envío cancelado',
  to_be_agreed: 'Envío a acordar con el comprador',
};

// Código desconocido de ML ("waiting_for_x") → "Waiting for x": mejor que el código crudo.
function humanize(code: string): string {
  const t = code.replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : code;
}

export function mlShipmentLabel(status: string, substatus: string | null | undefined): string {
  const base = STATUS[status] || `Envío: ${humanize(status)}`;
  if (!substatus) return base;
  const sub = SUB[substatus];
  if (!sub) return base; // subestado sin traducir: se muestra solo el estado, nunca el código
  // Algunos subestados ya dicen todo por sí solos (p. ej. "Etiqueta impresa").
  return status === 'ready_to_ship' || status === 'pending' || status === 'handling' ? sub : `${base} · ${sub}`;
}

// Título guardado → título para mostrar. Re-traduce los hitos de ML con su estado/subestado y,
// si no los tiene, quita un código en inglés entre paréntesis al final ("... (first_visit)").
export function displayMlEventTitle(ev: { source?: string | null; title: string; externalStatus?: string | null; externalSubstatus?: string | null }): string {
  if (ev.source !== 'MERCADO_LIBRE') return ev.title;
  if (ev.externalStatus && (STATUS[ev.externalStatus] || ev.externalSubstatus)) {
    return mlShipmentLabel(ev.externalStatus, ev.externalSubstatus);
  }
  return ev.title.replace(/\s*\(([a-z_]+)\)\s*$/, (_m, code: string) => (SUB[code] ? ` · ${SUB[code]}` : ''));
}
