const statsService = require('../services/statsService');

// Sin Mongo ni GHL: las pestañas de periodo (Todo/mes) necesitan saber desde cuándo hay
// datos, pero no deberían depender de que termine ninguna consulta lenta para aparecer.
function getLaunchDate(req, res) {
  res.status(200).json({ launchDate: process.env.BOT_LAUNCH_DATE });
}

async function getDailyTotals(req, res) {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const { desde, hasta } = req.query;
    const data = await statsService.getDailyTotals({ days, desde, hasta });
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getDailyTotals:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getDailyDetail(req, res) {
  try {
    const { fecha } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ message: 'Fecha inválida, usar formato YYYY-MM-DD' });
    }
    const data = await statsService.getDetailForDate(fecha);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getDailyDetail:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getSummary(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    // "Todo" (sin desde/hasta explícitos en la query) no tiene un mes propio con el que
    // comparar — se usa el mes en curso como referencia. Una pestaña de mes sí lo tiene.
    const mesReferencia = req.query.desde ? hasta.slice(0, 7) : statsService.todayStr().slice(0, 7);
    const data = await statsService.getSummary(desde, hasta, mesReferencia);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getSummary:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getChannels(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    const force = req.query.force === 'true';
    const data = await statsService.getChannelBreakdown(desde, hasta, force);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getChannels:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getTimeline(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    const force = req.query.force === 'true';
    const data = await statsService.getCitasTimeline(desde, hasta, force);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getTimeline:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getAttribution(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    const force = req.query.force === 'true';
    const data = await statsService.getAttribution(desde, hasta, force);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getAttribution:', error);
    res.status(500).json({ message: error.message });
  }
}

module.exports = { getLaunchDate, getDailyTotals, getDailyDetail, getSummary, getChannels, getTimeline, getAttribution };
