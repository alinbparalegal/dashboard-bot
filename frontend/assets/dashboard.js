const $ = sel => document.querySelector(sel);

// Periodo seleccionado en las pestañas (Todo/Junio/Julio/...). null = por defecto (desde el
// lanzamiento del bot hasta hoy). Se rellena la primera vez que llega la respuesta de /summary.
const state = { desde: null, hasta: null, launchDate: null, tabsBuilt: false };

// Combina el periodo seleccionado con parámetros extra (ej. force=true), en la misma query string.
function apiQuery(extra = {}) {
  const params = new URLSearchParams(extra);
  if (state.desde) { params.set('desde', state.desde); params.set('hasta', state.hasta); }
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

function sqrtScale(value, max) {
  if (!max) return 0;
  return Math.round((Math.sqrt(value) / Math.sqrt(max)) * 1000) / 10;
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

function renderBrandCard(b) {
  const e0 = b.conversacion, e1 = b.etapa1_cualificado, e2 = b.etapa2_cita;
  const w1 = sqrtScale(e1, e0), w2 = sqrtScale(e2, e0);
  const r01 = e0 ? pct(e1 / e0 * 100) : '0,0';
  const r12 = e1 ? pct(e2 / e1 * 100) : '0,0';
  const overall = e0 ? pct(e2 / e0 * 100) : '0,0';

  const motivos = topEntries(b.motivos_descarte);
  const tramites = topEntries(b.tramites_potencial);

  return `
  <article class="brand-card">
    <div class="brand-head">
      <div class="name-block">
        <h2>${b.nombre}</h2>
        <span class="code">${b.marca}</span>
      </div>
      <div class="overall">tasa global bot→cita <b>${overall} %</b> &middot; ingreso estimado <b>${b.ingreso_min === b.ingreso_max ? fmtEUR(b.ingreso_min) : `${fmtEUR(b.ingreso_min)}–${fmtEUR(b.ingreso_max)}`}</b></div>
    </div>
    <div class="funnel">
      <div class="step">
        <span class="stage-label">Conversación</span>
        <span class="stage-count">${fmt(e0)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
      </div>
      <div class="arrow-gap"><span class="rate">${r01} %</span></div>
      <div class="step">
        <span class="stage-label">Cualificado</span>
        <span class="stage-count">${fmt(e1)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${w1}%"></div></div>
      </div>
      <div class="arrow-gap"><span class="rate">${r12} %</span></div>
      <div class="step">
        <span class="stage-label">Cita</span>
        <span class="stage-count">${fmt(e2)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${w2}%"></div></div>
      </div>
    </div>

    <details class="brand-detail">
      <summary>Análisis detallado</summary>
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
      <div class="detail-extra">De ellos, llegaron por un anuncio de Meta (Facebook/Instagram Ads): <b>${fmt(b.meta_ads_potencial)}</b> leads cualificados</div>
    </details>
  </article>`;
}

function renderBrandCompare(marcas) {
  const maxConv = Math.max(...marcas.map(m => m.conversacion), 1);
  const maxRate = Math.max(...marcas.map(m => m.conversacion ? m.etapa2_cita / m.conversacion * 100 : 0), 1);
  const rows = marcas.map(m => {
    const rate = m.conversacion ? (m.etapa2_cita / m.conversacion * 100) : 0;
    return `
    <div class="compare-row">
      <span><span class="cmp-name">${m.marca}</span></span>
      <div class="compare-track"><div class="compare-fill conv" style="width:${(m.conversacion / maxConv * 100).toFixed(1)}%"></div></div>
      <span class="cmp-value">${fmt(m.conversacion)}</span>
      <div class="compare-track cmp-rate-track"><div class="compare-fill rate" style="width:${(rate / maxRate * 100).toFixed(1)}%"></div></div>
      <span class="cmp-value cmp-rate-value">${pct(rate)} %</span>
    </div>`;
  }).join('');

  $('#brand-compare').innerHTML = `
    <div class="compare-head">
      <span>Marca</span><span>Conversación</span><span></span>
      <span class="cmp-rate-label">Tasa → cita</span><span></span>
    </div>
    ${rows}`;
}

function buildTrendSvg(daily) {
  const W = 700, H = 220, padL = 4, padR = 4, padT = 10, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxV = Math.max(...daily.map(d => d.conversacion), 1);
  const n = daily.length;
  const x = i => padL + (n === 1 ? 0 : (i / (n - 1)) * innerW);
  const y = v => padT + innerH - (v / maxV) * innerH;

  function pathFor(key) {
    return daily.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  }
  function pointsFor(key, color) {
    return daily.map((d, i) => `<circle class="series-point" cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.2" stroke="${color}"><title>${d.fecha}: ${fmt(d[key])}</title></circle>`).join('');
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
    <path class="series-line" d="${pathFor('conversacion')}" stroke="${accent}" />
    <path class="series-line" d="${pathFor('cualificado')}" stroke="${good}" />
    <path class="series-line" d="${pathFor('cita')}" stroke="${warn}" />
    ${pointsFor('conversacion', accent)}
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

function loadCitasDonut(marcas) {
  const c = themeColors();
  const palette = [c.accent, c.warn, c.good, c.cat4, c.cat5];
  const entries = marcas.map((m, i) => ({ label: m.marca, value: m.etapa2_cita, color: palette[i % palette.length] }));
  renderDonut('#donut-citas', entries, 'citas');
}

async function loadChannelsDonut(totalConversacion, force = false) {
  const data = await fetchJSON(`/api/stats/channels${apiQuery(force ? { force: 'true' } : {})}`);
  const c = themeColors();
  const labels = { canal_whatsapp: 'WhatsApp', canal_instagram: 'Instagram', canal_facebook: 'Facebook' };
  const colors = { canal_whatsapp: c.good, canal_instagram: c.cat5, canal_facebook: c.accent };
  const totales = { canal_whatsapp: 0, canal_instagram: 0, canal_facebook: 0 };
  data.marcas.forEach(m => {
    Object.keys(totales).forEach(tag => { totales[tag] += m.canales[tag] || 0; });
  });
  const sumCanales = Object.values(totales).reduce((s, v) => s + v, 0);
  const sinCanal = Math.max(0, totalConversacion - sumCanales);

  const entries = [
    { label: labels.canal_whatsapp, value: totales.canal_whatsapp, color: colors.canal_whatsapp },
    { label: labels.canal_instagram, value: totales.canal_instagram, color: colors.canal_instagram },
    { label: labels.canal_facebook, value: totales.canal_facebook, color: colors.canal_facebook },
    { label: 'Sin canal registrado', value: sinCanal, color: c.faint },
  ];
  renderDonut('#donut-canal', entries, 'leads');
}

function monthName(m) {
  return ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][m];
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

  $('#period-tabs').querySelectorAll('.period-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.desde = btn.dataset.desde || null;
      state.hasta = btn.dataset.hasta || null;
      $('#period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadPeriodData();
      loadTimeline({ showLoading: true });
    });
  });
}

async function loadSummary() {
  const summary = await fetchJSON(`/api/stats/summary${apiQuery()}`);
  renderKpis(summary.total);
  loadCitasDonut(summary.marcas);
  loadChannelsDonut(summary.total.conversacion);
  $('#brands').innerHTML = summary.marcas.map(renderBrandCard).join('');
  renderBrandCompare(summary.marcas);
  $('#meta-periodo').textContent = `Periodo: ${summary.desde} – ${summary.hasta}`;
  buildPeriodTabs(summary.desde);
}

function colorForIntensity(v, max) {
  if (!max || v === 0) return 'var(--surface-alt)';
  const t = Math.min(1, v / max);
  // interpolación simple hacia el acento
  const alpha = 0.15 + t * 0.85;
  return `color-mix(in srgb, var(--accent) ${Math.round(alpha * 100)}%, var(--surface-alt))`;
}

async function loadHeatmap() {
  const daily = await fetchJSON('/api/stats/daily?days=30');
  const max = Math.max(...daily.map(d => d.conversacion), 1);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const grid = $('#heatmap-grid');
  grid.innerHTML = daily.map(d => {
    const cls = ['heatmap-cell'];
    if (d.fecha === today) cls.push('today');
    else if (d.fecha === yesterday) cls.push('recent');
    return `<div class="${cls.join(' ')}" style="background:${colorForIntensity(d.conversacion, max)}" title="${d.fecha}: ${d.conversacion}" data-fecha="${d.fecha}"></div>`;
  }).join('');

  grid.querySelectorAll('.heatmap-cell').forEach(cell => {
    cell.addEventListener('click', () => showDayDetail(cell.dataset.fecha));
  });

  $('#trend-chart').innerHTML = buildTrendSvg(daily);
}

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
            <td>${fmt(r.consulta_agendada)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    panel.innerHTML = `<div class="loading">Error cargando ${fecha}: ${e.message}</div>`;
  }
}

async function loadPeriodData() {
  $('#brands').innerHTML = '<div class="loading">Cargando dashboard…</div>';
  try {
    await loadSummary();
    $('#meta-actualizado').textContent = `Actualizado a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    $('#brands').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

async function init() {
  const btn = $('#refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Actualizando…'; }
  try {
    await Promise.all([loadPeriodData(), loadHeatmap()]);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Actualizar datos'; }
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

function renderTimeline(marcas, computedAt) {
  $('#timeline-computed-at').textContent = computedAt ? `Calculado a las ${fmtHora(computedAt)}` : '';
  const html = marcas.map(m => {
    if (!m.citas.length) {
      return `<div class="timeline-brand"><h3>${m.nombre} <span class="tl-count">0 citas</span></h3></div>`;
    }
    const g = m.resumenGestion || {};
    const resumenBits = [
      g.bot ? `${g.bot} por el bot` : null,
      g.humano ? `${g.humano} por un humano` : null,
      g.desconocido ? `${g.desconocido} sin dato` : null,
    ].filter(Boolean).join(' · ');
    const rows = m.citas.map(c => `
      <div class="timeline-row">
        <span class="tl-fecha">${fmtFecha(c.fecha)}</span>
        <span class="tl-nombre">${c.nombre}</span>
        <span class="tl-gestion">${c.esBot ? 'bot' : (c.gestionadoPor || '—')}</span>
        <span class="tl-status">${c.verificado
          ? 'pago/cita confirmado'
          : '<span class="tl-unverified">sin confirmación de pago registrada</span>'}</span>
      </div>`).join('');
    return `
      <div class="timeline-brand">
        <h3>${m.nombre} <span class="tl-count">${m.citas.length} citas</span></h3>
        ${resumenBits ? `<p class="tl-resumen-gestion">${resumenBits}</p>` : ''}
        ${rows}
      </div>`;
  }).join('');
  $('#timeline').innerHTML = html;
}

async function loadTimeline({ showLoading = false, force = false } = {}) {
  if (showLoading) {
    $('#timeline').innerHTML = '<div class="loading">Actualizando citas… (puede tardar un minuto)</div>';
  }
  try {
    const data = await fetchJSON(`/api/stats/timeline${apiQuery(force ? { force: 'true' } : {})}`);
    renderTimeline(data.marcas, data.computedAt);
  } catch (e) {
    $('#timeline').innerHTML = `<div class="loading">Error cargando el timeline: ${e.message}</div>`;
  }
}

$('#refresh-btn')?.addEventListener('click', () => {
  init();
  loadTimeline({ showLoading: true, force: true });
});
init();
loadTimeline();
