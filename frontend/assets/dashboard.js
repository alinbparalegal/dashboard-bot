const $ = sel => document.querySelector(sel);

// Periodo seleccionado en las pestañas (Todo/Junio/Julio/...). null = por defecto (desde el
// lanzamiento del bot hasta hoy). Se rellena la primera vez que llega la respuesta de /summary.
const state = { desde: null, hasta: null, launchDate: null, tabsBuilt: false, marca: '' };

// Combina el periodo seleccionado (y la marca, si hay una elegida en el selector) con
// parámetros extra (ej. force=true), en la misma query string.
function apiQuery(extra = {}) {
  const params = new URLSearchParams(extra);
  if (state.desde) { params.set('desde', state.desde); params.set('hasta', state.hasta); }
  if (state.marca) params.set('marca', state.marca);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// Formatea una fecha LOCAL como YYYY-MM-DD, sin pasar por toISOString() (que convierte a UTC
// y puede desfasar un día según la zona horaria).
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmt(n) {
  return new Intl.NumberFormat('es-ES').format(n || 0);
}
function pct(n) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtEUR(n) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n || 0) + ' €';
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function renderKpis(total) {
  const e0 = total.conversacion, e1 = total.etapa1_cualificado, e2 = total.etapa2_cita;
  $('#kpi-conversacion').textContent = fmt(e0);
  $('#kpi-cualificado').textContent = fmt(e1);
  $('#kpi-cualificado-sub').textContent = `${pct(e0 ? (e1 / e0 * 100) : 0)} % de conversación`;
  $('#kpi-cita').textContent = fmt(e2);
  $('#kpi-cita-sub').textContent = `${pct(e1 ? (e2 / e1 * 100) : 0)} % de cualificados · ${pct(e0 ? (e2 / e0 * 100) : 0)} % global`;
  $('#kpi-ingreso').textContent = total.ingreso_min === total.ingreso_max
    ? fmtEUR(total.ingreso_min)
    : `${fmtEUR(total.ingreso_min)}–${fmtEUR(total.ingreso_max)}`;
}

// Detalle desplegable de un KPI: por ahora solo "Conversación" tiene contenido (origen del
// lead, día de la semana y hora del día); el resto de KPIs se deja preparado para sumarse más
// adelante. Sustituye el contenido de "Últimas 10 citas" en vez de abrir un panel aparte.
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Reparto de conversaciones por día de la semana, a partir de la serie diaria ya cargada
// para el gráfico de tendencia — no pide nada nuevo al servidor.
function weekdayBreakdown(daily) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  daily.forEach(d => {
    const dow = new Date(`${d.fecha}T00:00:00`).getDay();
    counts[dow] += d.conversacion;
  });
  return WEEKDAY_ORDER.map(i => ({ label: WEEKDAY_LABELS[i], value: counts[i] }));
}

async function renderConversacionDetail() {
  const body = $('#kpi-detail-body');
  body.innerHTML = '<div class="loading">Cargando…</div>';
  try {
    const key = periodKey();
    const cachedDaily = periodBundle(key).daily;
    const cachedAttribution = periodBundle(key).attribution;
    const [attribution, daily, horasData] = await Promise.all([
      cachedAttribution ? Promise.resolve(cachedAttribution) : fetchJSON(`/api/stats/attribution${apiQuery()}`),
      cachedDaily ? Promise.resolve(cachedDaily) : fetchJSON(`/api/stats/daily${apiQuery()}`),
      fetchJSON(`/api/stats/hours${apiQuery()}`),
    ]);

    // Origen del lead: procedencia real ya calculada para "Procedencia real" (WhatsApp/
    // Instagram/Facebook cuando se identifica el canal, TikTok, y el resto de sessionSource
    // de GHL — Direct traffic, Organic Search, Paid Social, Referral...).
    const origenEntries = Object.entries(attribution.sessionSource || {})
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    const totalOrigen = origenEntries.reduce((s, e) => s + e.value, 0);

    const semana = weekdayBreakdown(daily);
    const maxSemana = Math.max(...semana.map(s => s.value), 1);

    const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, value: horasData.horas?.[h] || 0 }));
    const maxHora = Math.max(...horas.map(h => h.value), 1);
    const totalHoras = horas.reduce((s, h) => s + h.value, 0);
    const picoHora = horas.reduce((max, h) => (h.value > max.value ? h : max), horas[0]);
    const rango = daily.length ? `${daily[0].fecha} – ${daily[daily.length - 1].fecha}` : '';

    body.innerHTML = `
      ${rango ? `<p class="kd-scope-note">Día de la semana y hora: acumulado de todo el periodo (<b>${rango}</b>), no la evolución día a día.</p>` : ''}
      <div class="kpi-detail-grid">
        <div class="kpi-detail-col">
          <h4>Origen del lead</h4>
          ${totalOrigen ? origenEntries.map(e => `
            <div class="kd-row">
              <span class="kd-name">${e.label}</span>
              <div class="kd-track"><div class="kd-fill" style="width:${(e.value / totalOrigen * 100).toFixed(1)}%"></div></div>
              <span class="kd-num">${fmt(e.value)}</span>
              <span class="kd-pct">${pct(e.value / totalOrigen * 100)} %</span>
            </div>`).join('') : '<p class="bd-empty">Sin datos</p>'}
        </div>
        <div class="kpi-detail-col">
          <h4>Día de la semana</h4>
          <div class="kd-week">
            ${semana.map(s => `
              <div class="kd-week-bar">
                <div class="kd-week-track"><div class="kd-week-fill" style="height:${maxSemana ? (s.value / maxSemana * 100).toFixed(1) : 0}%"></div></div>
                <span class="kd-week-label">${s.label}</span>
                <span class="kd-week-num">${fmt(s.value)}</span>
              </div>`).join('')}
          </div>
        </div>
        <div class="kpi-detail-col kpi-detail-col-wide">
          <h4>Hora con más contactos</h4>
          ${totalHoras ? `
            <div class="kd-hours">
              ${horas.map(h => `
                <div class="kd-hour-bar ${h.hora === picoHora.hora ? 'peak' : ''}">
                  <div class="kd-hour-fill" style="height:${(h.value / maxHora * 100).toFixed(1)}%" title="${String(h.hora).padStart(2, '0')}:00 &ndash; ${fmt(h.value)}"></div>
                </div>`).join('')}
            </div>
            <div class="kd-hours-axis"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span></div>
            <p class="kd-hours-peak">Pico: <b>${String(picoHora.hora).padStart(2, '0')}:00–${String((picoHora.hora + 1) % 24).padStart(2, '0')}:00</b> &middot; ${fmt(picoHora.value)} contactos</p>
          ` : '<p class="bd-empty">Sin datos por hora todavía para este periodo (se calcula desde ahora en adelante)</p>'}
        </div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

// Suma un objeto {clave: cantidad} dentro de otro (acumulador), tal cual llegan
// motivos_descarte/tramites_potencial ya serializados por marca en /api/stats/summary.
function mergeCounts(target, source) {
  Object.entries(source || {}).forEach(([k, v]) => { target[k] = (target[k] || 0) + v; });
}

// Barra proporcional de N segmentos + leyenda (Cualificado/En proceso/No cualificado,
// verificación de citas...) — común a varios paneles de detalle de KPI.
function renderSplitBar(segmentos) {
  const total = segmentos.reduce((s, e) => s + e.value, 0);
  return `
    <div class="kd-split-track">
      ${segmentos.filter(s => s.value > 0).map(s => `
        <div class="kd-split-seg" style="width:${(total ? s.value / total * 100 : 0).toFixed(2)}%;background:${s.color}"
          title="${s.label}: ${fmt(s.value)} (${total ? pct(s.value / total * 100) : '0,0'} %)"></div>`).join('')}
    </div>
    <div class="donut-legend kd-split-legend">
      ${segmentos.map(s => `
        <div class="dl-row">
          <span class="dl-swatch" style="background:${s.color}"></span>
          <span class="dl-name">${s.label}</span>
          <span class="dl-value">${fmt(s.value)}</span>
          <span class="dl-pct">${total ? pct(s.value / total * 100) : '0,0'} %</span>
        </div>`).join('')}
    </div>`;
}

function renderCualificadoDetail() {
  const body = $('#kpi-detail-body');
  const summary = periodBundle(periodKey()).summary;
  if (!summary) { body.innerHTML = '<div class="loading">Cargando…</div>'; return; }

  const totals = { cualificado: 0, enProceso: 0, noCualificado: 0 };
  const motivos = {};
  summary.marcas.forEach(b => {
    totals.cualificado += b.etapa1_cualificado;
    totals.enProceso += b.lead_cualificando;
    totals.noCualificado += b.lead_no_potencial;
    mergeCounts(motivos, b.motivos_descarte);
  });
  const motivosEntries = topEntries(motivos);

  // El trámite de interés de los que sí cualifican vive solo en "Análisis detallado" por
  // marca (sección Marcas) — repetirlo aquí, agregado y sin ese contexto, duplicaba el
  // mismo dato en dos sitios sin aportar nada nuevo.
  body.innerHTML = `
    ${renderSplitBar([
      { label: 'Cualificado', value: totals.cualificado, color: 'var(--good)' },
      { label: 'En proceso', value: totals.enProceso, color: 'var(--ink-faint)' },
      { label: 'No cualificado', value: totals.noCualificado, color: 'var(--warn)' },
    ])}
    <h4>Motivo de descarte <span class="detail-total">${fmt(totals.noCualificado)} leads</span></h4>
    ${motivosEntries.length ? renderBreakdownRows(motivosEntries, totals.noCualificado, labelMotivo) : '<p class="bd-empty">Sin datos</p>'}`;
}

async function renderCitaDetail() {
  const body = $('#kpi-detail-body');
  body.innerHTML = '<div class="loading">Cargando…</div>';
  try {
    const key = periodKey();
    const cachedTimeline = periodBundle(key).timeline;
    const timeline = cachedTimeline || await fetchJSON(`/api/stats/timeline${apiQuery()}`);
    const r = timeline.resumen || { fiable: 0, humano: 0, sinVerificar: 0, sinFechaPago: 0 };

    body.innerHTML = `
      ${renderSplitBar([
        { label: 'Verificada', value: r.fiable, color: 'var(--good)' },
        { label: 'Gestión humana', value: r.humano, color: 'var(--cat5)' },
        { label: 'Sin pago info', value: r.sinVerificar, color: 'var(--warn)' },
        { label: 'Sin fecha de pago', value: r.sinFechaPago, color: 'var(--cat7)' },
      ])}
      <p class="detail-intro">De todas las citas agendadas (tag consulta_agendada), solo las
        "Verificada" cuentan como cita real en KPIs e ingreso estimado — gestionadas por el bot,
        con el tag "pago info" y la fecha de pago ya rellena.</p>`;
  } catch (e) {
    body.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

const KPI_DETAIL_RENDERERS = { conversacion: renderConversacionDetail, cualificado: renderCualificadoDetail, cita: renderCitaDetail };
const KPI_DETAIL_TITLES = { conversacion: 'Conversación — patrones', cualificado: 'Cualificado — quién y por qué', cita: 'Cita — por qué cuenta o no' };

function closeKpiDetail() {
  $('#citas-pane-kpi').hidden = true;
  $('#citas-pane-default').hidden = false;
  document.querySelectorAll('.kpi-clickable.active').forEach(k => { k.classList.remove('active'); k.setAttribute('aria-expanded', 'false'); });
}

function wireKpiToggles() {
  $('#kpi-detail-close')?.addEventListener('click', closeKpiDetail);
  document.querySelectorAll('.kpi-clickable').forEach(kpi => {
    const render = KPI_DETAIL_RENDERERS[kpi.dataset.kpi];
    if (!render) return;
    kpi.addEventListener('click', () => {
      if (kpi.classList.contains('active')) { closeKpiDetail(); return; }
      closeKpiDetail();
      kpi.classList.add('active');
      kpi.setAttribute('aria-expanded', 'true');
      $('#citas-pane-default').hidden = true;
      $('#citas-pane-kpi').hidden = false;
      $('#kpi-detail-title').textContent = KPI_DETAIL_TITLES[kpi.dataset.kpi] || 'Patrones';
      render();
    });
    kpi.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpi.click(); } });
  });
}

// Etiquetas legibles para los tags técnicos del bot, pensadas para gente no técnica.
const TRAMITE_LABELS = {
  trabajo_cuenta_ajena: 'Trabajo por cuenta ajena',
  arraigos: 'Arraigo',
  profesional_altamente_cualificado: 'Profesional altamente cualificado',
  nomada_digital: 'Nómada digital',
  familiar: 'Reagrupación familiar (UE)',
  familiar_comunitario: 'Familiar comunitario',
  no_lucrativa: 'Residencia no lucrativa',
  residencia_de_emprendedor: 'Emprendedor',
  visa_de_estudios: 'Visado de estudios',
  visa_estudios: 'Visado de estudios',
  residencia_cuenta_propia_inicial: 'Autónomo (inicial)',
  reagrupacion_familiar: 'Reagrupación familiar',
  nacionalizacion: 'Nacionalización',
  homologacion_titulo: 'Homologación de título',
  equivalencia_titulo: 'Equivalencia de título',
  cualificacion_general: 'Cualificación general',
  visa_turismo: 'Visado de turismo',
  mi_negocio: 'Constitución de empresa',
  acompanamiento: 'Acompañamiento al negocio',
};

const MOTIVO_LABELS = {
  info_pasaporte_no: 'No tiene pasaporte válido',
  info_capital_no: 'No cumple el capital requerido',
  info_antecedentes_no: 'Tiene antecedentes penales',
  info_estancia_no: 'No cumple el tiempo de estancia',
  info_capital_30_no: 'No cumple el 30 % de capital',
  info_apostillado_no: 'Documentos sin apostillar',
  info_documentacion_no: 'Documentación incompleta',
};

function humanize(key) {
  return key.replace(/^tramite_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
function labelTramite(key) {
  return TRAMITE_LABELS[key.replace(/^tramite_/, '')] || humanize(key);
}
function labelMotivo(key) {
  return MOTIVO_LABELS[key] || humanize(key);
}

function topEntries(map) {
  return Object.entries(map || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

function renderBreakdownRows(entries, total, labelFn) {
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return entries.map(([key, v]) => `
    <div class="breakdown-row">
      <span class="bd-label" title="${key}">${labelFn(key)}</span>
      <div class="bar-track bd-track"><div class="bar-fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div>
      <span class="bd-value">${fmt(v)}</span>
      <span class="bd-pct">${total ? pct(v / total * 100) : '0,0'} %</span>
    </div>`).join('');
}

// Icono + color por marca — solo para distinguir de un vistazo la fila compacta, sin relación
// con los colores semánticos (verde=bien, ámbar=aviso) que ya usan otras partes del dashboard.
const BRAND_ICON = { CYA: '&#9878;&#65039;', ETH: '&#127891;', ETV: '&#9992;&#65039;', NAC: '&#129706;', MNEE: '&#127970;' };
const BRAND_COLOR = { CYA: 'var(--accent)', ETH: 'var(--cat4)', ETV: 'var(--cat5)', NAC: 'var(--cat6)', MNEE: 'var(--cat7)' };

// Columna compacta de una marca (icono + código como título + funnel + tasa global), con dos
// accesos — "Análisis" y "Citas" — que abren su contenido en el mismo panel a todo el ancho
// (brand-detail-full) debajo de la fila, en vez de aplastarlo en 1/5 del ancho. El botón de
// citas se añade aparte (ver aplicarBotonesCitas) porque esos datos llegan en una pieza
// distinta y más lenta que el resumen de marca.
function renderBrandColumn(b) {
  const e0 = b.conversacion, e1 = b.etapa1_cualificado, e2 = b.etapa2_cita;
  const r01 = e0 ? pct(e1 / e0 * 100) : '0,0';
  const r12 = e1 ? pct(e2 / e1 * 100) : '0,0';

  return `
  <article class="brand-col" data-marca="${b.marca}">
    <div class="brand-head">
      <div class="bc-icon" style="background:${BRAND_COLOR[b.marca] || 'var(--accent)'}">${BRAND_ICON[b.marca] || ''}</div>
      <h2 class="bc-code-title" title="${b.nombre}">${b.marca}</h2>
    </div>
    <div class="funnel">
      <div class="step">
        <span class="stage-label">Conversación</span>
        <span class="stage-count">${fmt(e0)}</span>
      </div>
      <div class="step">
        <span class="stage-label">Cualificado</span>
        <span class="stage-count">${fmt(e1)}</span>
        <span class="stage-rate">${r01} %</span>
      </div>
      <div class="step">
        <span class="stage-label">Cita</span>
        <span class="stage-count">${fmt(e2)}</span>
        <span class="stage-rate">${r12} %</span>
      </div>
    </div>
    <div class="overall"><b>${b.ingreso_min === b.ingreso_max ? fmtEUR(b.ingreso_min) : `${fmtEUR(b.ingreso_min)}–${fmtEUR(b.ingreso_max)}`}</b></div>
    <div class="brand-col-actions">
      <button type="button" class="brand-detail-toggle brand-citas-toggle" data-marca="${b.marca}" data-tipo="citas" hidden>Citas</button>
      <button type="button" class="brand-detail-toggle" data-marca="${b.marca}" data-tipo="analisis">Análisis</button>
    </div>
  </article>`;
}

function renderBrandDetailContent(b) {
  const motivos = topEntries(b.motivos_descarte);
  const tramites = topEntries(b.tramites_potencial);
  const overall = b.conversacion ? pct(b.etapa2_cita / b.conversacion * 100) : '0,0';
  return `
    <div class="brand-detail-head">
      <div class="bc-icon" style="background:${BRAND_COLOR[b.marca] || 'var(--accent)'}">${BRAND_ICON[b.marca] || ''}</div>
      <h3>Análisis detallado &mdash; ${b.nombre}</h3>
      <span class="detail-total">bot&rarr;cita <b>${overall} %</b></span>
      <button type="button" class="brand-detail-close" aria-label="Cerrar">&times;</button>
    </div>
    <p class="detail-intro">De los leads que calificaron, en qué trámite están interesados — y de los que se descartaron, por qué motivo.</p>
    <div class="detail-grid">
      <div class="detail-col">
        <h3>¿Qué trámite quieren? <span class="detail-total">${fmt(b.lead_potencial)} leads</span></h3>
        ${tramites.length ? renderBreakdownRows(tramites, b.lead_potencial, labelTramite) : '<p class="bd-empty">Sin datos</p>'}
      </div>
      <div class="detail-col">
        <h3>¿Por qué se descartaron? <span class="detail-total">${fmt(b.lead_no_potencial)} leads</span></h3>
        ${motivos.length ? renderBreakdownRows(motivos, b.lead_no_potencial, labelMotivo) : '<p class="bd-empty">Sin datos</p>'}
      </div>
    </div>
    <div class="detail-extra">De ellos, llegaron por un anuncio de Meta (Facebook/Instagram Ads): <b>${fmt(b.meta_ads_potencial)}</b> leads cualificados</div>`;
}

// Marcas de la última carga de cada pieza, para poder abrir su detalle sin volver a pedir nada.
let brandsPorCodigo = {};
let timelinePorCodigo = {};

function renderBrands(marcas) {
  brandsPorCodigo = Object.fromEntries(marcas.map(b => [b.marca, b]));
  $('#brands').innerHTML = marcas.map(renderBrandColumn).join('');
  $('#brand-detail-full').hidden = true;
  $('#brands').querySelectorAll('.brand-detail-toggle').forEach(btn => {
    btn.addEventListener('click', () => openBrandDetail(btn.dataset.marca, btn.dataset.tipo));
  });
  aplicarBotonesCitas(); // por si el timeline ya había llegado antes que el resumen
}

// El botón "Citas" no existe hasta que se sabe cuántas hay (pieza aparte, más lenta) — se
// añade/actualiza sobre las columnas ya pintadas en vez de repintar la fila entera.
function aplicarBotonesCitas() {
  Object.values(timelinePorCodigo).forEach(m => {
    const btn = document.querySelector(`.brand-col[data-marca="${m.marca}"] .brand-citas-toggle`);
    if (!btn) return;
    btn.hidden = !m.citas.length;
    btn.textContent = `Citas (${fmt(m.citas.length)})`;
  });
}

function marcarBotonActivo(marca, tipo) {
  $('#brands').querySelectorAll('.brand-detail-toggle.active').forEach(b => b.classList.remove('active'));
  if (!marca) return;
  document.querySelector(`.brand-detail-toggle[data-marca="${marca}"][data-tipo="${tipo}"]`)?.classList.add('active');
}

function openBrandDetail(marca, tipo) {
  const panel = $('#brand-detail-full');
  const datos = tipo === 'citas' ? timelinePorCodigo[marca] : brandsPorCodigo[marca];
  if (!datos) return;
  const yaAbierto = !panel.hidden && panel.dataset.marca === marca && panel.dataset.tipo === tipo;
  if (yaAbierto) { panel.hidden = true; marcarBotonActivo(null); return; }
  panel.dataset.marca = marca;
  panel.dataset.tipo = tipo;
  panel.innerHTML = tipo === 'citas' ? renderTimelineDetailContent(datos) : renderBrandDetailContent(datos);
  panel.hidden = false;
  marcarBotonActivo(marca, tipo);
  panel.querySelector('.brand-detail-close')?.addEventListener('click', () => { panel.hidden = true; });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Evolución de cada marca frente al mismo punto del mes anterior: barra divergente centrada
// en 0% (igual que el mes pasado) — crecer es a la derecha (verde), caer a la izquierda
// (ámbar). El % de cambio sí es comparable entre marcas de cualquier tamaño, a diferencia de
// una barra de volumen (donde una marca pequeña siempre parece invisible junto a una
// grande). Solo tiene datos en "Todo" y el mes en curso — un mes cerrado del pasado no tiene
// un "hoy" con el que compararse.
function renderBrandCompare(comparativaMensual) {
  if (!comparativaMensual) {
    $('#brand-compare').innerHTML = '<p class="bd-empty">Sin datos de comparativa para este periodo.</p>';
    return;
  }
  const deltas = comparativaMensual.marcas.map(m => {
    const prev = m.anterior.conversacion;
    const now = m.actual.conversacion;
    const delta = prev > 0 ? ((now - prev) / prev * 100) : (now > 0 ? 100 : 0);
    return { marca: m.marca, delta };
  });
  const maxAbs = Math.max(...deltas.map(d => Math.abs(d.delta)), 1);

  $('#brand-compare').innerHTML = deltas.map(({ marca, delta }) => {
    const supera = delta >= 0;
    const width = (Math.abs(delta) / maxAbs * 50).toFixed(1); // hasta el 50% del ancho a cada lado del centro
    return `
    <div class="evo-row">
      <span class="evo-name">${marca}</span>
      <div class="evo-bar">
        <div class="evo-zero"></div>
        <div class="evo-fill ${supera ? 'up' : 'down'}" style="width:${width}%"></div>
      </div>
      <span class="evo-delta ${supera ? 'up' : 'down'}">${supera ? '▲' : '▼'}${pct(Math.abs(delta))}%</span>
    </div>`;
  }).join('');
}

// Citas por marca: una sola barra horizontal repartida proporcionalmente entre las 5
// marcas (cada segmento = su cuota de citas del periodo), con leyenda de cifras al lado —
// fusiona lo que antes eran dos vistas separadas (rosco de citas + comparativa de volumen).
function renderCitasBar(marcas) {
  const total = marcas.reduce((s, m) => s + m.etapa2_cita, 0);
  const segs = marcas.filter(m => m.etapa2_cita > 0).map(m => `
    <div class="citas-bar-seg" style="width:${(total ? m.etapa2_cita / total * 100 : 0).toFixed(2)}%;background:${BRAND_COLOR[m.marca] || 'var(--accent)'}">
      <title>${m.marca}: ${fmt(m.etapa2_cita)} (${total ? pct(m.etapa2_cita / total * 100) : '0,0'} %)</title>
    </div>`).join('');
  const legend = marcas.map(m => `
    <div class="dl-row">
      <span class="dl-swatch" style="background:${BRAND_COLOR[m.marca] || 'var(--accent)'}"></span>
      <span class="dl-name">${m.marca}</span>
      <span class="dl-value">${fmt(m.etapa2_cita)}</span>
      <span class="dl-pct">${total ? pct(m.etapa2_cita / total * 100) : '0,0'} %</span>
    </div>`).join('');
  $('#citas-bar').innerHTML = `
    <div class="citas-bar-track">${segs}</div>
    <div class="donut-legend">${legend}</div>`;
}

// Fusiona el heatmap "Leads tratados" con la tendencia: los puntos de la serie de
// conversación llevan el mismo color por intensidad que antes tenían las celdas del
// heatmap (ver colorForIntensity) y son clicables para el detalle del día — así un solo
// gráfico hace las dos cosas en vez de repetir el eje de fechas en dos sitios.
function buildTrendSvg(daily) {
  const W = 700, H = 220, padL = 4, padR = 4, padT = 10, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxV = Math.max(...daily.map(d => d.conversacion), 1);
  const n = daily.length;
  const slot = n === 1 ? innerW : innerW / n;
  const barW = Math.max(1.5, slot * 0.62);
  const x = i => padL + (n === 1 ? innerW / 2 : slot * (i + 0.5));
  const y = v => padT + innerH - (v / maxV) * innerH;
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400000));

  function pathFor(key) {
    return daily.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  }
  function pointsFor(key, color) {
    return daily.map((d, i) => `<circle class="series-point" cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.2" stroke="${color}"><title>${d.fecha}: ${fmt(d[key])}</title></circle>`).join('');
  }
  // "Leads tratados" en barras (antes puntos de línea): la altura marca la conversación del
  // día y el color su intensidad relativa al máximo del periodo (mismo criterio que tenía el
  // heatmap al que sustituyen) — y una barra es un blanco mucho más fácil de pinchar que un
  // punto de 5px, sobre todo con muchos días apretados en el mismo ancho.
  function conversacionBars(color) {
    return daily.map((d, i) => {
      const marcado = d.fecha === today || d.fecha === yesterday;
      const barY = y(d.conversacion);
      return `<rect class="series-bar-conv" data-fecha="${d.fecha}" x="${(x(i) - barW / 2).toFixed(1)}" y="${barY.toFixed(1)}"
        width="${barW.toFixed(1)}" height="${Math.max(0, padT + innerH - barY).toFixed(1)}" rx="2"
        fill="${colorForIntensity(d.conversacion, maxV)}" stroke="${marcado ? color : 'transparent'}" stroke-width="1.4">
        <title>${d.fecha}: ${fmt(d.conversacion)} — clic para el detalle</title>
      </rect>`;
    }).join('');
  }

  const gridLines = [0, 0.5, 1].map(t => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${(padT + innerH * (1 - t)).toFixed(1)}" y2="${(padT + innerH * (1 - t)).toFixed(1)}" />`).join('');

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6f6c';
  const good = getComputedStyle(document.documentElement).getPropertyValue('--good').trim() || '#3f7d52';
  const warn = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || '#a8752a';

  const firstLabel = daily[0]?.fecha ?? '';
  const lastLabel = daily[n - 1]?.fecha ?? '';

  return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${gridLines}
    ${conversacionBars(accent)}
    <path class="series-line" d="${pathFor('cualificado')}" stroke="${good}" />
    <path class="series-line" d="${pathFor('cita')}" stroke="${warn}" />
    ${pointsFor('cualificado', good)}
    ${pointsFor('cita', warn)}
    <text class="axis-label" x="${padL}" y="${H - 4}">${firstLabel}</text>
    <text class="axis-label" x="${W - padR}" y="${H - 4}" text-anchor="end">${lastLabel}</text>
  </svg>`;
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    accent: v('--accent', '#2f6f6c'),
    good: v('--good', '#3f7d52'),
    warn: v('--warn', '#a8752a'),
    cat4: v('--cat4', '#6a6bb0'),
    cat5: v('--cat5', '#b0577a'),
    cat6: v('--cat6', '#4d7ea8'),
    cat7: v('--cat7', '#8a6a35'),
    ink: v('--ink', '#20261f'),
    faint: v('--surface-alt', '#eee'),
  };
}

// Rosco genérico: entries = [{label, value, color}], centro con el total.
function buildDonutSvg(entries, totalLabel) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  const R = 60, CX = 75, CY = 75, STROKE = 22;
  const circumference = 2 * Math.PI * R;
  let offset = 0;
  const arcs = entries.filter(e => e.value > 0).map(e => {
    const frac = total ? e.value / total : 0;
    const dash = frac * circumference;
    const circle = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${e.color}" stroke-width="${STROKE}"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${CX} ${CY})">
      <title>${e.label}: ${fmt(e.value)} (${pct(frac * 100)} %)</title>
    </circle>`;
    offset += dash;
    return circle;
  }).join('');

  return `
  <svg viewBox="0 0 150 150">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--surface-alt)" stroke-width="${STROKE}" />
    ${arcs}
    <text x="${CX}" y="${CY - 3}" text-anchor="middle" class="donut-center-value">${fmt(total)}</text>
    <text x="${CX}" y="${CY + 13}" text-anchor="middle" class="donut-center-label">${totalLabel}</text>
  </svg>`;
}

function renderDonut(containerId, entries, totalLabel) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  const legend = entries.map(e => `
    <div class="dl-row">
      <span class="dl-swatch" style="background:${e.color}"></span>
      <span class="dl-name">${e.label}</span>
      <span class="dl-value">${fmt(e.value)}</span>
      <span class="dl-pct">${total ? pct(e.value / total * 100) : '0,0'} %</span>
    </div>`).join('');

  $(containerId).innerHTML = `
    <div class="donut-wrap">
      ${buildDonutSvg(entries, totalLabel)}
      <div class="donut-legend">${legend}</div>
    </div>`;
}

function monthName(m) {
  return ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][m];
}

function updateHeatmapTitles(tabLabel) {
  const suffix = tabLabel === 'Todo' ? 'últimos 30 días' : tabLabel;
  $('#trend-title').textContent = `Leads tratados — tendencia · ${suffix}`;
}

function buildPeriodTabs(launchDate) {
  if (state.tabsBuilt) return;
  state.tabsBuilt = true;
  state.launchDate = launchDate;

  const today = new Date();
  const start = new Date(launchDate + 'T00:00:00');
  const months = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= today) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const tabs = [{ label: 'Todo', desde: null, hasta: null }];
  months.forEach(({ year, month }) => {
    const desde = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0);
    const hastaDate = lastDay < today ? lastDay : today;
    const hasta = toDateStr(hastaDate);
    tabs.push({ label: monthName(month), desde, hasta });
  });

  $('#period-tabs').innerHTML = tabs.map((t, i) => `
    <button class="period-tab${i === 0 ? ' active' : ''}" data-desde="${t.desde || ''}" data-hasta="${t.hasta || ''}">${t.label}</button>
  `).join('');

  // Cambiar de pestaña ya no depende de haberla actualizado antes: canales/timeline/
  // atribución se componen sumando lo guardado día a día en Mongo (barato, sin GHL en vivo
  // salvo "hoy"), así que se puede pedir el periodo al vuelo. Si ya había una versión en
  // caché se muestra al instante (cero lag) mientras se refresca en segundo plano.
  $('#period-tabs').querySelectorAll('.period-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.desde = btn.dataset.desde || null;
      state.hasta = btn.dataset.hasta || null;
      $('#period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateHeatmapTitles(btn.textContent);
      store.activeTab = periodKey();
      saveStore(store);
      const cached = store.periods[periodKey()];
      if (cached) renderBundle(cached); else renderPlaceholder();
      loadPeriod();
    });
  });
}

function colorForIntensity(v, max) {
  if (!max || v === 0) return 'var(--surface-alt)';
  const t = Math.min(1, v / max);
  // interpolación simple hacia el acento
  const alpha = 0.15 + t * 0.85;
  return `color-mix(in srgb, var(--accent) ${Math.round(alpha * 100)}%, var(--surface-alt))`;
}

function renderHeatmapAndTrend(daily) {
  $('#trend-chart').innerHTML = buildTrendSvg(daily);
  $('#trend-chart').querySelectorAll('.series-bar-conv').forEach(bar => {
    bar.addEventListener('click', () => showDayDetail(bar.dataset.fecha));
  });
}

// Detalle de un día concreto del heatmap: se pide en el momento (acción explícita del
// usuario al hacer clic), no forma parte del ciclo de "Actualizar datos". Los días ya
// cerrados se leen de Mongo (gratis); solo "hoy" toca GHL.
async function showDayDetail(fecha) {
  const panel = $('#day-detail');
  panel.classList.add('open');
  panel.innerHTML = `<div class="loading">Cargando ${fecha}…</div>`;
  try {
    const rows = await fetchJSON(`/api/stats/daily/${fecha}`);
    panel.innerHTML = `
      <h3 style="font-size:14px;margin-bottom:8px;">Detalle — ${fecha}</h3>
      <table>
        <thead><tr><th>Marca</th><th>Conversación</th><th>Cualificado</th><th>Cita</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${r.marca}</td>
            <td>${fmt(r.conversacion)}</td>
            <td>${fmt(r.lead_potencial + r.pago_pendiente + r.consulta_agendada + r.cliente_postventa)}</td>
            <td>${fmt(r.citas_fiables || 0)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    panel.innerHTML = `<div class="loading">Error cargando ${fecha}: ${e.message}</div>`;
  }
}

function fmtHora(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function fmtFecha(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Iniciales + color de avatar (determinista por nombre) para las filas de citas.
const AVATAR_COLORS = ['var(--accent)', 'var(--good)', 'var(--cat4)', 'var(--cat5)', 'var(--cat6)', 'var(--warn)'];
function iniciales(nombre) {
  const partes = (nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase();
}
function colorAvatar(nombre) {
  let hash = 0;
  for (const ch of nombre || '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
// Insignia de estado de una cita: fiable (BOT + pago info + fecha de pago) es la confirmación
// fuerte; si no, se dice cuál de las tres condiciones falta en vez de un "no verificada" genérico.
function badgeCita(c) {
  if (c.fiable) return '<span class="badge ok">&#10003; verificada</span>';
  if (!c.esBot) return '<span class="badge warn">gestión humana</span>';
  if (!c.verificado) return '<span class="badge warn">sin pago info</span>';
  return '<span class="badge warn">sin fecha de pago</span>';
}

// Solo se cuentan las citas fiables (BOT + pago info + fecha de pago); las escaladas a un
// humano no cuentan como "cita" aquí, igual que en el resto del dashboard.
function renderTimelineDetailContent(m) {
  const rows = m.citas.map(c => `
    <div class="timeline-row">
      <div class="avatar" style="background:${colorAvatar(c.nombre)}">${iniciales(c.nombre)}</div>
      <div class="tl-body">
        <div class="tl-nombre">${c.nombre}</div>
        <div class="tl-gestion">gestionada por el bot</div>
      </div>
      <div class="tl-trailing">
        <span class="tl-fecha">${fmtFecha(c.fecha)}</span>
        ${badgeCita(c)}
      </div>
    </div>`).join('');
  return `
    <div class="brand-detail-head">
      <div class="bc-icon" style="background:${BRAND_COLOR[m.marca] || 'var(--accent)'}">${BRAND_ICON[m.marca] || ''}</div>
      <h3>${m.nombre} <span class="tl-count">${m.citas.length} citas</span></h3>
      <button type="button" class="brand-detail-close" aria-label="Cerrar">&times;</button>
    </div>
    <div class="timeline-rows">${rows}</div>`;
}

// El timeline ya no pinta su propia fila: solo guarda los datos y activa el botón "Citas" de
// cada columna de marca (ver aplicarBotonesCitas), que abre este mismo contenido en el panel
// compartido brand-detail-full (ver openBrandDetail).
function renderTimeline(marcas) {
  timelinePorCodigo = Object.fromEntries(marcas.map(m => [m.marca, m]));
  aplicarBotonesCitas();
}

// Fila de una cita (avatar + nombre + marca/gestión + fecha/insignia) — compartida entre
// "Últimas 10 citas" (Resumen, solo un vistazo) y la lista completa de la sección Citas.
function citaRowHtml(c) {
  return `
    <div class="lc-row">
      <div class="avatar" style="background:${colorAvatar(c.nombre)}">${iniciales(c.nombre)}</div>
      <div class="lc-body">
        <div class="lc-nombre">${c.nombre}</div>
        <div class="lc-meta">${c.marca} &middot; ${c.esBot ? 'gestionada por el bot' : `gestionada por ${c.gestionadoPor || 'humano'}`}</div>
      </div>
      <div class="lc-trailing">
        <span class="lc-fecha">${fmtFecha(c.fecha)}</span>
        ${badgeCita(c)}
      </div>
    </div>`;
}

function todasLasCitas(marcas) {
  const todas = marcas.flatMap(m => m.citas.map(c => ({ ...c, marca: m.marca })));
  todas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  return todas;
}

function renderUltimasCitas(marcas) {
  const ultimas = todasLasCitas(marcas).slice(0, 10);
  $('#ultimas-citas').innerHTML = ultimas.length
    ? ultimas.map(citaRowHtml).join('')
    : '<p class="bd-empty">Sin citas todavía.</p>';
}

// Sección "Citas": todas las fiables del periodo/marca filtrados, no solo las últimas 10 —
// para tenerlas todas a la vista en un sitio sin entrar marca por marca.
function renderCitasLista(marcas) {
  const todas = todasLasCitas(marcas);
  $('#citas-lista-count').textContent = `${fmt(todas.length)} citas`;
  $('#citas-lista').innerHTML = todas.length
    ? todas.map(citaRowHtml).join('')
    : '<p class="bd-empty">Sin citas todavía para este periodo.</p>';
}

function renderCampanasGrupo(titulo, campanas) {
  if (!campanas.length) return `<h4 class="cp-subtitulo">${titulo}</h4><p class="bd-empty">Sin campañas en este periodo.</p>`;
  const rows = campanas.slice(0, 15).map(c => {
    const tasa = c.leads ? (c.citas / c.leads * 100) : 0;
    return `
    <div class="campana-row">
      <span class="cp-nombre" title="${c.nombre}">${c.nombre}</span>
      <span class="cp-num">${fmt(c.leads)}</span>
      <span class="cp-num">${fmt(c.cualificados)}</span>
      <span class="cp-num">${fmt(c.citas)}</span>
      <span class="cp-tasa${c.citas === 0 ? ' cero' : ''}">${pct(tasa)} %</span>
    </div>`;
  }).join('');
  return `
    <h4 class="cp-subtitulo">${titulo}</h4>
    <div class="campana-head"><span>Campaña</span><span>Leads</span><span>Cualif.</span><span>Citas</span><span>Tasa</span></div>
    ${rows}`;
}

function renderCampanasTable(campanasPago = [], campanasOrganico = []) {
  if (!campanasPago.length && !campanasOrganico.length) {
    $('#tabla-campanas').innerHTML = '<p class="bd-empty">Sin campañas con UTM en este periodo.</p>';
    return;
  }
  $('#tabla-campanas').innerHTML =
    renderCampanasGrupo('De pago (Paid Social)', campanasPago) +
    renderCampanasGrupo('Orgánico con UTM', campanasOrganico);
}

// "Rendimiento por campaña" sigue el periodo global (misma pieza de siempre); "Procedencia
// real" tiene su propio periodo (ver loadProcedencia) — de ahí que ya no compartan una sola
// función de render, aunque los dos consuman /api/stats/attribution.
function renderAttribution(data) {
  renderCampanasTable(data.campanasPago, data.campanasOrganico);
}

function renderProcedenciaDonut(data) {
  $('#attribution-computed-at').textContent = data.computedAt ? `Calculado a las ${fmtHora(data.computedAt)}` : '';

  const c = themeColors();
  const palette = [c.accent, c.warn, c.good, c.cat4, c.cat5, c.cat6, c.cat7, c.ink];
  const sorted = Object.entries(data.sessionSource).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const restTotal = sorted.slice(8).reduce((s, [, v]) => s + v, 0);
  const entries = top.map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
  if (restTotal > 0) entries.push({ label: 'Otros', value: restTotal, color: c.faint });
  renderDonut('#donut-sessionsource', entries, 'leads');
}

// Periodo propio de "Procedencia real", independiente de las pestañas globales de arriba —
// para poder mirar de dónde vienen los leads a distintas escalas (30 días fijos / mes en
// curso) sin cambiar lo que se ve en el resto del dashboard. Solo respeta el filtro de marca.
const procedenciaState = { rango: 'mes' };

function procedenciaRangoFechas() {
  const hoy = new Date();
  const hasta = toDateStr(hoy);
  if (procedenciaState.rango === '30d') {
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - 29);
    return { desde: toDateStr(desde), hasta };
  }
  const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
  return { desde, hasta };
}

function procedenciaKey() {
  return `${procedenciaState.rango}_${state.marca || 'todas'}`;
}

async function loadProcedencia(force) {
  const key = procedenciaKey();
  const { desde, hasta } = procedenciaRangoFechas();
  const params = new URLSearchParams({ desde, hasta });
  if (state.marca) params.set('marca', state.marca);
  if (force) params.set('force', 'true');

  const cached = store.procedencia?.[key];
  if (cached) renderProcedenciaDonut(cached);
  else $('#donut-sessionsource').innerHTML = '<div class="loading">Cargando…</div>';

  try {
    const data = await fetchJSON(`/api/stats/attribution?${params}`);
    if (procedenciaKey() !== key) return;
    renderProcedenciaDonut(data);
    store.procedencia = { ...(store.procedencia || {}), [key]: data };
    saveStore();
  } catch (e) {
    if (procedenciaKey() === key && !cached) $('#donut-sessionsource').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

function wireProcedenciaPeriod() {
  $('#procedencia-period')?.querySelectorAll('.mini-period-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      procedenciaState.rango = btn.dataset.rango;
      $('#procedencia-period').querySelectorAll('.mini-period-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadProcedencia();
    });
  });
}

// ---------------------------------------------------------------------------------
// Almacén local: guarda el último resultado de cada periodo en localStorage para que
// cambiar de pestaña o recargar la página no pida nada nuevo a GHL — solo el botón
// "Actualizar datos" trae datos frescos, con un enfriamiento de 15 minutos.
// ---------------------------------------------------------------------------------
// v2: la forma de attribution.campanas cambió (campanasPago/campanasOrganico en vez de
// campanas) — una caché v1 en el navegador de alguien rompía renderBundle a mitad camino
// (justo antes de construir las pestañas de periodo, que por eso desaparecían).
const STORE_KEY = 'dashboardStore_v2';
const COOLDOWN_MS = 15 * 60 * 1000;

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* localStorage no disponible o corrupto: seguimos con uno vacío */ }
  return { periods: {}, lastUpdateClickAt: 0 };
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignorar */ }
}
const store = loadStore();

function periodKey() {
  const base = state.desde ? `${state.desde}_${state.hasta}` : 'todo';
  return state.marca ? `${base}_${state.marca}` : base;
}

// Las pestañas de periodo son navegación, no un dato más: no deben depender de que termine
// ninguna consulta lenta (summary/timeline/etc. pueden tardar cuando GHL va lento para "hoy").
// /launch-date no toca Mongo ni GHL, así que las pestañas aparecen siempre, pase lo que pase
// con el resto de la carga.
async function loadLaunchDateAndBuildTabs() {
  try {
    const { launchDate } = await fetchJSON('/api/stats/launch-date');
    buildPeriodTabs(launchDate);
  } catch (e) { /* endpoint propio sin dependencias externas: un fallo aquí sería el servidor caído del todo */ }
}

function periodBundle(key) {
  return store.periods[key] || {};
}

function markUpdated() {
  $('#meta-actualizado').textContent = `Actualizado a las ${fmtHora(new Date().toISOString())}`;
}

// canales/timeline/atribución ya se componen sumando lo guardado día a día en Mongo (barato,
// nada de GHL salvo "hoy"), así que cambiar de pestaña puede pedirlos sin miedo. force=true
// (solo desde "Actualizar datos") además refresca el día de hoy en vez de servir su caché de
// 3 min — de ahí el enfriamiento del botón, para no forzar esa parte en vivo sin necesidad.
//
// Cada pieza se pide y se pinta por separado (en vez de esperar a las 5 juntas): si GHL va
// lento calculando "hoy", solo la pieza que lo necesita se queda cargando — las demás (todas
// las que sean de un periodo cerrado, y hasta las de "hoy" que ya estén en Mongo) no tienen
// por qué esperar a que esa se resuelva o falle.
async function loadSummaryPiece(force) {
  const key = periodKey();
  try {
    const summary = await fetchJSON(`/api/stats/summary${apiQuery()}`);
    if (periodKey() !== key) return summary;
    renderKpis(summary.total);
    renderBrands(summary.marcas);
    renderCitasBar(summary.marcas);
    renderBrandCompare(summary.comparativaMensual);
    $('#meta-periodo').textContent = `Periodo: ${summary.desde} – ${summary.hasta}`;
    store.periods[key] = { ...periodBundle(key), summary };
    saveStore();
    markUpdated();
    return summary;
  } catch (e) {
    // Todo lo que pinta esta pieza (KPIs, roscos de citas, tarjetas, comparativa) se queda
    // igual si no se avisa aquí también — antes solo se avisaba en "#brands" y el resto
    // parecía simplemente vacío en vez de "está fallando".
    if (periodKey() === key) {
      const msg = `<div class="loading">Error: ${e.message}</div>`;
      $('#brands').innerHTML = msg;
      $('#citas-bar').innerHTML = msg;
      $('#brand-compare').innerHTML = msg;
    }
    throw e;
  }
}

async function loadDailyPiece() {
  const key = periodKey();
  try {
    const daily = await fetchJSON(`/api/stats/daily${apiQuery(state.desde ? {} : { days: '30' })}`);
    if (periodKey() !== key) return;
    renderHeatmapAndTrend(daily);
    store.periods[key] = { ...periodBundle(key), daily };
    saveStore();
  } catch (e) {
    if (periodKey() === key) $('#trend-chart').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

async function loadTimelinePiece(force) {
  const key = periodKey();
  const forceQuery = force ? { force: 'true' } : {};
  try {
    const timeline = await fetchJSON(`/api/stats/timeline${apiQuery(forceQuery)}`);
    if (periodKey() !== key) return;
    renderTimeline(timeline.marcas);
    renderUltimasCitas(timeline.marcas);
    renderCitasLista(timeline.marcas);
    store.periods[key] = { ...periodBundle(key), timeline };
    saveStore();
  } catch (e) {
    // Sin fila propia que avisar (el timeline vive dentro de las columnas de marca): los
    // botones "Citas" simplemente se quedan ocultos hasta el próximo intento.
    if (periodKey() === key) $('#ultimas-citas').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

async function loadAttributionPiece(force) {
  const key = periodKey();
  const forceQuery = force ? { force: 'true' } : {};
  try {
    const attribution = await fetchJSON(`/api/stats/attribution${apiQuery(forceQuery)}`);
    if (periodKey() !== key) return;
    renderAttribution(attribution);
    store.periods[key] = { ...periodBundle(key), attribution };
    saveStore();
  } catch (e) {
    if (periodKey() === key) $('#tabla-campanas').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

// "Procedencia real" NO se recarga aquí a propósito: tiene su propio periodo (siempre
// "hasta hoy"), así que cambiar de pestaña de periodo global no cambia nada para ella —
// recargarla en cada cambio de pestaña solo repetiría la misma llamada en vivo a GHL sin
// necesidad. Se recarga por su cuenta: al cambiar de marca, al pulsar "Actualizar datos", o
// al cambiar su propio selector 30 días/mes en curso (ver wireProcedenciaPeriod).
function loadAllPieces(force) {
  loadSummaryPiece(force).catch(() => {});
  loadDailyPiece();
  loadTimelinePiece(force);
  loadAttributionPiece(force);
}

// Carga (no forzada) el periodo actualmente seleccionado. Se usa al cambiar de pestaña: como
// ya no depende de GHL en vivo (salvo "hoy"), no hace falta esperar a "Actualizar datos" para
// ver un periodo por primera vez.
function loadPeriod() {
  loadAllPieces(false);
}

// Selector de marca: mismo patrón que las pestañas de periodo (cambia el filtro, pinta la
// caché si ya existe para esa combinación periodo+marca, y recarga en segundo plano).
function wireBrandPills() {
  $('#brand-pills')?.querySelectorAll('.brand-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.marca = btn.dataset.marca || '';
      $('#brand-pills').querySelectorAll('.brand-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cached = store.periods[periodKey()];
      if (cached) renderBundle(cached); else renderPlaceholder();
      loadPeriod();
      loadProcedencia();
    });
  });
}

// Buscador de leads: busca en vivo en GHL (nombre/teléfono/email) con un pequeño debounce
// para no disparar una petición por cada tecla. Los resultados salen en un desplegable bajo
// el buscador; al elegir uno se abre su ficha (sin salir del dashboard) con botón a GHL.
let leadSearchTimer = null;
let leadSearchResultados = [];

function wireLeadSearch() {
  const input = $('#lead-search');
  const box = $('#search-results');
  if (!input || !box) return;

  input.addEventListener('input', () => {
    clearTimeout(leadSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    leadSearchTimer = setTimeout(() => runLeadSearch(q), 350);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-search')) box.hidden = true;
  });
}

async function runLeadSearch(q) {
  const box = $('#search-results');
  box.hidden = false;
  box.innerHTML = '<div class="result-row">Buscando&hellip;</div>';
  try {
    const data = await fetchJSON(`/api/leads/search?q=${encodeURIComponent(q)}`);
    leadSearchResultados = data.resultados || [];
    if (!leadSearchResultados.length) {
      box.innerHTML = '<div class="result-row">Sin resultados</div>';
      return;
    }
    box.innerHTML = leadSearchResultados.map((r, i) => `
      <div class="result-row" data-idx="${i}">
        <div class="avatar" style="background:${colorAvatar(r.nombre)}">${iniciales(r.nombre)}</div>
        <div class="result-body">
          <div class="result-nombre">${r.nombre}</div>
          <div class="result-meta">${r.marca}${r.telefono ? ' &middot; ' + r.telefono : ''}</div>
        </div>
        <span class="result-tag">${r.etapa}</span>
      </div>`).join('');
    box.querySelectorAll('.result-row[data-idx]').forEach(row => {
      row.addEventListener('click', () => {
        showLeadCard(leadSearchResultados[Number(row.dataset.idx)]);
        box.hidden = true;
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="result-row">Error: ${e.message}</div>`;
  }
}

function showLeadCard(lead) {
  const card = $('#lead-card');
  const cita = lead.cita;
  const citaValor = !cita ? 'Sin cita' : (cita.fiable ? 'Verificada' : 'Sin verificar');
  card.innerHTML = `
    <div class="lead-head">
      <div class="lead-avatar" style="background:${colorAvatar(lead.nombre)}">${iniciales(lead.nombre)}</div>
      <div>
        <div class="lead-nombre">${lead.nombre}</div>
        <div class="lead-sub">${[lead.telefono, lead.email].filter(Boolean).join(' &middot; ') || 'Sin teléfono/email'} &middot; ${lead.marcaNombre}</div>
      </div>
      <div class="lead-actions">
        <a class="lead-ghl-btn" href="${lead.ghlUrl}" target="_blank" rel="noopener">Ver en GHL &#8599;</a>
        <button class="lead-close-btn" type="button" id="lead-card-close">Cerrar</button>
      </div>
    </div>
    <div class="lead-grid">
      <div class="lead-stat"><div class="ls-label">Etapa actual</div><div class="ls-value">${lead.etapa}</div></div>
      <div class="lead-stat"><div class="ls-label">Cita</div><div class="ls-value">${citaValor}</div></div>
      <div class="lead-stat"><div class="ls-label">Alta</div><div class="ls-value">${fmtFecha(lead.fechaAlta)}</div></div>
    </div>
    <div class="lead-tags">${lead.tags.map(t => `<span class="lead-tag${['lead_cualificando','lead_potencial','pago_pendiente','consulta_agendada','cliente_postventa','lead_no_potencial'].includes(t) ? ' estado' : ''}">${t}</span>`).join('')}</div>`;
  card.hidden = false;
  $('#lead-card-close')?.addEventListener('click', () => { card.hidden = true; });
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Pinta un bundle ya guardado en caché (recarga de página, o cambio a una pestaña ya vista).
// Tolera bundles parciales: si alguna pieza falló la última vez, sencillamente no la pinta.
function renderBundle(bundle) {
  const { summary, daily, timeline, attribution } = bundle;
  closeKpiDetail();
  if (summary) {
    renderKpis(summary.total);
    renderBrands(summary.marcas);
    renderCitasBar(summary.marcas);
    renderBrandCompare(summary.comparativaMensual);
    $('#meta-periodo').textContent = `Periodo: ${summary.desde} – ${summary.hasta}`;
  }
  if (daily) renderHeatmapAndTrend(daily);
  if (timeline) { renderTimeline(timeline.marcas); renderUltimasCitas(timeline.marcas); renderCitasLista(timeline.marcas); }
  if (attribution) renderAttribution(attribution);
}

// "Todo" y el mes en curso incluyen el día de hoy, que se calcula en vivo contra GHL para
// las 5 marcas (hasta ~70s en frío, cacheado 3 min) — sin este aviso, esa espera parece un
// cuelgue en vez de un cálculo en curso.
function periodoIncluyeHoy() {
  return !state.hasta || state.hasta === toDateStr(new Date());
}

function renderPlaceholder() {
  const msg = periodoIncluyeHoy()
    ? '<div class="loading">Calculando datos de hoy en vivo, puede tardar hasta 1 minuto…</div>'
    : '<div class="loading">Cargando…</div>';
  ['#brands', '#citas-bar', '#tabla-campanas', '#ultimas-citas', '#citas-lista', '#brand-compare']
    .forEach(sel => { $(sel).innerHTML = msg; });
  $('#citas-lista-count').textContent = '';
  $('#trend-chart').innerHTML = '';
  $('#brand-detail-full').hidden = true;
  closeKpiDetail();
  timelinePorCodigo = {};
  $('#kpi-conversacion').textContent = '—';
  $('#kpi-cualificado').textContent = '—';
  $('#kpi-cita').textContent = '—';
  $('#kpi-ingreso').textContent = '—';
  $('#meta-periodo').textContent = 'Periodo: —';
}

function cooldownRemaining() {
  return Math.max(0, COOLDOWN_MS - (Date.now() - (store.lastUpdateClickAt || 0)));
}

let cooldownTimer = null;
function tickCooldown() {
  const btn = $('#refresh-btn');
  if (!btn) return;
  const remaining = cooldownRemaining();
  if (remaining <= 0) {
    btn.disabled = false;
    btn.textContent = '↻ Actualizar datos';
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    return;
  }
  btn.disabled = true;
  const secs = Math.ceil(remaining / 1000);
  btn.textContent = `↻ Disponible en ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
function startCooldownUI() {
  tickCooldown();
  if (!cooldownTimer) cooldownTimer = setInterval(tickCooldown, 1000);
}

function updateNow() {
  if (cooldownRemaining() > 0) return;
  const btn = $('#refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Actualizando…'; }
  if (periodoIncluyeHoy()) {
    $('#brands').innerHTML = '<div class="loading">Calculando datos de hoy en vivo, puede tardar hasta 1 minuto…</div>';
  }
  // El enfriamiento protege a GHL de que se le pida recalcular "hoy" a lo loco — cuenta el
  // intento en sí, no si GHL respondió a tiempo (si contara solo el éxito, un GHL lento
  // invitaría a machacar el botón justo cuando menos conviene).
  store.lastUpdateClickAt = Date.now();
  saveStore();
  startCooldownUI();
  loadAllPieces(true);
  loadProcedencia(true);
}

// Pestañas de sección (Resumen/Marcas/Marketing): solo muestran/ocultan lo ya cargado, no
// piden nada nuevo — todas las piezas se cargan igual estén o no a la vista, así cambiar de
// sección es instantáneo.
function wireViewTabs() {
  $('#view-tabs')?.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      $('#view-tabs').querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${btn.dataset.view}`; });
      store.activeView = btn.dataset.view;
      saveStore();
    });
  });
}

function init() {
  loadLaunchDateAndBuildTabs();
  const cached = store.periods['todo'];
  if (cached && cached.summary) {
    renderBundle(cached);
    startCooldownUI();
    loadProcedencia();
  } else {
    renderPlaceholder();
    updateNow();
  }
  if (store.activeView && store.activeView !== 'resumen') {
    $(`.view-tab[data-view="${store.activeView}"]`)?.click();
  }
}

$('#refresh-btn')?.addEventListener('click', updateNow);
wireBrandPills();
wireLeadSearch();
wireViewTabs();
wireProcedenciaPeriod();
wireKpiToggles();
init();
