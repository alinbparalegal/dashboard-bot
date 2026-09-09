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

function getLiveTodayStats(brand, force = false) {
  const fecha = todayStr();
  const cached = liveTodayCache.get(brand.code);
  if (!force && cached && cached.fecha === fecha && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  const promise = computeCoreDiario(brand, fecha);
  liveTodayCache.set(brand.code, { fecha, promise, expiresAt: Date.now() + LIVE_TODAY_TTL_MS });
  return promise;
}

// Caché en vivo separada para el bloque de atribución de "hoy" (canales/sessionSource/
// campañas/citas) — más barata que el core, pero conviene no atarla a la misma caché para
// que pedir canales/timeline/atribución no dispare (ni comparta) el cálculo del resumen.
const liveAtribucionCache = new Map(); // brandCode -> { fecha, promise, expiresAt }

function getLiveAtribucionToday(brand, force = false) {
  const fecha = todayStr();
  const cached = liveAtribucionCache.get(brand.code);
  if (!force && cached && cached.fecha === fecha && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  const promise = computeAtribucionDiaria(brand, fecha);
  liveAtribucionCache.set(brand.code, { fecha, promise, expiresAt: Date.now() + LIVE_TODAY_TTL_MS });
  return promise;
}

function normalizaCampana(nombre) {
  return nombre.trim().replace(/\s+/g, ' ').toLowerCase();
}

// GHL no reconoce TikTok como sessionSource propio (cae en "Referral" o "Direct traffic"
// genéricos) — hay que detectarlo a mano por utm_source=tiktok, medium=tiktok, o el referrer
// de la webview interna de la app (tiktok.com), validado a mano contra las 5 marcas.
function esTikTok(c) {
  const utmSource = (c.utmSource || '').toLowerCase();
  const medium = (c.medium || '').toLowerCase();
  const referrer = (c.referrer || '').toLowerCase();
  return utmSource === 'tiktok' || medium === 'tiktok' || referrer.includes('tiktok.com');
}

// Canal real del último mensaje (GHL nativo, vía conversations/search) — sustituye a los
// tags canal_whatsapp/instagram/facebook, que una plantilla de automatización compartida
// dejó de aplicar el 2026-09-01 en las 5 marcas a la vez (se quedaron en un "lead-organico"
// genérico que no distingue canal). No depende de que ninguna automatización recuerde
// etiquetar nada — es un hecho que GHL ya registra por su cuenta.
const CANAL_DE_TIPO = {
  TYPE_WHATSAPP: 'canal_whatsapp',
  TYPE_INSTAGRAM: 'canal_instagram',
  TYPE_FACEBOOK: 'canal_facebook',
};

// Canal de entrada, procedencia real (sessionSource/TikTok) y campañas de UN día, para UNA
// marca. Acotado a un solo día, el listado de contactos con algún tag de estado (para
// sessionSource/campaña) casi nunca pasa de una página, así que sale barato guardarlo día
// a día en vez de recalcularlo cada vez que alguien pide un rango.
async function computeAtribucionDiaria(brand, fecha) {
  const contactosDia = await ghl.listByAnyTag(brand, ESTADO_TAGS, fecha, fecha);
  const lastMessageTypes = await Promise.all(contactosDia.map(c => ghl.getLastMessageType(brand, c.id)));

  const canales = { canal_whatsapp: 0, canal_instagram: 0, canal_facebook: 0 };
  const session_source = {};
  const campanasMap = new Map();
  contactosDia.forEach((c, i) => {
    const lastMessageType = lastMessageTypes[i];
    const canalTag = CANAL_DE_TIPO[lastMessageType];
    if (canalTag) canales[canalTag]++;

    // TikTok: GHL ya lo distingue como canal propio (TYPE_TIKTOK) cuando hay conversación —
    // más directo que la heurística de UTM/referrer, que se mantiene como respaldo para
    // leads que llegan con ese origen pero sin llegar a escribir.
    const src = (lastMessageType === 'TYPE_TIKTOK' || esTikTok(c)) ? 'TikTok' : (c.sessionSource || 'Desconocido');
    session_source[src] = (session_source[src] || 0) + 1;
    if (c.campaign) {
      // "Paid Social" es el único sessionSource que GHL solo asigna cuando detecta un clic
      // de anuncio real (campaignId/adId de Facebook) — un UTM de campaña puesto a mano en
      // un enlace orgánico (bio, búsqueda) nunca lo produce, así que separa pago de orgánico
      // mejor que fiarse del texto de utm_medium (que en los anuncios trae el nombre del
      // conjunto de anuncios, no una palabra clave).
      const pago = c.sessionSource === 'Paid Social';
      const key = `${normalizaCampana(c.campaign)}__${pago}`;
      if (!campanasMap.has(key)) campanasMap.set(key, { key, nombre: c.campaign.trim(), pago, leads: 0, cualificados: 0, citas: 0 });
      const entry = campanasMap.get(key);
      entry.leads++;
      if (c.tags.some(t => ['lead_potencial', 'pago_pendiente', 'consulta_agendada', 'cliente_postventa'].includes(t))) entry.cualificados++;
      if (c.tags.includes('consulta_agendada')) entry.citas++;
    }
  });

  // Citas conseguidas ese día (misma verificación/gestión que el timeline), acotado a un
  // día: listByTag no pagina, pero un solo día nunca se acerca al límite de 100.
  const citasContactos = await ghl.listByTag(brand, 'consulta_agendada', fecha, fecha);
  const citasDetalles = await Promise.all(citasContactos.map(c => ghl.getContact(brand, c.id)));
  const gestionadoPorDe = detalle => {
    const cf = (detalle?.customFields || []).find(f => f.id === brand.botFieldId);
    return cf?.value || null;
  };
  const citas = citasContactos.map((c, i) => {
    const gestionadoPor = gestionadoPorDe(citasDetalles[i]);
    return {
      contactId: c.id,
      nombre: c.nombre,
      fecha: c.dateAdded,
      verificado: c.tags.includes('pago info'),
      gestionadoPor,
      esBot: gestionadoPor === 'BOT',
    };
  });

  return { canales, session_source, campanas: [...campanasMap.values()], citas };
}

// Conteos "core" (conversación/cualificado/cita y sus desgloses) de una marca para UN día,
// en vivo contra GHL. Es lo único que necesita el resumen/KPIs — deliberadamente NO incluye
// el bloque de atribución (más caro, ver computeAtribucionDiaria) para que el resumen de
// "hoy" siga siendo tan rápido como siempre, aunque nadie haya pedido aún canales/timeline.
async function computeCoreDiario(brand, fecha) {
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
  };
}

// Combina core + atribución para UN día — el snapshot completo que se guarda en Mongo
// (cron nocturno, self-heal y backfill). No se usa para lecturas en vivo de "hoy" (ver
// getLiveTodayStats y getLiveAtribucionToday, que piden cada bloque por separado y más barato).
async function computeDailyStatsForBrand(brand, fecha) {
  const core = await computeCoreDiario(brand, fecha);
  const { canales, session_source, campanas, citas } = await computeAtribucionDiaria(brand, fecha);

  return {
    ...core,
    canales,
    session_source,
    campanas,
    citas,
    statsVersion: 2,
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

// Serie diaria agregada (5 marcas sumadas) para el heatmap y la gráfica de tendencia. Si se
// pasan desde/hasta (ej. una pestaña de mes concreto), la serie cubre exactamente ese rango;
// si no, cubre los últimos `days` días terminando hoy (comportamiento por defecto de "Todo").
async function getDailyTotals({ days = 30, desde, hasta } = {}) {
  let dates;
  if (desde && hasta) {
    dates = [];
    const cursor = new Date(desde);
    const end = new Date(hasta);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    dates = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  const closedDates = dates.filter(f => !isToday(f));
  const stored = await DailyStat.find({ fecha: { $in: closedDates } }).lean();

  // Autorreparación: si un día cerrado reciente no tiene NINGÚN documento guardado (el cron
  // nocturno no llegó a ejecutarse esa noche — típico si el servicio estuvo dormido/reiniciado
  // justo a esa hora), se recalcula y se guarda ahora mismo, en vez de mostrarlo como 0 en el
  // heatmap. Acotado a los últimos 10 días para no disparar recálculos caros sobre huecos
  // antiguos (esos ya se rellenan a mano si hace falta, ver backfillDailyStats.js).
  const datesWithData = new Set(stored.map(d => d.fecha));
  const recentCutoff = closedDates.length > 10 ? closedDates[closedDates.length - 10] : closedDates[0];
  const botLaunch = process.env.BOT_LAUNCH_DATE || '0000-00-00';
  const missingDates = closedDates.filter(f => !datesWithData.has(f) && f >= (recentCutoff || f) && f >= botLaunch);
  if (missingDates.length) {
    const brands = getBrands();
    const repaired = await Promise.all(
      missingDates.flatMap(fecha => brands.map(b => upsertDailyStats(b.code, fecha)))
    );
    stored.push(...repaired);
  }

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
async function getSummary(desde, hasta, mesReferencia) {
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

  // mesReferencia: el mes de la pestaña activa (o el mes en curso si es "Todo", que no tiene
  // un mes propio). Antes solo se calculaba para Todo/mes en curso; ahora cualquier mes
  // cerrado también obtiene su comparativa, mes completo contra mes completo, sin tocar GHL.
  const comparativaMensual = await computeComparativaMensual(mesReferencia);

  return { desde, hasta, marcas: perBrand, total, comparativaMensual };
}

// Compara un mes contra el mes anterior, por marca. Si mesReferencia es el mes en curso,
// compara "hasta hoy" contra "el mes anterior hasta el mismo día" (para no penalizar un mes
// a medias); si es un mes ya cerrado, compara el mes completo contra el mes anterior
// completo — ambos cerrados, así que no hace falta ninguna llamada a GHL en absoluto.
async function computeComparativaMensual(mesReferencia) {
  const brands = getBrands();
  const [anioRef, mesRef] = mesReferencia.split('-').map(Number); // mesRef: 1-12
  const esMesActual = mesReferencia === todayStr().slice(0, 7);

  const inicioMes = new Date(Date.UTC(anioRef, mesRef - 1, 1));
  const inicioMesAnterior = new Date(Date.UTC(anioRef, mesRef - 2, 1));
  const finMesAnteriorCompleto = new Date(Date.UTC(anioRef, mesRef - 1, 0));

  let hastaMes, hastaMesAnterior;
  if (esMesActual) {
    const hoy = new Date();
    hastaMes = toDateStr(hoy);
    hastaMesAnterior = toDateStr(new Date(Date.UTC(anioRef, mesRef - 2, Math.min(hoy.getUTCDate(), finMesAnteriorCompleto.getUTCDate()))));
  } else {
    hastaMes = toDateStr(new Date(Date.UTC(anioRef, mesRef, 0)));
    hastaMesAnterior = toDateStr(finMesAnteriorCompleto);
  }

  const desdeMes = toDateStr(inicioMes);
  const desdeMesAnterior = toDateStr(inicioMesAnterior);
  const ayer = new Date();
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  const hastaMesCerrado = esMesActual ? toDateStr(ayer) : hastaMes;

  const sumaConversacionCitas = docs => docs.reduce((acc, d) => ({
    conversacion: acc.conversacion + d.conversacion,
    citas: acc.citas + d.consulta_agendada,
  }), { conversacion: 0, citas: 0 });

  const marcas = await Promise.all(brands.map(async brand => {
    const [actualDocs, anteriorDocs, live] = await Promise.all([
      inicioMes <= ayer
        ? DailyStat.find({ marca: brand.code, fecha: { $gte: desdeMes, $lte: hastaMesCerrado } }).lean()
        : Promise.resolve([]),
      DailyStat.find({ marca: brand.code, fecha: { $gte: desdeMesAnterior, $lte: hastaMesAnterior } }).lean(),
      esMesActual ? getLiveTodayStats(brand) : Promise.resolve(null),
    ]);
    const actualCerrado = sumaConversacionCitas(actualDocs);
    const anterior = sumaConversacionCitas(anteriorDocs);
    const actual = esMesActual
      ? { conversacion: actualCerrado.conversacion + live.conversacion, citas: actualCerrado.citas + live.consulta_agendada }
      : actualCerrado;
    return { marca: brand.code, nombre: brand.name, actual, anterior };
  }));

  return { esMesActual, desdeActual: desdeMes, hastaActual: hastaMes, desdeAnterior: desdeMesAnterior, hastaAnterior: hastaMesAnterior, marcas };
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function mapaAObjeto(m) {
  return m instanceof Map ? Object.fromEntries(m) : (m || {});
}

// Canal de entrada por marca, sumando lo ya guardado día a día en DailyStat (nada de GHL en
// vivo salvo "hoy"). force=true refresca el día de hoy en vez de servir su caché de 3 min.
async function computeChannelBreakdown(desde, hasta, force = false) {
  const brands = getBrands();
  const perBrand = await Promise.all(brands.map(async brand => {
    const docs = await DailyStat.find({ marca: brand.code, fecha: { $gte: desde, $lte: hasta } }).lean();
    const counts = {};
    for (const tag of CANAL_TAGS) counts[tag] = 0;
    for (const d of docs) {
      const canales = mapaAObjeto(d.canales);
      for (const tag of CANAL_TAGS) counts[tag] += canales[tag] || 0;
    }
    if (hasta === todayStr()) {
      const live = await getLiveAtribucionToday(brand, force);
      for (const tag of CANAL_TAGS) counts[tag] += live.canales?.[tag] || 0;
    }
    return { marca: brand.code, nombre: brand.name, canales: counts };
  }));
  return { desde, hasta, marcas: perBrand, computedAt: new Date().toISOString() };
}

function getChannelBreakdown(desde, hasta, force = false) {
  return computeChannelBreakdown(desde, hasta, force);
}

// Timeline de citas (tag consulta_agendada) por marca, con nombre y fecha, y verificación por
// el tag `pago info` (validado a mano el 2026-07-30 en las 4 marcas principales: coincide al
// 100% con una cita/pago real, tanto si gestiona el bot como un humano). Se compone sumando
// las citas ya guardadas día a día — nada de GHL en vivo salvo "hoy".
async function computeCitasTimeline(desde, hasta, force = false) {
  const brands = getBrands();
  const perBrand = await Promise.all(brands.map(async brand => {
    const docs = await DailyStat.find({ marca: brand.code, fecha: { $gte: desde, $lte: hasta } }).lean();
    const citas = docs.flatMap(d => d.citas || []);
    if (hasta === todayStr()) {
      const live = await getLiveAtribucionToday(brand, force);
      citas.push(...(live.citas || []));
    }
    citas.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    const resumenGestion = citas.reduce((acc, c) => {
      if (c.esBot) acc.bot++; else if (c.gestionadoPor) acc.humano++; else acc.desconocido++;
      return acc;
    }, { bot: 0, humano: 0, desconocido: 0 });

    return { marca: brand.code, nombre: brand.name, citas, resumenGestion };
  }));
  return { desde, hasta, marcas: perBrand, computedAt: new Date().toISOString() };
}

function getCitasTimeline(desde, hasta, force = false) {
  return computeCitasTimeline(desde, hasta, force);
}

// Procedencia (sessionSource, incluido TikTok) y rendimiento por campaña de pago (utm
// campaign), sobre la población real del funnel. Se compone sumando lo ya guardado día a
// día — nada de GHL en vivo salvo "hoy".
async function computeAttribution(desde, hasta, force = false) {
  const brands = getBrands();
  const sessionTotals = {};
  const campanasPago = new Map(); // nombre normalizado -> { nombre, leads, cualificados, citas }
  const campanasOrganico = new Map();

  await Promise.all(brands.map(async brand => {
    const docs = await DailyStat.find({ marca: brand.code, fecha: { $gte: desde, $lte: hasta } }).lean();
    const dias = docs.map(d => ({ session_source: mapaAObjeto(d.session_source), campanas: d.campanas || [] }));
    if (hasta === todayStr()) {
      const live = await getLiveAtribucionToday(brand, force);
      dias.push({ session_source: live.session_source || {}, campanas: live.campanas || [] });
    }

    dias.forEach(({ session_source, campanas: campanasDia }) => {
      mergeMaps(sessionTotals, session_source);
      campanasDia.forEach(dc => {
        // dc.pago no existe en documentos guardados antes de la separación pago/orgánico;
        // se asume orgánico por defecto (opción más conservadora, no infla el rendimiento pagado).
        const grupo = dc.pago ? campanasPago : campanasOrganico;
        const key = normalizaCampana(dc.nombre);
        if (!grupo.has(key)) grupo.set(key, { nombre: dc.nombre, leads: 0, cualificados: 0, citas: 0 });
        const entry = grupo.get(key);
        entry.leads += dc.leads || 0;
        entry.cualificados += dc.cualificados || 0;
        entry.citas += dc.citas || 0;
      });
    });
  }));

  const porLeads = (a, b) => b.leads - a.leads;
  return {
    desde, hasta,
    sessionSource: sessionTotals,
    campanasPago: [...campanasPago.values()].sort(porLeads),
    campanasOrganico: [...campanasOrganico.values()].sort(porLeads),
    computedAt: new Date().toISOString(),
  };
}

function getAttribution(desde, hasta, force = false) {
  return computeAttribution(desde, hasta, force);
}

module.exports = {
  computeDailyStatsForBrand,
  computeAtribucionDiaria,
  upsertDailyStats,
  upsertDailyStatsAllBrands,
  getDailyTotals,
  getDetailForDate,
  getSummary,
  getChannelBreakdown,
  getCitasTimeline,
  getAttribution,
  todayStr,
};
