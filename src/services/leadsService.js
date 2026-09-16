// Buscador de leads del dashboard: busca en vivo en GHL (no hay histórico de contactos
// individuales guardado, solo agregados por día) y arma la ficha con lo mismo que ya se
// calcula para las citas (verificación BOT + pago info + fecha de pago), sin llamadas extra —
// contacts/search ya devuelve tags y customFields completos por contacto.
const ghl = require('./ghlClient');
const { getBrands, ESTADO_TAGS } = require('./../config/brands');

const ETAPA_LABEL = {
  lead_cualificando: 'Cualificando',
  lead_potencial: 'Lead potencial',
  pago_pendiente: 'Pago pendiente',
  consulta_agendada: 'Consulta agendada',
  cliente_postventa: 'Cliente (posventa)',
  lead_no_potencial: 'No potencial',
};

function etapaDe(tags) {
  const tag = ESTADO_TAGS.find(t => tags.includes(t));
  return tag ? ETAPA_LABEL[tag] : 'Sin etapa de bot';
}

// Patrón estándar de GHL v2 para la ficha de un contacto en el panel — si esta cuenta usa un
// dominio propio/white-label distinto habría que ajustarlo.
function ghlUrl(brand, contactId) {
  return `https://app.gohighlevel.com/v2/location/${brand.locationId}/contacts/detail/${contactId}`;
}

function mapContacto(brand, c) {
  const tags = c.tags || [];
  const cf = c.customFields || [];
  const valorCampo = fieldId => cf.find(f => f.id === fieldId)?.value || null;
  const gestionadoPor = valorCampo(brand.botFieldId);
  const fechaPago = valorCampo(brand.fechaPagoFieldId);
  const verificado = tags.includes('pago info');
  const esBot = gestionadoPor === 'BOT';
  const tieneCita = tags.includes('consulta_agendada');

  return {
    contactId: c.id,
    nombre: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '(sin nombre)',
    telefono: c.phone || null,
    email: c.email || null,
    marca: brand.code,
    marcaNombre: brand.name,
    tags,
    etapa: etapaDe(tags),
    fechaAlta: c.dateAdded || null,
    cita: tieneCita ? { verificado, gestionadoPor, esBot, fechaPago, fiable: esBot && verificado && !!fechaPago } : null,
    ghlUrl: ghlUrl(brand, c.id),
  };
}

async function searchLeads(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  const brands = getBrands();
  const perBrand = await Promise.all(brands.map(async brand => {
    try {
      const contactos = await ghl.searchContactsByQuery(brand, q, 5);
      return contactos.map(c => mapContacto(brand, c));
    } catch (e) {
      console.error(`[searchLeads] Error en ${brand.code}:`, e.message);
      return [];
    }
  }));

  return perBrand.flat().slice(0, 15);
}

module.exports = { searchLeads };
