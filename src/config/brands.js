// Catálogo de las 5 marcas GHL. Tokens/locationId/campo "gestionado por" vienen de variables
// de entorno; el resto (catálogo de trámites y motivos de descarte) es fijo, validado a mano
// contra el código real del bot en n8n (ver estadistica-bot/MAPEO_TODAS_MARCAS.md).

const BRANDS = [
  {
    code: 'CYA',
    name: 'Cohen & Aguirre',
    tokenEnv: 'GHL_CYA_TOKEN',
    locationId: process.env.GHL_CYA_LOCATION_ID,
    botFieldId: process.env.GHL_CYA_BOT_FIELD_ID,
    tramites: [
      'trabajo_cuenta_ajena', 'arraigos', 'profesional_altamente_cualificado', 'nomada_digital',
      'familiar', 'familiar_comunitario', 'no_lucrativa', 'residencia_de_emprendedor',
      'visa_de_estudios', 'residencia_cuenta_propia_inicial', 'reagrupacion_familiar',
      'nacionalizacion', 'homologacion_titulo', 'cualificacion_general',
    ],
    motivosDescarte: ['info_pasaporte_no', 'info_capital_no', 'info_antecedentes_no', 'info_estancia_no', 'info_capital_30_no', 'info_apostillado_no'],
    precioAsesoria: { online: 60, presencial: 80 },
  },
  {
    code: 'ETH',
    name: 'España te homologa',
    tokenEnv: 'GHL_ETH_TOKEN',
    locationId: process.env.GHL_ETH_LOCATION_ID,
    botFieldId: process.env.GHL_ETH_BOT_FIELD_ID,
    tramites: ['homologacion_titulo', 'equivalencia_titulo'],
    motivosDescarte: ['info_pasaporte_no', 'info_documentacion_no'],
    precioAsesoria: { online: 60, presencial: 80 },
  },
  {
    code: 'ETV',
    name: 'Estuvisa',
    tokenEnv: 'GHL_ETV_TOKEN',
    locationId: process.env.GHL_ETV_LOCATION_ID,
    botFieldId: process.env.GHL_ETV_BOT_FIELD_ID,
    tramites: ['visa_estudios'],
    motivosDescarte: ['info_pasaporte_no', 'info_capital_no'],
    precioAsesoria: { online: 35, presencial: 50 },
  },
  {
    code: 'NAC',
    name: 'Nacionalízate',
    tokenEnv: 'GHL_NAC_TOKEN',
    locationId: process.env.GHL_NAC_LOCATION_ID,
    botFieldId: process.env.GHL_NAC_BOT_FIELD_ID,
    tramites: [
      'trabajo_cuenta_ajena', 'arraigos', 'profesional_altamente_cualificado', 'nomada_digital',
      'familiar', 'familiar_comunitario', 'no_lucrativa', 'residencia_de_emprendedor',
      'visa_de_estudios', 'residencia_cuenta_propia_inicial', 'reagrupacion_familiar',
      'nacionalizacion', 'visa_turismo', 'cualificacion_general',
    ],
    motivosDescarte: ['info_pasaporte_no', 'info_capital_no', 'info_antecedentes_no', 'info_estancia_no', 'info_capital_30_no'],
    precioAsesoria: { online: 60, presencial: 80 },
  },
  {
    code: 'MNEE',
    name: 'Mi negocio en España',
    tokenEnv: 'GHL_MNEE_TOKEN',
    locationId: process.env.GHL_MNEE_LOCATION_ID,
    botFieldId: process.env.GHL_MNEE_BOT_FIELD_ID,
    tramites: ['mi_negocio', 'acompanamiento'],
    motivosDescarte: ['info_pasaporte_no', 'info_capital_no'],
    precioAsesoria: { online: 50, presencial: 50 },
  },
];

// Tags de canal de entrada, validados a mano contra GHL (contacts/search por tag) — solo estos
// tres existen de forma consistente en las 5 marcas; no hay tags de "web" ni "tiktok".
const CANAL_TAGS = ['canal_whatsapp', 'canal_instagram', 'canal_facebook'];

// Tags de estado del bot — idénticos en las 5 marcas (ver AdaptarGHL/AsegurarContacto en n8n)
const ESTADO_TAGS = [
  'lead_cualificando', 'lead_potencial', 'lead_no_potencial',
  'pago_pendiente', 'consulta_agendada', 'cliente_postventa',
];

function getBrands() {
  return BRANDS.map(b => ({ ...b, token: process.env[b.tokenEnv] }));
}

function getBrand(code) {
  const b = getBrands().find(x => x.code === code);
  if (!b) throw new Error(`Marca desconocida: ${code}`);
  return b;
}

module.exports = { BRANDS, ESTADO_TAGS, CANAL_TAGS, getBrands, getBrand };
