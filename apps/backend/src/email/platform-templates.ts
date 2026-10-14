// Correos de la plataforma: textos por defecto, variables y valores de ejemplo para la vista previa.
// El Super Admin edita asunto, título, cuerpo y botón (PlatformEmailTemplate); sin fila se usa esto.
//
// Formato del cuerpo: párrafos separados por una línea en blanco, salto de línea simple = <br>,
// **negrita**, *cursiva* y variables {{nombre}}. Una línea cuyas variables quedan todas vacías se
// omite (así un dato opcional, como el teléfono o el mensaje de una invitación, no deja una línea suelta).

export type PlatformTemplateDef = {
  key: string;
  label: string;
  trigger: string;
  subject: string;
  title: string;
  body: string;
  // null = el correo no lleva botón; si lo lleva, apunta a {{enlace}}.
  buttonLabel: string | null;
  vars: Record<string, string>;
  sample: Record<string, string>;
  // El enlace da acceso a una cuenta: en el registro de correos queda tapado.
  sensitiveLink?: boolean;
};

// Disponibles en todos los correos.
export const COMMON_VARS: Record<string, string> = { marca: 'Nombre de la plataforma (Diseño → Nombre)' };

export const PLATFORM_TEMPLATES: PlatformTemplateDef[] = [
  {
    key: 'SALES_REPORT',
    label: 'Reporte de ventas programado',
    trigger: 'Cada semana, según lo programado en Ventas → Reportes (con el Excel adjunto)',
    subject: '{{reporte}} — {{empresa}}',
    title: '{{reporte}}',
    body: 'Te enviamos el reporte **{{reporte}}** de **{{empresa}}**, del {{desde}} al {{hasta}}. Va adjunto en Excel.\n\nVentas en el período: **{{cantidad}}** · Total: **{{total}}**\n\nLo recibes porque está programado en Ventas → Reportes.',
    buttonLabel: 'Ver reportes',
    vars: {
      reporte: 'Nombre del reporte', empresa: 'Nombre de la empresa', desde: 'Inicio del período', hasta: 'Fin del período',
      cantidad: 'Número de ventas del período', total: 'Total vendido del período', enlace: 'Enlace a Reportes',
    },
    sample: { reporte: 'Ventas por producto', empresa: 'Tienda Ejemplo', desde: '06-10-2026', hasta: '12-10-2026', cantidad: '318', total: '$12.480.990', enlace: 'https://adminmarket.ondatasolution.com/dashboard/reportes' },
  },
  {
    key: 'PASSWORD_RESET',
    label: 'Recuperación de contraseña',
    trigger: 'Al usar "¿Olvidaste tu contraseña?"',
    subject: 'Crea una nueva contraseña',
    title: 'Recupera tu acceso',
    body: 'Hola {{nombre}}, recibimos una solicitud para crear una nueva contraseña en {{marca}}.\n\nEl enlace sirve una sola vez y vence en 1 hora. Si no lo pediste, ignora este correo: tu contraseña actual sigue igual.',
    buttonLabel: 'Crear nueva contraseña',
    vars: { nombre: 'Primer nombre del usuario', enlace: 'Enlace para crear la contraseña' },
    sample: { nombre: 'Camila', enlace: 'https://adminmarket.ondatasolution.com/restablecer?token=ejemplo' },
    sensitiveLink: true,
  },
  {
    key: 'PASSWORD_CHANGED',
    label: 'Contraseña cambiada',
    trigger: 'Después de crear una contraseña nueva con el enlace de recuperación',
    subject: 'Tu contraseña fue cambiada',
    title: 'Contraseña actualizada',
    body: 'Hola {{nombre}}, la contraseña de tu cuenta de {{marca}} se cambió correctamente y se cerraron las sesiones abiertas en otros equipos.\n\nSi no fuiste tú, contacta a soporte de inmediato.',
    buttonLabel: null,
    vars: { nombre: 'Primer nombre del usuario' },
    sample: { nombre: 'Camila' },
  },
  {
    key: 'WELCOME',
    label: 'Bienvenida',
    trigger: 'Al registrarse una empresa nueva (o activar una invitación de empresa)',
    subject: 'Bienvenido a {{marca}}',
    title: '¡Bienvenido, {{nombre}}!',
    body: 'Creamos la cuenta de **{{empresa}}**{{detallePlan}}.\n\nConecta tus canales de venta, carga tu catálogo y gestiona tus órdenes desde un solo lugar.',
    buttonLabel: 'Entrar al panel',
    vars: {
      nombre: 'Primer nombre del administrador', empresa: 'Nombre de la empresa',
      detallePlan: 'Texto del plan, p. ej. " con 15 días de prueba gratis" (vacío si no tiene plan)', enlace: 'Enlace al login',
    },
    sample: { nombre: 'Camila', empresa: 'Tienda Ejemplo', detallePlan: ' con 15 días de prueba gratis', enlace: 'https://adminmarket.ondatasolution.com/login' },
  },
  {
    key: 'NEW_COMPANY_NOTICE',
    label: 'Aviso de empresa nueva (al Super Admin)',
    trigger: 'Al registrarse una empresa; va al correo de "Avisos de empresas nuevas a"',
    subject: 'Nueva empresa registrada: {{empresa}}',
    title: 'Nueva empresa registrada',
    body: '**{{empresa}}** {{via}}{{detallePlan}}.\n\nAdministrador: {{admin}} ({{correoAdmin}})\nTeléfono: {{telefono}}\nRUT: {{rut}}',
    buttonLabel: 'Ver empresas',
    vars: {
      empresa: 'Nombre de la empresa', via: 'Cómo llegó (p. ej. "se registró con Google")',
      detallePlan: 'Texto del plan, p. ej. " y quedó con el plan Demo"', admin: 'Nombre del administrador',
      correoAdmin: 'Correo del administrador', telefono: 'Teléfono (si lo indicó)', rut: 'RUT (si lo indicó)', enlace: 'Enlace a Empresas',
    },
    sample: {
      empresa: 'Tienda Ejemplo', via: 'se registró con Google', detallePlan: ' y quedó con el plan Demo', admin: 'Camila Rojas',
      correoAdmin: 'camila@ejemplo.cl', telefono: '+56 9 1234 5678', rut: '76.123.456-7', enlace: 'https://adminmarket.ondatasolution.com/dashboard/companies',
    },
  },
  {
    key: 'USER_INVITATION',
    label: 'Invitación de usuario',
    trigger: 'Al invitar a un usuario a una empresa (Usuarios → Invitar usuario)',
    subject: '{{invitador}} te invitó a {{empresa}} en {{marca}}',
    title: 'Te invitaron a {{empresa}}',
    body: '{{saludo}}{{invitador}} te invitó a unirte a **{{empresa}}** en {{marca}} con el perfil **{{perfil}}**.\n\nPuedes entrar con tu cuenta de Google ({{correo}}) o crear una contraseña. La invitación vence en 7 días.',
    buttonLabel: 'Aceptar invitación',
    vars: {
      saludo: '"Hola Nombre, " si se indicó el nombre (vacío si no)', invitador: 'Quién invita', empresa: 'Nombre de la empresa',
      perfil: 'Perfil de acceso asignado', correo: 'Correo invitado', enlace: 'Enlace para aceptar',
    },
    sample: {
      saludo: 'Hola Pedro, ', invitador: 'Camila Rojas', empresa: 'Tienda Ejemplo', perfil: 'Vendedor',
      correo: 'pedro@ejemplo.cl', enlace: 'https://adminmarket.ondatasolution.com/invitacion?token=ejemplo',
    },
    sensitiveLink: true,
  },
  {
    key: 'COMPANY_INVITATION',
    label: 'Invitación de empresa',
    trigger: 'Al invitar a una empresa nueva (Empresas → Invitar empresa)',
    subject: 'Tu cuenta de {{empresa}} en {{marca}}',
    title: 'Activa {{empresa}} en {{marca}}',
    body: '{{saludo}}te invitamos a administrar **{{empresa}}** en {{marca}}{{detallePlan}}.\n\n*“{{mensaje}}”*\n\nEntra con tu cuenta de Google ({{correo}}) o crea una contraseña. El enlace vence en 7 días.',
    buttonLabel: 'Activar mi cuenta',
    vars: {
      saludo: '"Hola Nombre, " si se indicó el nombre (vacío si no)', empresa: 'Nombre de la empresa',
      detallePlan: 'Texto del plan, p. ej. " con el plan Crece (15 días de prueba)"', mensaje: 'Mensaje personal de la invitación (opcional)',
      correo: 'Correo invitado', enlace: 'Enlace para activar',
    },
    sample: {
      saludo: 'Hola Camila, ', empresa: 'Tienda Ejemplo', detallePlan: ' con el plan Crece (15 días de prueba)',
      mensaje: 'Te dejamos todo listo para partir.', correo: 'camila@ejemplo.cl', enlace: 'https://adminmarket.ondatasolution.com/activar?token=ejemplo',
    },
    sensitiveLink: true,
  },
  {
    key: 'TEST',
    label: 'Correo de prueba',
    trigger: 'Botón "Enviar prueba" de Ajustes del sistema → Correo de la plataforma',
    subject: 'Prueba del correo de {{marca}}',
    title: 'El correo de la plataforma funciona',
    body: 'Si recibes este mensaje, la recuperación de contraseña y los avisos de {{marca}} se enviarán correctamente.',
    buttonLabel: null,
    vars: {},
    sample: {},
  },
];

export const platformTemplate = (key: string) => PLATFORM_TEMPLATES.find((t) => t.key === key);

// Nombres de todos los tipos que aparecen en el registro de correos (plataforma y empresas).
export const EMAIL_TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PLATFORM_TEMPLATES.map((t) => [t.key, t.label])),
  TEMPLATE_TEST: 'Prueba de plantilla',
  ORDER_CONFIRMED: 'Orden confirmada',
  ORDER_PREPARING: 'Orden en preparación',
  ORDER_READY_PICKUP: 'Lista para retiro',
  ORDER_OUT_FOR_DELIVERY: 'Orden en camino',
  ORDER_DELIVERED: 'Orden entregada',
  SALE_RECEIPT: 'Recibo de venta',
  COMPANY_TEST: 'Prueba SMTP de la empresa',
  INVOICE: 'Documento tributario',
  WORK_ORDER: 'Orden de trabajo',
  DROPSHIP_ORDER: 'Pedido a proveedor (dropshipping)',
};
