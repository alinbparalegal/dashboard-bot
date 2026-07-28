const cron = require('node-cron');
const { upsertDailyStatsAllBrands } = require('./statsService');

// Nº de días hacia atrás (desde ayer) que se recalculan cada noche. Un contacto creado
// hace unos días puede seguir madurando de estado (lead_cualificando -> ... -> consulta_agendada)
// después de que su día ya se guardó; recalcular esta ventana corrige esas fotos desactualizadas.
const RECOMPUTE_WINDOW_DAYS = 7;

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Cada noche a las 00:30, recalcula y guarda (upsert) las stats de los últimos
// RECOMPUTE_WINDOW_DAYS días ya cerrados, para las 5 marcas.
cron.schedule('30 0 * * *', async () => {
  for (let i = 1; i <= RECOMPUTE_WINDOW_DAYS; i++) {
    const fecha = dateStr(i);
    try {
      await upsertDailyStatsAllBrands(fecha);
      console.log(`[DailyStatsCron] Stats guardadas para ${fecha}`);
    } catch (e) {
      console.error(`[DailyStatsCron] Error en ${fecha}:`, e.message);
    }
  }
});

console.log('[DailyStatsCron] Cron nocturno de estadísticas activo (00:30)');
