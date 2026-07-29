const ghl = require('./ghlClient');
const { getBrands, getBrand, ESTADO_TAGS, CANAL_TAGS } = require('../config/brands');
const DailyStat = require('../models/DailyStat');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isToday(fecha) {
  return fecha === todayStr();
}

// Caché en memoria del cálculo en vivo de "hoy" por marca. Sin esto, cada petición que toca
// el día actual dispara ~10-27 llamadas a GHL por marca; con varias pestañas o refrescos
// seguidos, la cola de rate-limit se satura y las respuestas tardan más de un minuto.
// Se cachea la PROMESA (no solo el resultado) para que peticiones concurrentes compartan
// el mismo cálculo en curso en vez de disparar cada una su propia tanda de llamadas.
const LIVE_TODAY_TTL_MS = 3 * 60 * 1000;
const liveTodayCache = new Map(); // brandCode -> { fecha, promise, expiresAt }

function getLiveTodayStats(brand) {
  const fecha = todayStr();
  const cached = liveTodayCache.get(brand.code);
  if (cached && cached.fecha === fecha && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  const promise = computeDailyStatsForBrand(brand, fecha);
  liveTodayCache.set(brand.code, { fecha, promise, expiresAt: Date.now() + LIVE_TODAY_TTL_MS });
  return promise;
}

// Calcula, en vivo contra GHL, todos los conteos de una marca para UN día concreto.
async function computeDailyStatsForBrand(brand, fecha) {
  // Las llamadas se serializan igualmente dentro de ghlClient (cola de rate-limit);
  // Promise.all aquí solo agrupa la espera, no las paraleliza de verdad.
  const [lead_cualificando, lead_potencial, pago_pendiente, consulta_agendada, cliente_postventa, lead_no_potencial] =
    await Promise.all([
      ghl.countTag(brand, 'lead_cualificando', fecha, fecha),
      ghl.countTag(brand, 'lead_potencial', fecha, fecha),
      ghl.countTag(brand, 'pago_pendiente', fecha, fecha),
      ghl.countTag(brand, 'consulta_agendada', fecha, fecha),
      ghl.countTag(brand, 'cliente_postventa', fecha, fecha),
      ghl.countTag(brand, 'lead_no_potencial', fecha, fecha),
    ]);

  const motivos_descarte = {};
  for (const tag of brand.motivosDescarte) {
    motivos_descarte[tag] = await ghl.countTagPair(brand, 'lead_no_potencial', tag, fecha, fecha);
  }

  const tramites_potencial = {};
  for (const t of brand.tramites) {
    tramites_potencial[`tramite_${t}`] = await ghl.countTagPair(brand, 'lead_potencial', `tramite_${t}`, fecha, fecha);
  }

  const meta_ads_potencial = await ghl.countTagPair(brand, 'lead_potencial', 'meta', fecha, fecha);

  const conversacion = lead_cualificando + lead_potencial + pago_pendiente + consulta_agendada + cliente_postventa + lead_no_potencial;

  return {
    marca: brand.code,
    fecha,
    conversacion,
    lead_cualificando,
    lead_potencial,
    pago_pendiente,
    consulta_agendada,
    cliente_postventa,
    lead_no_potencial,
    motivos_descarte,
    tramites_potencial,
    meta_ads_potencial,
    computedAt: new Date(),
  };
}

// Calcula y guarda (upsert) las stats de UNA marca para UN día. Pensado para el cron nocturno
// (día ya cerrado) y para el script de backfill.
async function upsertDailyStats(brandCode, fecha) {
  const brand = getBrand(brandCode);
  const stats = await computeDailyStatsForBrand(brand, fecha);
  await DailyStat.findOneAndUpdate(
    { marca: brandCode, fecha },
    { $set: stats },
    { upsert: true, returnDocument: 'after' },
  );
  return stats;
}

async function upsertDailyStatsAllBrands(fecha) {
  const results = [];
  for (const brand of getBrands()) {
    results.push(await upsertDailyStats(brand.code, fecha));
  }
  return results;
}

function stageTotals(d) {
  return {
    conversacion: d.conversacion,
    cualificado: d.lead_potencial + d.pago_pendiente + d.consulta_agendada + d.cliente_postventa,
    // cliente_postventa es posventa, no una cita real — no cuenta aquí.
    cita: d.consulta_agendada,
  };
}

// Serie diaria agregada (5 marcas sumadas) para el heatmap y la gráfica de tendencia,
// terminando hoy. Incluye el desglose por etapa (no solo Conversación).
async function getDailyTotals(days = 30) {
  const dates = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const closedDates = dates.filter(f => !isToday(f));
  const stored = await DailyStat.find({ fecha: { $in: closedDates } }).lean();

  const byDate = {};
  for (const f of dates) byDate[f] = { conversacion: 0, cualificado: 0, cita: 0 };
  for (const doc of stored) {
    const t = stageTotals(doc);
    byDate[doc.fecha].conversacion += t.conversacion;
    byDate[doc.fecha].cualificado += t.cualificado;
    byDate[doc.fecha].cita += t.cita;
  }

  if (dates.includes(todayStr())) {
    const brands = getBrands();
    const todayStats = await Promise.all(brands.map(b => getLiveTodayStats(b)));
    const todayTotals = todayStats.reduce((acc, s) => {
      const t = stageTotals(s);
      acc.conversacion += t.conversacion; acc.cualificado += t.cualificado; acc.cita += t.cita;
      return acc;
    }, { conversacion: 0, cualificado: 0, cita: 0 });
    byDate[todayStr()] = todayTotals;
  }

  return dates.map(fecha => ({ fecha, ...byDate[fecha] }));
}

// Detalle por marca de UN día concreto (para el clic en el heatmap).
async function getDetailForDate(fecha) {
  if (isToday(fecha)) {
    const brands = getBrands();
    return Promise.all(brands.map(brand => getLiveTodayStats(brand)));
  }

  const stored = await DailyStat.find({ fecha }).lean();
  if (stored.length) return stored;

  // Día cerrado sin foto guardada (ej. el cron no llegó a ejecutarse esa noche):
  // se calcula en vivo para ESA fecha en concreto (nunca "hoy") y se guarda para la próxima vez.
  return Promise.all(getBrands().map(brand => upsertDailyStats(brand.code, fecha)));
}

function mergeMaps(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    target[k] = (target[k] || 0) + (v || 0);
  }
}

// Agrega el funnel completo (como el Artifact) sumando los DailyStat guardados en un rango.
// Si el rango incluye "hoy", ese día se computa en vivo y se suma también.
async function getSummary(desde, hasta) {
  const brands = getBrands();
  const perBrand = [];

  for (const brand of brands) {
    // Los DailyStat guardados solo cubren días ya cerrados (el cron nunca escribe "hoy"),
    // así que basta con el rango tal cual; si hasta=hoy, el día de hoy se añade en vivo abajo.
    const docs = await DailyStat.find({
      marca: brand.code,
      fecha: { $gte: desde, $lte: hasta },
    }).lean();

    const acc = {
      marca: brand.code,
      nombre: brand.name,
      conversacion: 0, lead_cualificando: 0, lead_potencial: 0, pago_pendiente: 0,
      consulta_agendada: 0, cliente_postventa: 0, lead_no_potencial: 0,
      motivos_descarte: {}, tramites_potencial: {}, meta_ads_potencial: 0,
    };

    for (const d of docs) {
      if (d.fecha < desde || d.fecha > hasta) continue;
      acc.conversacion += d.conversacion;
      acc.lead_cualificando += d.lead_cualificando;
      acc.lead_potencial += d.lead_potencial;
      acc.pago_pendiente += d.pago_pendiente;
      acc.consulta_agendada += d.consulta_agendada;
      acc.cliente_postventa += d.cliente_postventa;
      acc.lead_no_potencial += d.lead_no_potencial;
      mergeMaps(acc.motivos_descarte, d.motivos_descarte instanceof Map ? Object.fromEntries(d.motivos_descarte) : d.motivos_descarte);
      mergeMaps(acc.tramites_potencial, d.tramites_potencial instanceof Map ? Object.fromEntries(d.tramites_potencial) : d.tramites_potencial);
      acc.meta_ads_potencial += d.meta_ads_potencial;
    }

    if (hasta === todayStr()) {
      const live = await getLiveTodayStats(brand);
      acc.conversacion += live.conversacion;
      acc.lead_cualificando += live.lead_cualificando;
      acc.lead_potencial += live.lead_potencial;
      acc.pago_pendiente += live.pago_pendiente;
      acc.consulta_agendada += live.consulta_agendada;
      acc.cliente_postventa += live.cliente_postventa;
      acc.lead_no_potencial += live.lead_no_potencial;
      mergeMaps(acc.motivos_descarte, live.motivos_descarte);
      mergeMaps(acc.tramites_potencial, live.tramites_potencial);
      acc.meta_ads_potencial += live.meta_ads_potencial;
    }

    acc.etapa1_cualificado = acc.lead_potencial + acc.pago_pendiente + acc.consulta_agendada + acc.cliente_postventa;
    // Cita = solo consulta_agendada. cliente_postventa es posventa (el bot no gestiona esa fase),
    // no una cita real, así que no debe inflar este conteo.
    acc.etapa2_cita = acc.consulta_agendada;
    acc.etapa3_venta = acc.cliente_postventa;

    // Ingreso estimado de las citas: no hay tag de modalidad (online/presencial) fiable en GHL,
    // así que se da un rango (mínimo = todas online, máximo = todas presenciales).
    const precio = getBrand(brand.code).precioAsesoria;
    acc.ingreso_min = acc.etapa2_cita * precio.online;
    acc.ingreso_max = acc.etapa2_cita * precio.presencial;

    perBrand.push(acc);
  }

  const total = perBrand.reduce((acc, b) => {
    acc.conversacion += b.conversacion;
    acc.etapa1_cualificado += b.etapa1_cualificado;
    acc.etapa2_cita += b.etapa2_cita;
    acc.etapa3_venta += b.etapa3_venta;
    acc.ingreso_min += b.ingreso_min;
    acc.ingreso_max += b.ingreso_max;
    return acc;
  }, { conversacion: 0, etapa1_cualificado: 0, etapa2_cita: 0, etapa3_venta: 0, ingreso_min: 0, ingreso_max: 0 });

  return { desde, hasta, marcas: perBrand, total };
}

// Caché simple (10 min) para el desglose de canal de entrada por marca, ya que no se guarda
// en Mongo (no varía la fórmula día a día) y recalcularlo en cada petición sería 15 llamadas a GHL.
const CHANNEL_TTL_MS = 10 * 60 * 1000;
const channelCache = new Map(); // "desde|hasta" -> { promise, expiresAt }

async function computeChannelBreakdown(desde, hasta) {
  const brands = getBrands();
  const perBrand = await Promise.all(brands.map(async brand => {
    const counts = {};
    for (const tag of CANAL_TAGS) {
      counts[tag] = await ghl.countTag(brand, tag, desde, hasta);
    }
    return { marca: brand.code, nombre: brand.name, canales: counts };
  }));
  return { desde, hasta, marcas: perBrand };
}

function getChannelBreakdown(desde, hasta) {
  const key = `${desde}|${hasta}`;
  const cached = channelCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = computeChannelBreakdown(desde, hasta);
  channelCache.set(key, { promise, expiresAt: Date.now() + CHANNEL_TTL_MS });
  return promise;
}

// Timeline de citas (tag consulta_agendada) por marca, con nombre y fecha. Se cruza con los
// eventos de TODOS los calendarios de la marca para saber si la cita tiene una reserva real
// verificable en GHL (el bot a veces marca el tag solo al enviar el enlace, sin confirmar que
// la persona reservó de verdad) — ver conversación del 2026-07-29. Si no hay evento, se usa
// dateUpdated del contacto como fecha aproximada y se marca verificado:false.
// 1h de TTL: esta consulta cuesta ~130 llamadas a GHL (~90s), y las citas no cambian
// tan a menudo como para justificar recalcularla cada pocos minutos.
const TIMELINE_TTL_MS = 60 * 60 * 1000;
const timelineCache = new Map(); // "desde|hasta" -> { promise, expiresAt }

async function computeCitasTimeline(desde, hasta) {
  const brands = getBrands();
  const perBrand = await Promise.all(brands.map(async brand => {
    const contactos = await ghl.listByTag(brand, 'consulta_agendada', desde, hasta);

    const calendars = await ghl.listCalendars(brand);
    const startMs = new Date(desde).getTime();
    const endMs = new Date(hasta).getTime() + 120 * 24 * 60 * 60 * 1000; // +120 días, por si la cita real cae más adelante
    const eventByContact = new Map();
    for (const cal of calendars) {
      const events = await ghl.getCalendarEvents(brand, cal.id, startMs, endMs);
      for (const ev of events) {
        if (!eventByContact.has(ev.contactId)) {
          eventByContact.set(ev.contactId, { fecha: ev.startTime, estado: ev.appointmentStatus, calendario: cal.name });
        }
      }
    }

    const citas = contactos.map(c => {
      const ev = eventByContact.get(c.id);
      return {
        nombre: c.nombre,
        fecha: ev ? ev.fecha : c.dateUpdated,
        estadoCita: ev ? ev.estado : null,
        verificado: !!ev,
      };
    }).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    return { marca: brand.code, nombre: brand.name, citas };
  }));
  return { desde, hasta, marcas: perBrand };
}

function getCitasTimeline(desde, hasta) {
  const key = `${desde}|${hasta}`;
  const cached = timelineCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = computeCitasTimeline(desde, hasta);
  timelineCache.set(key, { promise, expiresAt: Date.now() + TIMELINE_TTL_MS });
  return promise;
}

module.exports = {
  computeDailyStatsForBrand,
  upsertDailyStats,
  upsertDailyStatsAllBrands,
  getDailyTotals,
  getDetailForDate,
  getSummary,
  getChannelBreakdown,
  getCitasTimeline,
  todayStr,
};
