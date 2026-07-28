// Script manual: rellena el histórico de DailyStat para un rango de días ya cerrados.
// Uso:
//   node src/scripts/backfillDailyStats.js                 -> desde BOT_LAUNCH_DATE hasta ayer
//   node src/scripts/backfillDailyStats.js --days=30        -> últimos 30 días cerrados (hasta ayer)

require('dotenv').config();
const connectDB = require('../config/db');
const { upsertDailyStatsAllBrands } = require('../services/statsService');

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function parseArgs() {
  const daysArg = process.argv.find(a => a.startsWith('--days='));
  return daysArg ? parseInt(daysArg.split('=')[1], 10) : null;
}

function dateRangeArray(desdeDate, hastaDate) {
  const dates = [];
  const cur = new Date(desdeDate);
  while (cur <= hastaDate) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function main() {
  await connectDB();

  const hasta = yesterday();
  const days = parseArgs();
  let desde;
  if (days) {
    desde = new Date(hasta);
    desde.setDate(desde.getDate() - (days - 1));
  } else {
    desde = new Date(process.env.BOT_LAUNCH_DATE || hasta);
  }

  const fechas = dateRangeArray(desde, hasta);
  console.log(`[Backfill] Rellenando ${fechas.length} días: ${fechas[0]} .. ${fechas[fechas.length - 1]}`);

  for (const fecha of fechas) {
    try {
      await upsertDailyStatsAllBrands(fecha);
      console.log(`[Backfill] ${fecha} OK`);
    } catch (e) {
      console.error(`[Backfill] ${fecha} ERROR: ${e.message}`);
    }
  }

  console.log('[Backfill] Completado.');
  process.exit(0);
}

main().catch(e => {
  console.error('[Backfill] Error fatal:', e);
  process.exit(1);
});
